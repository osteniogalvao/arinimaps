import Link from "next/link";
import { redirect } from "next/navigation";
import { sessaoEscritorio } from "@/lib/crm-escritorio-servidor";
import type { EspacoEscritorio, Membro } from "@/lib/crm-escritorio";
import { CAMPO } from "@/components/ui/Pagina";
import { excluirRegistro } from "./acoes";

export const CAMPO_P = CAMPO.replace("px-4 py-3", "px-3 py-2");
export const BOTAO = "inline-flex min-h-10 items-center justify-center rounded-xl border border-linha px-3 py-2 text-sm font-medium hover:border-verde";
export const BOTAO_VERDE = "btn-verde inline-flex min-h-10 items-center justify-center rounded-xl px-4 py-2 text-sm font-semibold";

/** Abre a sessão do escritório ou mostra por que não abriu. */
export async function abrirEscritorio() {
  const s = await sessaoEscritorio();
  if (s.status === 401) redirect("/entrar?volta=/painel/escritorio");
  return s;
}

export function SemEscritorio({ status }: { status: 401 | 403 | 503 }) {
  return <section className="space-y-3">
    <h1 className="text-3xl font-semibold">Escritório</h1>
    {status === 503
      ? <p role="alert">O CRM do escritório está sendo ativado. Tente novamente em alguns minutos.</p>
      : <>
        <p>O CRM do escritório (carteira de imóveis, clientes e proprietários, funil, agenda e relatórios) faz parte dos planos
          Essencial, Profissional e Premium de corretor e de profissional técnico. Os planos Profissional e Premium compartilham
          o escritório com a equipe da organização.</p>
        <p className="text-sm text-texto-2">Se você já contratou, confira se o pagamento foi confirmado em Meus pedidos e se a verificação em duas etapas da sessão está concluída.</p>
        <div className="flex flex-wrap gap-2"><Link className={BOTAO_VERDE} href="/planos?perfil=corretor">Ver planos</Link>
          <Link className={BOTAO} href="/planos/solicitacoes">Meus pedidos</Link></div>
      </>}
  </section>;
}

const ABAS = [
  { href: "/painel/escritorio", rotulo: "Funil", chave: "funil" },
  { href: "/painel/escritorio/agenda", rotulo: "Agenda", chave: "agenda" },
  { href: "/painel/escritorio/imoveis", rotulo: "Imóveis", chave: "imoveis" },
  { href: "/painel/escritorio/pessoas", rotulo: "Clientes e proprietários", chave: "pessoas" },
  { href: "/painel/escritorio/relatorios", rotulo: "Relatórios", chave: "relatorios" },
  { href: "/painel/escritorio/historico", rotulo: "Histórico", chave: "historico" },
] as const;

export function CabecalhoEscritorio({ espaco, ativa, titulo, subtitulo }: {
  espaco: EspacoEscritorio; ativa: (typeof ABAS)[number]["chave"]; titulo: string; subtitulo?: string;
}) {
  const abas = ABAS.filter((a) => a.chave !== "historico" || espaco.auditoria);
  return <header className="mb-6 space-y-4">
    <div>
      <p className="text-sm text-texto-2">{espaco.equipe ? `Escritório ${espaco.nome} · equipe` : "Meu escritório"}</p>
      <h1 className="text-3xl font-semibold">{titulo}</h1>
      {subtitulo && <p className="mt-1 text-texto-2">{subtitulo}</p>}
    </div>
    <nav aria-label="Seções do escritório" className="flex gap-2 overflow-x-auto [scrollbar-width:none]">
      {abas.map((a) => <Link key={a.chave} href={a.href} aria-current={a.chave === ativa ? "page" : undefined}
        className={`shrink-0 whitespace-nowrap rounded-full border px-4 py-2 text-sm ${a.chave === ativa ? "border-verde bg-verde/10 font-semibold" : "border-linha hover:border-verde"}`}>
        {a.rotulo}</Link>)}
    </nav>
  </header>;
}

const OK: Record<string, string> = {
  pessoa: "Cadastro salvo.", imovel: "Imóvel salvo.", negocio: "Negócio salvo.", compromisso: "Compromisso salvo na agenda.", excluido: "Registro excluído.",
};
const ERRO: Record<string, string> = {
  nome: "Informe o nome.", titulo: "Informe o título.", data: "Informe o título e a data e hora de início.",
  responsavel: "O responsável precisa ser da equipe do escritório.", vinculo: "O vínculo escolhido não é deste escritório.",
  sem_acesso: "Seu plano não permite esta alteração.", excluir: "Só quem criou o registro ou o administrador do escritório pode excluir.",
  invalido: "Não foi possível salvar. Confira os campos e tente novamente.",
};
export function Avisos({ sp }: { sp: Record<string, string | string[] | undefined> }) {
  const ok = typeof sp.ok === "string" ? OK[sp.ok] : null;
  const erro = typeof sp.erro === "string" ? ERRO[sp.erro] ?? ERRO.invalido : null;
  if (!ok && !erro) return null;
  return <p role={erro ? "alert" : "status"} className={`mb-4 rounded-xl border px-4 py-3 text-sm ${erro ? "border-critico/40 text-critico" : "border-verde/40 text-verde"}`}>{erro ?? ok}</p>;
}

export function CampoResponsavel({ membros, valor, equipe }: { membros: Membro[]; valor?: string | null; equipe: boolean }) {
  if (!equipe) return null;
  return <label className="grid gap-1 text-sm">Responsável
    <select name="responsavel" defaultValue={valor ?? ""} className={CAMPO_P}>
      <option value="">Eu</option>
      {membros.map((m) => <option key={m.user_id} value={m.user_id}>{m.nome}</option>)}
    </select></label>;
}

export function BotaoExcluir({ tipo, id, volta }: { tipo: "pessoa" | "imovel" | "negocio" | "compromisso"; id: string; volta: string }) {
  return <form action={excluirRegistro}>
    <input type="hidden" name="tipo" value={tipo} /><input type="hidden" name="id" value={id} /><input type="hidden" name="_volta" value={volta} />
    <button className="text-sm text-critico underline">Excluir</button>
  </form>;
}

export type Parametros = Record<string, string | string[] | undefined>;
export const umParam = (sp: Parametros, k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
