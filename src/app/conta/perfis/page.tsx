import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/supabase/server";
import { PERSONAS_PLANOS } from "@/lib/planos";
import { ehEquipe } from "@/lib/perfis";
import { supabaseAdmin } from "@/lib/supabase/admin";
import Escolha from "./Escolha";
import { situacaoPiloto, chamadaPiloto } from "@/lib/divulgacao";

export default async function Perfis() {
  const u = await currentUser();
  if (!u) redirect("/entrar?volta=/conta/perfis");
  if (ehEquipe(u.role) || u.role==="franqueado") redirect("/conta");
  const db = supabaseAdmin();
  const piloto = await situacaoPiloto(u.id);
  const [{data:p},{data:s},balcao,safras] = await Promise.all([db.from("profiles").select("entrada_ativa").eq("user_id",u.id).single(),
    db.from("conta_contextos").select("nicho").eq("titular",u.id),
    db.rpc("org_contexto_contratado",{p_titular:u.id,p_modulo:"balcao"}),
    db.rpc("org_contexto_contratado",{p_titular:u.id,p_modulo:"safras"})]);
  return <main className="mx-auto w-full max-w-5xl px-5 py-12">
    <Link href="/conta" className="text-sm text-verde underline">Minha conta</Link>
    <h1 className="lp-display my-5 text-3xl sm:text-4xl">Como você deseja utilizar a ARINI?</h1>
    <p className="mb-6 text-texto-2">Escolha um perfil para trabalhar. Você pode voltar aqui para trocar ou adicionar outro.</p>
    <Escolha atual={p?.entrada_ativa ?? null} nicho={u.nicho} anteriores={[...(s??[]).map(x=>x.nicho), ...(balcao.data?["ente_publico"]:[]), ...(safras.data?["empresa_holding"]:[])]} entradas={PERSONAS_PLANOS.map(x=>({id:x.id,nome:x.nome,chamada:x.chamada,nicho:x.nichos[0],acaoPiloto:x.id==="divulgador"?chamadaPiloto(piloto):undefined}))}/>
  </main>;
}
