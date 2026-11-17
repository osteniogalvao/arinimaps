import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { CabecalhoPagina, Secao } from "@/components/ui/Pagina";
import TopoConta from "@/components/painel/TopoConta";
import { currentUser } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { validarAreaDesenhada } from "@/lib/geo/consultaArea";

const pagina = "/conta/monitoramento";
const FONTES = {
  inpe_queimadas: ["INPE · focos de calor", "https://data.inpe.br/queimadas/"],
  ibama_embargos: ["IBAMA · embargos", "https://pamgia.ibama.gov.br/server/rest/services/SISCOM/publico/MapServer/3"],
  prodes_cerrado: ["INPE · desmatamento no Cerrado", "https://terrabrasilis.dpi.inpe.br/"],
  sigef: ["INCRA · parcelas certificadas", "https://geoportal.incra.gov.br/catalogue/#/dataset/1"],
  inmet_avisos: ["INMET · avisos meteorológicos (tempestade, chuva forte, ventania, geada, onda de calor)", "https://alertas2.inmet.gov.br/"],
} as const;
type Fonte = keyof typeof FONTES;
type Area = {id:string;nome:string;hectares:number;ativo:boolean;vinculo:boolean;habilitada:boolean;leituras:{
  fonte:Fonte;falhou:boolean;lida_em:string|null;tentativa_em:string|null}[]};
type Evento = {id:number;nome:string;fonte:Fonte;titulo:string;codigo:string;detectado_em:string;detalhes:Record<string,unknown>;
  anterior:Record<string,unknown>|null;lat:number;lon:number};
const avisos:Record<string,string> = {
  ok:"Monitoramento ativado. A primeira leitura de cada fonte será a referência para os próximos avisos.",
  fim:"Monitoramento encerrado. Você pode consultar o histórico abaixo.",
  geometria:"Selecione um imóvel verificado com divisa disponível ou envie um polígono GeoJSON válido no Brasil (até 750 KB).",
  dados:"Dê um nome à área, marque pelo menos uma fonte e confirme a autorização.",
  limite:"Você atingiu o limite de áreas deste plano.", negado:"O monitoramento está indisponível neste perfil ou plano.", falha:"Falha ao salvar. Tente novamente.",
  vinculo:"Esta propriedade precisa de vínculo aprovado e polígono cadastrado.",
  whatsapp:"Habilite o WhatsApp nas preferências de privacidade ou ative as consultas somente pelo painel.",
  hectares:"A área excede o limite em hectares do plano.",
};
const data = (s:string) => new Date(s).toLocaleString("pt-BR",{timeZone:"America/Sao_Paulo"});
const U = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i;

async function salvar(form:FormData) {
  "use server";
  const u=await currentUser();
  if (!u) redirect("/entrar?volta="+pagina);
  const nome=String(form.get("nome")??"").trim(), cofre=String(form.get("cofre")??"");
  const fontes=form.getAll("fonte").map(String).filter(v=>Object.hasOwn(FONTES,v));
  if (!nome || nome.length>160 || !fontes.length || !form.has("aceite")) redirect(pagina+"?aviso=dados");
  let geo=null;
  const arquivo=form.get("arquivo");
  if (cofre && !U.test(cofre) || cofre && arquivo instanceof File && arquivo.size>0) redirect(pagina+"?aviso=geometria");
  if (!cofre) {
    if (!(arquivo instanceof File) || arquivo.size>750_000 || arquivo.size===0) redirect(pagina+"?aviso=geometria");
    try {
      const bruto=JSON.parse(await arquivo.text());
      const poligono=bruto.type==="FeatureCollection" && bruto.features?.length===1?bruto.features[0]:bruto;
      const v=await validarAreaDesenhada(poligono);
      if (v.ok) geo=v.area.geometria;
    } catch { /* A validação retorna ao mesmo formulário. */ }
    if (!geo) redirect(pagina+"?aviso=geometria");
  }
  const {error}=await supabaseAdmin().rpc("monitor_configurar",{p_titular:u.id,p_nicho:u.nicho,p_nome:nome,p_cofre:cofre||null,p_geo:geo,p_fontes:fontes,p_wa:form.has("whatsapp")});
  if (error) redirect(pagina+"?aviso="+({P9501:"vinculo",P9502:"limite",P9503:"whatsapp",P9504:"hectares","42501":"negado"}[error.code]??"falha"));
  revalidatePath(pagina); redirect(pagina+"?aviso=ok");
}
async function desativar(form:FormData) {
  "use server";
  const u=await currentUser();
  if (!u) redirect("/entrar?volta="+pagina);
  const id=String(form.get("id"));
  if (!U.test(id)) redirect(pagina+"?aviso=dados");
  const {error}=await supabaseAdmin().rpc("monitor_desativar",{p_titular:u.id,p_nicho:u.nicho,p_id:id});
  revalidatePath(pagina); redirect(pagina+"?aviso="+(error?"falha":"fim"));
}
const labels:Record<string,string> = {data_hora_gmt:"Detecção (GMT)",satelite:"Satélite",id_foco_bdq:"Foco",year:"Ano PRODES",area_km:"Área (km²)",
  num_tad:"Termo",serie_tad:"Série",dat_embargo:"Data do embargo",sit_desmatamento:"Situação",parcela_codigo:"Parcela",status:"Situação",data_aprovacao:"Aprovação",
  evento:"Evento",severidade:"Severidade",cor:"Nível",inicio:"Início",fim:"Fim"};
function valor(k:string,v:unknown) {return k==="dat_embargo" && typeof v==="number" ? new Date(v).toLocaleDateString("pt-BR",{timeZone:"UTC"}) : String(v);}

