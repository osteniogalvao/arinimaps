import { ajustarFila, ajustarProgressao, ajustarRegrasImovel } from "@/app/(public)/divulgador/acoes";
import { botaoDiv, caixaDiv, campoDiv } from "@/lib/divulgacao";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { hojeBrasilia } from "@/lib/simulador";

export type Faixa={id:string;seguidores_min:number;progressao:boolean;min_missoes:number;min_cliques:number;min_cadastros:number;min_visitas:number};

export function RegrasFaixas({faixas,max,horas}:{faixas:Faixa[];max:number;horas:number|null}) {
  return <details className={caixaDiv}><summary className="font-semibold">Fila de imóveis e progressão por desempenho</summary>
    <form action={ajustarFila} className="space-y-2"><label className="block">Vagas na fila de cada imóvel (0 desativa a fila)
      <input className={campoDiv} name="max" type="number" min={0} max={1000} required defaultValue={max}/></label>
      <label className="block">Horas para aceitar a convocação<input className={campoDiv} name="horas" type="number" min={1} max={168} defaultValue={horas??""}/></label>
      <button className={botaoDiv}>Salvar fila</button></form>
    {faixas.map(f=><form key={f.id} action={ajustarProgressao} className="space-y-2 border-t border-linha pt-3">
      <input type="hidden" name="faixa" value={f.id}/><h3>Faixa de {f.seguidores_min} seguidores</h3>
      <label className="flex gap-2"><input type="checkbox" name="ativa" defaultChecked={f.progressao}/>Permitir acesso por desempenho</label>
      <div className="grid gap-2 sm:grid-cols-2">{([["missoes","Missões validadas",f.min_missoes],["cliques","Cliques únicos",f.min_cliques],["cadastros","Cadastros validados",f.min_cadastros],["visitas","Visitas realizadas",f.min_visitas]] as const).map(([key,n,v])=>
        <label key={key}>Mínimo de {n.toLocaleLowerCase("pt-BR")}<input className={campoDiv} type="number" required min={0} name={key} defaultValue={v}/></label>)}</div>
      <button className={botaoDiv}>Salvar critérios da faixa</button></form>)}
  </details>;
}

type Meta={etapa:number;quantidade:number;dias:number};
export function RegrasImovel({imovel,faixas,etapas,metas,faixa,regiao,campanha,campanhas}:{
  imovel:string;faixas:Faixa[];etapas:string[];metas:Meta[];faixa:string|null;regiao:string|null;campanha:string|null;campanhas:{id:string;nome:string;gasto:number|null}[];
}) {
  return <form action={ajustarRegrasImovel} className="my-4 space-y-2 border-t border-linha pt-3">
    <input type="hidden" name="imovel" value={imovel}/><h4 className="font-semibold">Elegibilidade e metas das próximas reservas</h4>
    <label className="block">Faixa mínima<select name="faixa" className={campoDiv} defaultValue={faixa??""}><option value="">Qualquer faixa dentro do teto</option>
      {faixas.map(f=><option key={f.id} value={f.id}>{f.seguidores_min} seguidores</option>)}</select></label>
    <label className="block">Região da audiência exigida, como consta na inscrição (opcional)<input className={campoDiv} name="regiao" maxLength={100} defaultValue={regiao??""}/></label>
    <label className="block">Campanha dedicada com gasto registrado<select className={campoDiv} name="campanha" defaultValue={campanha??""}><option value="">Sem campanha vinculada</option>
      {campanhas.filter(c=>c.gasto!==null||c.id===campanha).map(c=><option key={c.id} value={c.id}>{c.nome}</option>)}</select></label>
    {etapas.map((e,i)=>{const n=i+1,m=metas.find(meta=>meta.etapa===n);
      return <fieldset key={n} className="grid gap-2 sm:grid-cols-2"><legend>{n}. {e}</legend>
        <label>Publicações a validar<input className={campoDiv} type="number" min={1} max={100} name={"quantidade_"+n} defaultValue={m?.quantidade??""}/></label>
        <label>Dias desde a reserva<input className={campoDiv} type="number" min={1} max={365} name={"dias_"+n} defaultValue={m?.dias??""}/></label></fieldset>;})}
    <p>Sem meta específica, a etapa exige uma publicação até o vencimento da reserva.</p><button className={botaoDiv}>Salvar critérios do imóvel</button>
  </form>;
}

export async function Comparativo({ator,inicio,fim}:{ator:string;inicio?:string;fim?:string}) {
  const hoje=hojeBrasilia(), dataInicial=new Date(hoje+"T12:00:00Z");
  dataInicial.setUTCDate(dataInicial.getUTCDate()-29);
  const de=inicio??dataInicial.toISOString().slice(0,10), ate=fim??hoje;
  const {data:linhas,error}=await supabaseAdmin().rpc("divulgacao_comparativo",{p_ator:ator,p_inicio:de,p_fim:ate});
  const itens=(linhas??[]) as {grupo:string;imoveis:number;visitas_semana:number|null;dias_venda:number|null;cadastros:number|null;gasto:number|null;cpl:number|null}[];
  const moeda=(n:number|null)=>n==null?"—":Number(n).toLocaleString("pt-BR",{style:"currency",currency:"BRL"});
  return <section className={caixaDiv}><h2 className="text-xl font-semibold">Comparativo do piloto</h2>
    <form className="flex flex-wrap items-end gap-3"><label>Início<input className={campoDiv} type="date" name="inicio" required defaultValue={de}/></label>
      <label>Fim<input className={campoDiv} type="date" name="fim" required defaultValue={ate}/></label><button className={botaoDiv}>Comparar período</button></form>
    {error?<p role="alert">Confira as datas. O período máximo é de 366 dias.</p>:<><div className="overflow-x-auto"><table className="w-full text-left"><thead><tr>
      {["Grupo","Imóveis","Visitas com relatório por imóvel/semana","Dias até a venda","Cadastros atribuídos","Gasto registrado","Custo por cadastro na campanha"].map(h=><th key={h} className="p-2">{h}</th>)}</tr></thead>
      <tbody>{itens.map(r=><tr key={r.grupo} className="border-t border-linha"><th scope="row" className="p-2">{r.grupo}</th>
        {[r.imoveis,r.visitas_semana??"—",r.dias_venda??"—",r.cadastros??"—",moeda(r.gasto),moeda(r.cpl)].map((v,i)=><td key={i} className="p-2">{v}</td>)}</tr>)}</tbody></table></div>
      <p>Comparáveis são imóveis da mesma cidade e tipo, publicados no período ou já à venda, sem divulgação anterior. A taxa considera os dias observados e as visitas realizadas com relatório. O gasto exige campanha dedicada a cada imóvel, com datas inteiramente dentro do período. O custo considera os cadastros validados atribuídos durante essas campanhas.</p></>}
  </section>;
}
