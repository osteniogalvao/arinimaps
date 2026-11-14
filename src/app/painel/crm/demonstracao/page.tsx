import Link from "next/link";
import { redirect } from "next/navigation";
import { ator } from "@/lib/authz";
import { CabecalhoPagina } from "@/components/ui/Pagina";
import SimularAtendimento from "./SimularAtendimento";

export default async function Demonstracao() {
  const a = await ator();
  if (!a) redirect("/entrar?volta=/painel/crm/demonstracao");
  if (a.nicho !== "engenheiro" || a.acesso.planId !== "tecnico_teste" || a.acesso.vencido || !a.acesso.recursos.has("consulta_area")) {
    return <Link href="/planos?perfil=tecnico#planos">Consultar os planos para profissionais técnicos</Link>;
  }
  return <><CabecalhoPagina titulo="Demonstração do CRM técnico" subtitulo="Experimente o fluxo de um atendimento com um cliente fictício. As alterações duram até você sair desta página." /><SimularAtendimento /></>;
}