export default async function Monitoramento({searchParams}:{searchParams:Promise<{p?:string;aviso?:string}>}) {
  const u=await currentUser();
  if (!u) redirect("/entrar?volta="+pagina);
  if (!["proprietario","produtor_rural"].includes(u.nicho??"")) redirect("/conta");
  const q=await searchParams, p=Math.min(100000,Math.max(1,Math.floor(Number(q.p)||1)));
  const {data:r,error} = await supabaseAdmin().rpc("monitor_painel",{p_titular:u.id,p_nicho:u.nicho,p_pagina:p});
  if (error) throw new Error("Falha ao carregar o monitoramento.");
  const painel=r as {liberado:boolean;cofres:{id:string;nome:string}[];areas:Area[];eventos:Evento[]};
  return <div className="min-h-screen bg-fundo"><TopoConta daEquipe={false}/>
    <main className="mx-auto max-w-3xl space-y-8 px-5 py-10">
      <Link className="text-sm underline" href="/conta">Minha conta</Link>
      <CabecalhoPagina titulo="Monitoramento territorial" subtitulo="Acompanhe as ocorrências publicadas pelas fontes que você selecionar."/>
      {q.aviso && avisos[q.aviso] && <p role="status">{avisos[q.aviso]}</p>}
      <Secao titulo="Áreas acompanhadas">
        {painel.areas.length===0 && <p>Nenhuma área cadastrada neste perfil.</p>}
        {painel.areas.map(a=><div key={a.id} className="cartao space-y-2 p-4"><h3 className="font-semibold">{a.nome}</h3>
          <p>{Number(a.hectares).toLocaleString("pt-BR")} ha · {a.ativo ? !a.vinculo ? "Suspenso até nova confirmação da divisa e do vínculo" : a.habilitada?"Ativo":"Suspenso pelo plano ou pela cota" : "Encerrado"}</p>
          {a.leituras.map(l=><p key={l.fonte} className="text-sm">{FONTES[l.fonte][0]} · {l.falhou?"Fonte indisponível na última tentativa. ":""}{l.lida_em?"Última leitura em "+data(l.lida_em):"Aguardando a primeira leitura"}</p>)}
          <a href={`/api/conta/monitoramento/${a.id}/relatorio`} target="_blank" rel="noreferrer" className="inline-block text-sm font-semibold underline">Relatório do mês (PDF)</a>
          {a.ativo && <form action={desativar}><input type="hidden" name="id" value={a.id}/><button className="btn-contorno px-3 py-1">Desativar monitoramento</button></form>}
        </div>)}
      </Secao>
      {painel.liberado ? <Secao titulo="Ativar ou atualizar uma área"><form action={salvar} className="cartao grid gap-4 p-5">
        <label>Nome da área<input className="campo w-full" name="nome" maxLength={160} required/></label>
        {painel.cofres.length>0 && <label>Propriedade verificada do cofre<select className="campo w-full" name="cofre" defaultValue=""><option value="">Usar arquivo da minha área</option>{painel.cofres.map(c=><option value={c.id} key={c.id}>{c.nome}</option>)}</select></label>}
        <label>Arquivo GeoJSON da minha área <span className="text-sm">(um polígono, até 750 KB)</span><input type="file" name="arquivo" aria-label="Arquivo GeoJSON" accept=".geojson,.json" className="block w-full"/></label>
        <fieldset className="grid gap-1"><legend>Fontes para acompanhar</legend>{Object.entries(FONTES).map(([k,f])=><label key={k}><input type="checkbox" name="fonte" value={k}/> {f[0]}</label>)}</fieldset>
        <label><input type="checkbox" required name="aceite"/> Autorizo a consulta periódica para esta área sob minha responsabilidade.</label>
        {!!process.env.WHATSAPP_MONITORAMENTO_TEMPLATE_ID && <label><input type="checkbox" name="whatsapp"/> Receber um aviso diário por WhatsApp quando houver novidades. <Link href="/privacidade/preferencias" className="underline">Preferências de privacidade</Link></label>}
        <button className="btn-verde justify-self-start px-4 py-2">Ativar monitoramento</button>
      </form></Secao>: <Link href="/planos" className="underline">Ver planos com monitoramento</Link>}
      <Secao titulo="Histórico de ocorrências">
        {!painel.eventos.length && <p>Nenhuma ocorrência registrada nesta página.</p>}
        {painel.eventos.slice(0,20).map(e=><article key={e.id} className="cartao space-y-2 p-4">
          <h3 className="font-semibold">{e.titulo}</h3><p>{e.nome} · {e.anterior?"Atualização de um registro":"Novo registro na área"} · {data(e.detectado_em)}</p>
          <p className="break-words text-sm">Código {e.codigo} · interseção em {e.lat.toFixed(5)}, {e.lon.toFixed(5)}</p>
          {Object.entries(e.detalhes).map(([k,v])=><p className="text-sm" key={k}>{labels[k]??k} · {e.anterior && e.anterior[k] != null && e.anterior[k]!==v ? valor(k,e.anterior[k])+" → ":""}{valor(k,v)}</p>)}
          <a href={FONTES[e.fonte][1]} target="_blank" rel="noreferrer" className="underline">{FONTES[e.fonte][0]}</a>
        </article>)}
        <div className="flex gap-4">{p>1 && <Link className="underline" href={pagina+"?p="+(p-1)}>Anterior</Link>}{painel.eventos.length>20 && <Link className="underline" href={pagina+"?p="+(p+1)}>Próxima</Link>}</div>
      </Secao>
    </main></div>;
}
