import Link from "next/link";
import { redirect } from "next/navigation";
import { ator } from "@/lib/authz";
import { supabaseAdmin } from "@/lib/supabase/admin";
import Contrato from "./Contrato";

export default async function Contratos() {
  const a = await ator();
  if (a?.role !== "admin_central") redirect("/admin");
  const db = supabaseAdmin();
  const [orgs, modulos] = await Promise.all([
    db.from("organizations").select("id,nome,tipo").in("tipo", ["ente_publico","empresa","holding"]).order("nome"),
    db.from("org_modulos_contratados").select("org_id,modulo,territorio,referencia,ativo,revisao"),
  ]);
  if (orgs.error || modulos.error) throw new Error("Falha ao consultar os contratos.");
  return <main className="space-y-5"><Link className="underline" href="/admin/organizacoes">Organizações</Link>
    <h1 className="lp-display text-3xl">Módulos por contrato</h1>
    <p className="max-w-3xl text-texto-2">A ativação libera o módulo aos membros da organização com plano vigente. O território informado identifica a implantação.</p>
    {!orgs.data.length && <p>Cadastre a organização para vincular um contrato.</p>}
    {orgs.data.map(o=>{const modulo=o.tipo==="ente_publico"?"balcao":"safras";return <Contrato key={o.id} org={o.id} nome={o.nome} modulo={modulo} atual={modulos.data.find(c=>c.org_id===o.id && c.modulo===modulo)}/>;})}
  </main>;
}
