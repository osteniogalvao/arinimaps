import Link from "next/link";
import { redirect } from "next/navigation";
import { ator, temSetor } from "@/lib/authz";
import { botaoDiv, caixaDiv, campoDiv, nomesEstado } from "@/lib/divulgacao";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { decifrar } from "@/lib/seguranca/cripto";
import { configurar, definirFaixa, revisar } from "@/app/(public)/divulgador/acoes";
import Catalogo from "./Catalogo";
import { Comparativo } from "./Regras";

type Busca=Promise<{aviso?:string;pagina?:string;catalogo?:string;estado?:string;inicio?:string;fim?:string}>;
export default async function Divulgadores({searchParams}:{searchParams:Busca}) {
  const a=await ator();if(!a||!temSetor(a,"marketing")) redirect("/conta");
  const sp=await searchParams, db=supabaseAdmin();
  const pagina=Math.max(1,Math.trunc(Number(sp.pagina)||1)), filtro=Object.hasOwn(nomesEstado,sp.estado??"")?sp.estado:"analise";
  let query=db.from("divulgacao_cadastros").select("titular,estado,instagram,cnpj,regiao,seguidores,faixa_manual,verificado_em,motivo,criado_em,profiles!inner(nome)",{count:"exact"}).eq("estado",filtro);
  query=query.order("criado_em").order("titular").range((pagina-1)*25,pagina*25-1);
  const [cfg,lista,resultado,faixas]=await Promise.all([db.from("divulgacao_piloto").select("*").eq("id",true).single(),query,db.rpc("divulgacao_resultados",{p_ator:a.userId}).limit(25),db.from("divulgacao_faixas").select("id,seguidores_min").order("seguidores_min")]);
  if(cfg.error||lista.error||resultado.error||faixas.error)throw Error("Não foi possível carregar o piloto de divulgadores.");
  const ranking=(resultado.data??[]) as {titular:string,instagram:string|null,cliques:number,cadastros:number,visitas:number,vendas:number}[];
  const c=cfg.data;
  return <div className="space-y-6"><h1 className="lp-display text-3xl">Programa de divulgadores</h1>
    {sp.aviso && <p role="status" className={caixaDiv}>{sp.aviso}</p>}
    {a.role==="admin_central"&&<form action={configurar} className={caixaDiv}>
      <h2 className="text-xl font-semibold">Configuração do piloto</h2>
      <label className="flex gap-2"><input type="checkbox" name="aberto" defaultChecked={c.aberto}/>Abrir piloto para participantes aprovados e novas inscrições</label>
      <div className="grid gap-3 md:grid-cols-3">
      {([["participantes","Máximo de participantes",c.participantes_max],["imoveis","Máximo de imóveis",c.imoveis_max],["seguidores","Mínimo de seguidores",c.seguidores_min]] as const).map(([key,text,initial])=><label key={key}>{text}<input className={campoDiv} name={key} type="number" min="0" required defaultValue={initial}/></label>)}</div>
      <label className="block">Janela de atribuição em dias<input className={campoDiv} name="atribuicao" type="number" min={1} max={365} required defaultValue={c.atribuicao_dias}/></label>
      <label className="block">Intervalo entre conferências de seguidores, em dias<input className={campoDiv} name="revisao" type="number" min={1} max={365} required defaultValue={c.revisao_dias}/></label>
      <button className={botaoDiv}>Salvar configuração</button></form>}
    {ranking.length>0&&<section className={caixaDiv}><h2 className="text-xl font-semibold">Desempenho por divulgador</h2>
      <div className="overflow-x-auto"><table className="w-full text-left"><thead><tr>{["Perfil","Cliques únicos","Cadastros validados","Visitas realizadas","Vendas"].map(t=><th key={t} className="p-2">{t}</th>)}</tr></thead>
        <tbody>{ranking.map(r=><tr key={r.titular} className="border-t border-linha"><th scope="row" className="p-2">@{r.instagram}</th>{[r.cliques,r.cadastros,r.visitas,r.vendas].map((v,i)=><td key={i} className="p-2">{v}</td>)}</tr>)}</tbody></table></div></section>}
    <section className={caixaDiv}><h2 className="text-xl font-semibold">Inscrições</h2>
    <nav aria-label="Estado da inscrição" className="flex flex-wrap gap-4">{Object.entries(nomesEstado).map(([id,nome])=><Link key={id} className={id===filtro?"font-bold":"text-verde underline"} href={"?estado="+id}>{nome}</Link>)}</nav>
    {!lista.data?.length && <p>Nenhuma inscrição neste estado.</p>}
    {lista.data?.map(row=>{const perfil=Array.isArray(row.profiles)?row.profiles[0]:row.profiles;
      return <article key={row.titular} className="border-t border-linha py-4"><h3 className="font-bold">{perfil?.nome??"Conta cadastrada"}</h3>
      <p>{row.instagram&&("@"+row.instagram+" · ")}{row.regiao} {row.cnpj&&("· CNPJ "+(decifrar(row.cnpj)??"indisponível"))}</p>
      {row.motivo && <p>{row.motivo}</p>}
      {row.estado!=="espera" && <form action={revisar} className="mt-3 space-y-3">
        <input type="hidden" name="titular" value={row.titular}/>
        {row.estado==="ativo"&&<input type="hidden" name="operacao" value="reavaliar"/>}
        {["analise","ativo"].includes(row.estado) && <><label className="block">Seguidores verificados<input name="seguidores" defaultValue={row.seguidores??""} type="number" min="0" className={campoDiv}/></label>
        {row.verificado_em&&<p>Última conferência em {new Date(row.verificado_em).toLocaleDateString("pt-BR",{timeZone:"America/Sao_Paulo"})}.</p>}
        <label className="flex items-start gap-2"><input type="checkbox" name="conferido"/>Conferi o perfil público, a audiência regional, o engajamento, indícios de seguidores artificiais e o cadastro fiscal.</label></>}
        <label className="block">Justificativa da decisão<input name="motivo" className={campoDiv} maxLength={500}/></label>
        <div className="flex flex-wrap gap-3">{row.estado==="analise"?<><button className={botaoDiv} name="estado" value="ativo">Aprovar</button><button name="estado" value="recusado" className="underline">Recusar</button></>
        :row.estado==="ativo"?<><button name="estado" value="ativo" className={botaoDiv}>Registrar reavaliação</button><button name="estado" value="suspenso" className="underline">Suspender</button></>:<button name="estado" value="espera" className="underline">Permitir nova inscrição</button>}</div>
      </form>}
      {row.estado==="ativo"&&<details className="mt-4"><summary className="font-semibold">Ajuste manual da faixa</summary><form className="space-y-2" action={definirFaixa}>
        <input type="hidden" name="titular" value={row.titular}/><label>Modo de classificação<select name="faixa" className={campoDiv} defaultValue={row.faixa_manual??""}><option value="">Contagem e desempenho automáticos</option>
          {faixas.data.map(f=><option key={f.id} value={f.id}>Fixar na faixa de {f.seguidores_min} seguidores</option>)}</select></label>
        <label>Justificativa<input className={campoDiv} name="motivo" required minLength={3} maxLength={500}/></label><button className={botaoDiv}>Registrar decisão</button></form></details>}</article>})}
      <nav className="flex gap-4">{pagina>1&&<Link href={`?estado=${filtro}&pagina=${pagina-1}`}>Anterior</Link>}{pagina*25<(lista.count??0)&&<Link href={`?estado=${filtro}&pagina=${pagina+1}`}>Próxima</Link>}</nav>
    </section><Catalogo diretoria={a.role==="admin_central"} filaMax={c.fila_max} horas={c.chamada_horas} pagina={Math.max(1,Math.trunc(Number(sp.catalogo)||1))}/>
    <Comparativo ator={a.userId} inicio={sp.inicio} fim={sp.fim}/></div>;
}
