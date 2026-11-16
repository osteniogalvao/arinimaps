import { supabaseAdmin } from "@/lib/supabase/admin";
import { botaoDiv, caixaDiv, campoDiv } from "@/lib/divulgacao";
import { aceitarContrato, filaImovel, reservar } from "./acoes";
import EnviarProva from "./EnviarProva";
import { urlDoSite } from "@/lib/compartilhar";

type Oferta={imovel:string;chamada:string;valor:number;codigo:string;tipo:string;regiao:string|null;situacao:string;posicao:number|null;limite:string|null};
export default async function Carteira({titular,tipo,regiao}:{titular:string;tipo?:string;regiao?:string}) {
  const db=supabaseAdmin();
  const [resultado,termo,aceites,cat,ativas]=await Promise.all([
    db.rpc("divulgacao_resultados",{p_ator:titular}).maybeSingle(),
    db.from("divulgacao_termos").select("id,versao,texto").eq("vigente",true).maybeSingle(),
    db.from("divulgacao_aceites").select("termo").eq("titular",titular),
    db.rpc("divulgacao_ofertas",{p_titular:titular}),
    db.from("divulgacao_reservas").select("id,imovel,vence,etapas,divulgacao_imoveis(kit_url,legenda),divulgacao_missoes(etapa,estado,motivo),divulgacao_links(id,etapa),divulgacao_metas_reserva(etapa,quantidade,validadas,prazo)").eq("titular",titular)
       .is("encerrada",null).gt("vence",new Date().toISOString()).order("vence")]);
  if(resultado.error||termo.error||aceites.error||cat.error||ativas.error)throw Error("Não foi possível carregar o catálogo.");
  const resumo=resultado.data as {cliques:number,cadastros:number,visitas:number,vendas:number}|null;
  const contrato=termo.data, aceito=contrato&&aceites.data.some(a=>a.termo===contrato.id);
  const todas=(cat.data??[]) as Oferta[],ofertas=todas.filter(o=>(!tipo||o.tipo===tipo)&&(!regiao||o.regiao===regiao));
  const reservas=new Map(ativas.data.map(r=>[r.imovel,r]));
  return <section className={caixaDiv}><h2 className="text-xl font-semibold">Imóveis para divulgação</h2>
    {resumo&&<p>{resumo.cliques} cliques únicos · {resumo.cadastros} cadastros validados · {resumo.visitas} visitas realizadas · {resumo.vendas} vendas atribuídas</p>}
    {contrato?<details className="space-y-2" open={!aceito}><summary>Termo do programa · {contrato.versao}{aceito?" · aceito":""}</summary>
      <p className="max-h-96 overflow-auto whitespace-pre-wrap">{contrato.texto}</p>
      {!aceito&&<form action={aceitarContrato}><input type="hidden" name="termo" value={contrato.id}/><label className="flex gap-2"><input type="checkbox" name="li" required/>Li e aceito esta versão do termo.</label><button className={botaoDiv}>Registrar aceite</button></form>}</details>:
      <p>As reservas abrem quando a Diretoria publicar o termo de participação.</p>}
    {!!todas.length&&<form className="flex flex-wrap items-end gap-3"><label>Tipo<select className={campoDiv} name="tipo" defaultValue={tipo??""}><option value="">Todos</option>
      {[...new Set(todas.map(o=>o.tipo))].sort().map(t=><option key={t}>{t}</option>)}</select></label>
      <label>Município<select className={campoDiv} name="regiao" defaultValue={regiao??""}><option value="">Todos</option>{[...new Set(todas.map(o=>o.regiao).filter(Boolean))].sort().map(r=><option key={r}>{r}</option>)}</select></label><button className={botaoDiv}>Filtrar</button></form>}
    {!ofertas.length && <p>Nenhum imóvel disponível para esta seleção.</p>}
    {ofertas.map(o=>{const r=reservas.get(o.imovel), kit=Array.isArray(r?.divulgacao_imoveis)?r?.divulgacao_imoveis[0]:r?.divulgacao_imoveis;
      return <article key={o.imovel} className="space-y-3 border-t border-linha py-4"><h3 className="font-bold">{o.chamada}</h3>
      <p>{o.codigo} · {o.regiao} · {o.tipo} · {Number(o.valor).toLocaleString("pt-BR",{style:"currency",currency:"BRL"})}</p>
      {o.posicao!==null&&<p>{o.situacao==="sua_vez"?"Chegou sua vez de reservar.":"Posição na fila: "+o.posicao}{o.limite?" Convocação válida até "+new Date(o.limite).toLocaleString("pt-BR",{timeZone:"America/Sao_Paulo"})+" (Brasília).":""}</p>}
      {["fila","na_fila","sua_vez"].includes(o.situacao)&&<form action={filaImovel}><input type="hidden" name="imovel" value={o.imovel}/><button className="text-verde underline" name="acao" value={o.posicao===null?"entrar":"sair"}>{o.posicao===null?"Entrar na fila do imóvel":"Sair da fila"}</button></form>}
      {!r ? ["livre","sua_vez"].includes(o.situacao)&&<form action={reservar}><input type="hidden" name="imovel" value={o.imovel}/><button disabled={!aceito} className={botaoDiv+" disabled:opacity-50"}>Reservar imóvel</button></form>
      : <><p>Reservado até {new Date(r.vence).toLocaleString("pt-BR",{timeZone:"America/Sao_Paulo"})} (Brasília).</p>
        {kit?.kit_url&&<a href={kit.kit_url} target="_blank" rel="noopener noreferrer" className="font-semibold text-verde underline">Abrir kit aprovado</a>}
        <p className="whitespace-pre-line">{kit?.legenda}</p>
        <ol className="space-y-3">{(r.etapas as string[]).map((e,index)=>{const n=index+1,m=r.divulgacao_missoes.find(x=>x.etapa===n);
          const anterior=n===1||r.divulgacao_missoes.some(x=>x.etapa===n-1&&x.estado==="validada");
          const link=r.divulgacao_links.find(x=>x.etapa===n);
          const meta=r.divulgacao_metas_reserva.find(x=>x.etapa===n);
          return <li key={n}><strong>{n}. {e}</strong><p>{m?.estado??(anterior?"Pendente":"Aguardando a etapa anterior")}{m?.motivo?" · "+m.motivo:""}</p>
            {meta&&<p>{meta.validadas} de {meta.quantidade} publicações validadas · prazo em {new Date(meta.prazo).toLocaleString("pt-BR",{timeZone:"America/Sao_Paulo"})} (Brasília)</p>}
            {anterior&&link&&<label className="block">Link para usar nesta publicação<input className={campoDiv} readOnly value={urlDoSite()+"/d/"+link.id}/></label>}
            {anterior&&(!m||m.estado==="rejeitada"||m.estado==="parcial")&&<EnviarProva reserva={r.id} etapa={n} campo={campoDiv} botao={botaoDiv}/>}</li>})}</ol></>}
      </article>})}
  </section>;
}
