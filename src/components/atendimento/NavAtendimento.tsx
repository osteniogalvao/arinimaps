import Link from "next/link";
import { BarChart3, BookOpen, Bot, Inbox, Settings, Users, Zap } from "lucide-react";

/**
 * Abas do Atendimento, na ordem do menu do atendimento da Arini Negócios:
 * Conversas, Contatos, Macros, Agentes IA, Central de Ajuda, Relatórios e
 * Configurações. Relatórios só para quem faz triagem; Macros (editar),
 * Agentes IA e Configurações só para a Diretoria.
 */
export default function NavAtendimento({ atual, triagem, diretoria }: {
  atual: "conversas" | "contatos" | "macros" | "agentes" | "ajuda" | "relatorios" | "configurar";
  triagem: boolean; diretoria: boolean;
}) {
  const itens = [
    { id: "conversas", href: "/admin/atendimento", rotulo: "Conversas", icone: Inbox, ok: true },
    { id: "contatos", href: "/admin/atendimento/contatos", rotulo: "Contatos", icone: Users, ok: true },
    { id: "macros", href: "/admin/atendimento/macros", rotulo: "Macros", icone: Zap, ok: true },
    { id: "agentes", href: "/admin/atendimento/agentes-ia", rotulo: "Agentes IA", icone: Bot, ok: diretoria },
    { id: "ajuda", href: "/admin/atendimento/ajuda", rotulo: "Central de Ajuda", icone: BookOpen, ok: true },
    { id: "relatorios", href: "/admin/atendimento/relatorios", rotulo: "Relatórios", icone: BarChart3, ok: triagem },
    { id: "configurar", href: "/admin/atendimento/configurar", rotulo: "Configurações", icone: Settings, ok: diretoria },
  ].filter((i) => i.ok);
  return (
    <nav aria-label="Atendimento" className="-mx-1 flex gap-1 overflow-x-auto pb-1">
      {itens.map((i) => (
        <Link key={i.id} href={i.href} aria-current={i.id === atual ? "page" : undefined}
          className={"inline-flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-semibold transition-colors "
            + (i.id === atual ? "bg-verde text-white" : "text-texto-2 hover:bg-superficie-2 hover:text-texto")}>
          <i.icone className="size-4" /> {i.rotulo}
        </Link>
      ))}
    </nav>
  );
}
