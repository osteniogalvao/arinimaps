import Link from "next/link";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { botaoDiv, caixaDiv, campoDiv } from "@/lib/divulgacao";
import { publicarContrato, salvarFaixa, salvarKit, validarMissao } from "@/app/(public)/divulgador/acoes";
import { RegrasFaixas, RegrasImovel } from "./Regras";

export default async function Catalogo({diretoria,pagina,filaMax,horas}:{diretoria:boolean;pagina:number;filaMax:number;horas:number|null}) {
  const db=supabaseAdmin(), de=(pagina-1)*20;
  const [faixas,itens,missoes]=await Promise.all([
    db.from("divulgacao_faixas").select("*").order("seguidores_min"),
    db.from("divulgacao_imoveis").select("imovel,titulo_publico,legenda,kit_url,etapas,aprovado,min_faixa,regiao_exigida,campanha,divulgacao_metas(etapa,quantidade,dias),properties(codigo,titulo,status,campanhas!property_id(id,nome,gasto))",{count:"exact"})
       .eq("autorizado",true).order("atualizado_em",{ascending:false}).order("imovel").range(de,de+19),
    db.from("divulgacao_missoes").select("id,etapa,link,enviada,divulgacao_reservas(imovel,titular,etapas,divulgacao_cadastros(instagram))",{count:"exact"})
       .eq("estado","enviada").order("enviada").order("id").range(de,de+19)]);
  if(faixas.error||itens.error||missoes.error)throw Error("Não foi possível carregar as faixas e os materiais de divulgação.");
  return <><section className={caixaDiv}><h2 className="text-xl font-semibold">Faixas do piloto</h2>
    <p>A faixa de maior mínimo alcançado define o teto do imóvel, o prazo e o número de reservas simultâneas.</p>
    {faixas.data.map(f=><p key={f.id}>A partir de {f.seguidores_min} seguidores · imóveis até {Number(f.teto_valor).toLocaleString("pt-BR",{style:"currency",currency:"BRL"})} · {f.simultaneos} reserva(s) por {f.dias} dia(s)</p>)}
    {diretoria&&<form action={salvarFaixa} className="grid gap-3 md:grid-cols-2">
      {[["min","Mínimo de seguidores",0],["teto","Teto do imóvel em reais",0.01],["simultaneos","Reservas simultâneas",1],["dias","Prazo em dias",1]].map(([key,label,min])=><label key={key}>{label}
        <input name={String(key)} className={campoDiv} min={min} step={key==="teto"?0.01:1} type="number" required/></label>)}
      <button className={botaoDiv}>Salvar faixa por mínimo de seguidores</button></form>}</section>
    {diretoria&&<RegrasFaixas faixas={faixas.data} max={filaMax} horas={horas}/>}
    {diretoria&&<details className={caixaDiv}><summary className="font-semibold">Publicar termo do programa</summary>
      <form className="space-y-3" action={publicarContrato}><label className="block">Identificação da versão<input className={campoDiv} name="versao" required maxLength={100}/></label>
        <label className="block">Texto integral aprovado pelo jurídico<textarea className={campoDiv} name="texto" rows={6} required minLength={20} maxLength={120000}/></label>
        <p>O novo termo exige um novo aceite para futuras reservas. Os aceites anteriores ficam registrados.</p><button className={botaoDiv}>Publicar versão</button></form></details>}
    <section className={caixaDiv}><h2 className="text-xl font-semibold">Imóveis com autorização do proprietário</h2>
      {!itens.data.length&&<p>Os imóveis aparecem aqui após o proprietário autorizar a divulgação na área do anúncio.</p>}
      {itens.data.map(d=>{const i=Array.isArray(d.properties)?d.properties[0]:d.properties;return <details key={d.imovel} className="border-t border-linha py-3">
        <summary className="cursor-pointer font-semibold">{i?.codigo} · {i?.titulo} · {d.aprovado?"No catálogo":"Aguardando kit"}</summary>
        <form action={salvarKit} className="mt-3 space-y-3"><input type="hidden" name="imovel" value={d.imovel}/>
        <label className="block">Título para divulgação<input className={campoDiv} name="titulo" minLength={3} maxLength={120} defaultValue={d.titulo_publico??""} required/></label>
        <label className="block">Legenda com identificação de publicidade<textarea className={campoDiv} name="legenda" minLength={3} maxLength={1500} defaultValue={d.legenda??""} required/></label>
        <label className="block">Link HTTPS do kit aprovado<input className={campoDiv} name="url" type="url" defaultValue={d.kit_url??""} required/></label>
        <label className="block">Missões em ordem, uma por linha<textarea className={campoDiv} name="etapas" defaultValue={d.etapas?.join("\n")??""} required/></label>
        <label className="flex items-start gap-2"><input type="checkbox" name="revisado"/>Conferi os arquivos, a identificação publicitária e a ausência de endereço exato, coordenadas, dados pessoais e contatos.</label>
        <button className={botaoDiv} name="decisao" value="aprovar">Aprovar kit</button>{" "}
        {d.aprovado&&<button className="underline" formNoValidate name="decisao" value="retirar">Retirar do catálogo</button>}</form>
        {d.aprovado&&<RegrasImovel imovel={d.imovel} etapas={d.etapas} metas={d.divulgacao_metas} faixas={faixas.data} faixa={d.min_faixa} regiao={d.regiao_exigida} campanha={d.campanha} campanhas={i?.campanhas??[]}/>}</details>})}</section>
    <section className={caixaDiv}><h2 className="text-xl font-semibold">Comprovações para análise</h2>
      {!missoes.data.length&&<p>Nenhuma publicação aguardando análise.</p>}
      {missoes.data.map(m=>{const r=Array.isArray(m.divulgacao_reservas)?m.divulgacao_reservas[0]:m.divulgacao_reservas;
        const c=Array.isArray(r?.divulgacao_cadastros)?r?.divulgacao_cadastros[0]:r?.divulgacao_cadastros;
        return <form key={m.id} action={validarMissao} className="space-y-2 border-t border-linha py-4">
          <h3 className="font-semibold">@{c?.instagram} · {r?.etapas?.[m.etapa-1]}</h3><a className="underline" href={m.link} target="_blank" rel="noopener noreferrer">Conferir autoria e material publicado</a>
          {" · "}<a className="underline" href={"/api/divulgacao/comprovante?id="+m.id} target="_blank" rel="noreferrer">Abrir captura</a>
          <input type="hidden" name="missao" value={m.id}/><label className="block">Observação da análise<input className={campoDiv} name="motivo" maxLength={500}/></label>
          <button className={botaoDiv} name="decisao" value="validar">Validar publicação</button>{" "}<button className="underline" name="decisao" value="rejeitar">Rejeitar</button>
        </form>})}
    </section>
    <nav className="flex gap-4" aria-label="Paginação do catálogo e missões">
      {pagina>1&&<Link href={"?catalogo="+(pagina-1)}>Página anterior de materiais</Link>}
      {de+20<Math.max(itens.count??0,missoes.count??0)&&<Link href={"?catalogo="+(pagina+1)}>Próxima página de materiais</Link>}
    </nav></>;
}
