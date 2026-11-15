import Link from "next/link";
import { redirect } from "next/navigation";
import { ator } from "@/lib/authz";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ETAPA_LABEL } from "@/lib/funil";
import { formatBRL } from "@/lib/format";

export default async function Interesses({searchParams}:{searchParams:Promise<{pagina?:string}>}) {
  const a=await ator();if(!a) redirect("/entrar?volta=/painel/interesses");
  const pagina=Math.max(1,Math.min(100000,Math.trunc(Number((await searchParams).pagina)||1)));
  const db=supabaseAdmin();
  const {data,error}=await db.from("opportunities")
    .select("id,codigo,etapa,created_at,protecao_ate,imovel:properties(codigo,titulo),visitas:visits(data_hora,status),propostas:proposals(valor,status,numero_rodada)")
    .eq("comprador_profile_id",a.userId).order("created_at",{ascending:false}).order("id").range((pagina-1)*20,pagina*20);
  if(error) throw Error("Não foi possível consultar seus interesses.");
  return <main className="space-y-5"><h1 className="lp-display text-3xl">Meus interesses</h1>
    {data.slice(0,20).map(o=>{const im=o.imovel as unknown as {codigo:string;titulo:string}|null;return <section key={o.id} className="cartao space-y-2 p-5">
      <h2 className="lp-display text-xl">{im?.titulo??o.codigo}</h2><p>{o.codigo} · {ETAPA_LABEL[o.etapa]??o.etapa} · {new Date(o.created_at).toLocaleDateString("pt-BR")}</p>
      {o.protecao_ate && <p>Proteção do interesse até {new Date(o.protecao_ate).toLocaleDateString("pt-BR")}</p>}
      {o.visitas.map((v,i)=><p key={i}>Visita {new Date(v.data_hora).toLocaleString("pt-BR")} · {v.status}</p>)}
      {o.propostas.map((p,i)=><p key={i}>Proposta {p.numero_rodada} · {formatBRL(p.valor)} · {p.status}</p>)}
      {im && <Link href={`/imovel/${im.codigo}`} className="text-verde">Ficha do imóvel</Link>}
    </section>;})}
    {!data.length && <p>Os imóveis em que você registrar interesse aparecerão aqui.</p>}
    <nav className="flex gap-4">{pagina>1 && <Link href={`?pagina=${pagina-1}`}>Anterior</Link>}{data.length>20 && <Link href={`?pagina=${pagina+1}`}>Próxima</Link>}</nav>
  </main>;
}

