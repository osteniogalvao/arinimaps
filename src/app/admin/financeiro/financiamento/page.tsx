import { exigirSetor } from "@/lib/setores-servidor";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { lerEmLotes } from "@/lib/supabase/lotes";
import { estadoLegivel } from "@/lib/financiamento";
import FormFin from "./FormFin";
export default async function ConfigurarFin() {
  await exigirSetor("financeiro");
  const db=supabaseAdmin();
  const [regioes,titulares,linhas,vagas,funil]=await Promise.all([
    lerEmLotes((de,ate)=>db.from("regions").select("id,nome").eq("ativa",true).order("nome").order("id").range(de,ate),{maximo:Infinity}),
    lerEmLotes((de,ate)=>db.from("profiles").select("user_id,nome").eq("ativo",true).eq("nicho","correspondente_bancario").order("nome").order("user_id").range(de,ate),{maximo:Infinity}),
    lerEmLotes((de,ate)=>db.from("fin_linhas").select("id,nome,banco,inicio,fim,ativo").eq("ativo",true).order("banco").order("id").range(de,ate),{maximo:Infinity}),
    lerEmLotes((de,ate)=>db.from("fin_vagas").select("id,banco,identificacao,prioridade,regiao:regions(nome)").eq("ativo",true).order("banco").order("id").range(de,ate),{maximo:Infinity}),
    db.rpc("fin_resumo_central"),
  ]);
  if(regioes.error || titulares.error || linhas.error || vagas.error || funil.error) throw Error("Não foi possível consultar o módulo de financiamento.");
  const registros=[...linhas.data.map(l=>({id:l.id,tipo:"linha",rotulo:`${l.banco} · ${l.nome} · ${l.inicio} a ${l.fim}`})),
    ...vagas.data.map(v=>({id:v.id,tipo:"vaga",rotulo:`${v.banco} · ${(v.regiao as unknown as {nome:string})?.nome} · ${v.identificacao} · prioridade ${v.prioridade}`}))];
  const resumo=funil.data as {banco:string;regiao:string;estado:string;quantidade:number;atrasados:number;alertas:number}[];
  return <main className="max-w-5xl space-y-6"><h1 className="lp-display text-3xl">Financiamento de imóveis</h1>
    <section className="cartao p-5"><h2 className="lp-display text-xl">Funil por banco e região</h2>
      {resumo.length ? <ul>{resumo.map(r=><li className="border-b border-linha py-2" key={[r.banco,r.regiao,r.estado].join("-")}>{r.banco} · {r.regiao} · {estadoLegivel(r.estado)} · {r.quantidade} atendimento(s){r.atrasados>0 && ` · ${r.atrasados} em atraso`}{r.alertas>0 && ` · ${r.alertas} próximos do prazo`}</li>)}</ul> : <p>Nenhuma simulação registrada.</p>}
    </section>
    <FormFin registros={registros} regioes={regioes.data} titulares={titulares.data}/>
  </main>;
}

