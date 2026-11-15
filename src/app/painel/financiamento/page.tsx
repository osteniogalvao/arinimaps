import Link from "next/link";
import { redirect } from "next/navigation";
import { ator } from "@/lib/authz";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { estadoLegivel } from "@/lib/financiamento";

export default async function Financiamentos({searchParams}:{searchParams:Promise<{pagina?:string}>}) {
  const a=await ator();
  if (!a) redirect("/entrar?volta=/painel/financiamento");
  const db=supabaseAdmin();
  const pg=Math.max(1,Math.min(100000,Math.floor(Number((await searchParams).pagina)||1)));
  const inicio=(pg-1)*25;
  const [cliente,crm] = await Promise.all([
    db.from("fin_simulacoes").select("id,criada_em,espelho").eq("cliente_id",a.userId).order("criada_em",{ascending:false}).order("id").range(inicio,inicio+25),
    a.nicho==="correspondente_bancario" ? db.from("fin_atendimentos").select("id,estado,nome,prazo_contato,primeiro_contato,consentido_em,vaga:fin_vagas!inner(titular_id,ativo)")
      .eq("vaga.titular_id",a.userId).eq("vaga.ativo",true).is("revogado_em",null).order("consentido_em",{ascending:false}).order("id").range(inicio,inicio+25) : Promise.resolve(null),
  ]);
  if(cliente.error || crm?.error) throw Error("Não foi possível consultar os financiamentos.");
  return <main className="space-y-6"><h1 className="lp-display text-3xl">Financiamento</h1>
    {crm && <section className="cartao space-y-3 p-5"><h2 className="lp-display text-xl">CRM da correspondente</h2>
      {crm.data.slice(0,25).map(c=><Link key={c.id} className="block text-verde" href={`/painel/financiamento/${c.id}`}>
        {c.nome} · {estadoLegivel(c.estado)}{!c.primeiro_contato && new Date(c.prazo_contato)<new Date() ? " · Prazo de contato excedido" : ""}</Link>)}
      {!crm.data.length && <p>Nenhum atendimento autorizado nesta página.</p>}
    </section>}
    <section className="cartao space-y-3 p-5"><h2 className="lp-display text-xl">Minhas simulações e documentos</h2>
      {cliente.data.slice(0,25).map(s=><Link key={s.id} className="block text-verde" href={`/painel/financiamento/${s.id}`}>
        {s.espelho.titulo} · {s.espelho.banco} · {new Date(s.criada_em).toLocaleDateString("pt-BR")}</Link>)}
      {!cliente.data.length && <p>Você pode simular nas fichas dos imóveis que aceitam financiamento.</p>}
    </section>
    <nav className="flex gap-5">{pg>1 && <Link href={`?pagina=${pg-1}`}>Anterior</Link>}{(cliente.data.length>25 || (crm?.data.length??0)>25) && <Link href={`?pagina=${pg+1}`}>Próxima</Link>}</nav>
  </main>;
}

