import Link from "next/link";
import { redirect } from "next/navigation";
import { ator } from "@/lib/authz";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { PedidoMunicipal, ServicoMunicipal, PainelSafras } from "@/lib/territorio-contratado";
import Balcao from "@/components/territorio/Balcao";
import Safras from "@/components/territorio/Safras";

export const dynamic="force-dynamic";
export default async function Territorio() {
  const a=await ator();if (!a) redirect("/entrar?volta=%2Fpainel%2Fterritorio");
  const modulo = a.nicho==="ente_publico"?"balcao":a.nicho==="empresa_holding"?"safras":null;
  if (!modulo) redirect("/conta/perfis");
  const db=supabaseAdmin();
  const {data:org,error}=await db.rpc("org_modulo_atual",{p_titular:a.userId,p_modulo:modulo});
  if (error) throw new Error("Não foi possível consultar o contrato.");
  if (!org) return <div className="space-y-3"><h1 className="lp-display text-3xl">Gestão territorial</h1>
    <p>Este perfil precisa de um contrato ativo para acessar o módulo.</p><Link className="underline" href={"/contato-perfil?perfil="+(modulo==="balcao"?"instituicao":"empresa")}>Falar com a equipe</Link></div>;
  if (modulo==="safras") {
    const r=await db.rpc("fn_safra_painel",{p_titular:a.userId});if (r.error) throw new Error("Não foi possível carregar as safras.");
    return <main className="space-y-5"><h1 className="lp-display text-4xl">Fornecedores e safras</h1><Safras painel={r.data as PainelSafras}/></main>;
  }
  const [servicos,pedidos,membro]=await Promise.all([db.rpc("fn_balcao_servicos",{p_gestor:a.userId}),
    db.rpc("fn_balcao_pedidos",{p_titular:a.userId,p_interno:true}),
    db.from("organization_members").select("papel_org").eq("user_id",a.userId).eq("org_id",org).eq("status","ativo").single()]);
  if (servicos.error||pedidos.error||membro.error) throw new Error("Não foi possível carregar os protocolos.");
  return <main className="space-y-4"><h1 className="lp-display text-4xl">Balcão do município</h1>
    <Link href="/balcao" className="underline">Abrir o balcão do solicitante</Link>
    <Balcao interno gestor={membro.data?.papel_org==="admin"} servicos={servicos.data as ServicoMunicipal[]} pedidos={pedidos.data as PedidoMunicipal[]}/></main>;
}