import Link from "next/link";
import ResumoIa from "./ResumoIa";
import type { LucideIcon } from "lucide-react";
import {
  ArrowRight, Building2, Crown, Handshake, Headset, Map as IconeMapa, Megaphone, Scale, ShieldCheck, Wallet,
} from "lucide-react";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { SETORES, setorPorId, type SetorId } from "@/lib/setores";
import { buscarTarefas } from "@/lib/central";
import Tarefas, { type Membro, type Tarefa } from "./Tarefas";
import { LINK_ACAO } from "./estilos";

/** Peças comuns aos painéis de setor da Matriz. */

/** Ícone de cada setor (o registro em lib/setores guarda só um glifo de texto). */
export const ICONE_SETOR: Record<SetorId, LucideIcon> = {
  operacoes: Building2,
  comercial: Handshake,
  financeiro: Wallet,
  juridico: Scale,
  marketing: Megaphone,
  cartografia: IconeMapa,
  suporte: Headset,
  seguranca: ShieldCheck,
  diretoria: Crown,
};

export type Indicador = {
  rotulo: string; valor: string | number; href?: string; destaque?: boolean; nota?: string;
  /** ícone opcional (lucide) */
  icone?: LucideIcon;
};

/** Números do setor: cartões com borda de acento; em dourado o que pede ação. */
export function Indicadores({ itens }: { itens: Indicador[] }) {
  return (
    <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
      {itens.map((i) => {
        const Icone = i.icone;
        const corpo = (
          <>
            <div className="flex items-start justify-between gap-3">
              {/* no celular o card tem ~150 px: "R$ 36.000" em 1,9rem passava por cima do ícone */}
              <p className={`lp-display min-w-0 break-words text-[1.5rem] sm:text-[1.9rem] leading-none tabular-nums ${i.destaque ? "text-ouro" : "text-texto"}`}>{i.valor}</p>
              {Icone && (
                <span className={`hidden sm:grid size-9 shrink-0 place-items-center rounded-full border ${i.destaque ? "border-[#D9BD6F] text-ouro" : "border-linha-forte text-verde"}`}>
                  <Icone className="size-[18px]" />
                </span>
              )}
            </div>
            <span aria-hidden className="fio-ouro mt-4 !w-6" />
            <p className="mt-2.5 text-[0.8rem] font-semibold uppercase tracking-[0.12em] text-texto-2 leading-snug">{i.rotulo}</p>
            {i.nota && <p className="mt-1 text-xs text-texto-2/80">{i.nota}</p>}
          </>
        );
        const classe = `cartao block p-5 ${i.destaque ? "!border-[#D9BD6F]" : ""}`;
        return i.href
          ? <Link key={i.rotulo} href={i.href} className={classe + " cartao-link"}>{corpo}</Link>
          : <div key={i.rotulo} className={classe}>{corpo}</div>;
      })}
    </div>
  );
}

/** Topo da página de um setor: ícone, linha "Setor", título grande e descrição. */
export function CabecalhoSetor({ setor, children }: { setor: SetorId; children?: React.ReactNode }) {
  const s = setorPorId(setor)!;
  const Icone = ICONE_SETOR[setor];
  return (
    <header className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
      <div className="flex items-start gap-4 min-w-0">
        <span className="hidden sm:grid size-14 shrink-0 place-items-center rounded-full border border-linha-forte text-verde">
          <Icone className="size-7" />
        </span>
        <div className="min-w-0 max-w-3xl">
          <p className="lp-eyebrow text-xs">Setor · {s.nome}</p>
          <h1 className="lp-display mt-3 text-3xl md:text-[2.5rem] text-verde text-balance">{s.nome}</h1>
          <p className="mt-3 text-base md:text-lg leading-relaxed text-texto-2">{s.descricao}</p>
        </div>
      </div>
      {children && <div className="flex flex-wrap gap-3 shrink-0">{children}</div>}
    </header>
  );
}

/** Seção de painel: título no padrão do site e ação à direita. */
export function Secao({ titulo, acao, children }: { titulo: string; acao?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="space-y-4">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <h2 className="lp-display text-xl md:text-2xl text-texto">{titulo}</h2>
        {acao}
      </div>
      {children}
    </section>
  );
}

/** Link de ação de seção ("Todos os imóveis →"). */
export function LinkAcao({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className={LINK_ACAO}>
      {children}<ArrowRight className="size-4" />
    </Link>
  );
}

/** "hoje" / "há N dias", em alerta a partir de 3 dias de espera. */
const diasDesde = (desde: string) => Math.floor((Date.now() - new Date(desde).getTime()) / 86_400_000);
export function Espera({ desde }: { desde: string }) {
  const d = diasDesde(desde);
  return (
    <span className={"text-xs font-medium tabular-nums whitespace-nowrap " + (d >= 3 ? "text-alerta" : "text-texto-2")}>
      {d <= 0 ? "hoje" : `há ${d} dia${d === 1 ? "" : "s"}`}
    </span>
  );
}

/**
 * Conta linhas de uma tabela com um filtro opcional — só o número, sem baixar
 * as linhas. `monta` recebe a consulta do Supabase e devolve ela filtrada.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function contar(tabela: string, monta: (q: any) => any = (q) => q): Promise<number> {
  const { count } = await monta(supabaseAdmin().from(tabela).select("*", { count: "exact", head: true }));
  return count ?? 0;
}

/** Equipe ativa (para atribuir tarefa e chamado). */
export async function equipeAtiva(): Promise<Membro[]> {
  const { data } = await supabaseAdmin()
    .from("profiles").select("user_id, nome")
    .in("role", ["admin_central", "analista_arini"]).eq("ativo", true).order("nome");
  return data ?? [];
}

/** Bloco de tarefas de um setor, já com os dados carregados. */
export async function TarefasDoSetor({ setor, souEu }: { setor: SetorId; souEu: string }) {
  const [tarefas, equipe] = await Promise.all([
    buscarTarefas((q) => q.eq("setor", setor).neq("status", "cancelada")
      .order("status").order("prazo", { ascending: true, nullsFirst: false }), 60),
    equipeAtiva(),
  ]);
  const nome = new Map(equipe.map((m) => [m.user_id, m.nome]));
  const lista: Tarefa[] = tarefas.map((t) => ({ ...t, responsavel_nome: t.responsavel ? nome.get(t.responsavel) ?? null : null }));
  return (
    <>
      <ResumoIa escopo={`setor:${setor}`} titulo="Resumo do dia do setor" />
      <Secao titulo="Tarefas do setor">
        <Tarefas setor={setor} tarefas={lista} equipe={equipe} souEu={souEu}
          setoresNome={Object.fromEntries(SETORES.map((s) => [s.id, s.nome]))} />
      </Secao>
    </>
  );
}

/**
 * Data sem hora ("2026-08-25", coluna `date`) vira meia-noite UTC no `new Date`
 * e aparecia como o dia ANTERIOR no horário de Brasília (venda em 24/08 numa
 * tela e 25/08 na outra). Ancorada ao meio-dia, cai no dia certo em qualquer fuso.
 */
export const paraData = (d: string) => new Date(/^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d}T12:00:00` : d);
export const dataBR = (d: string | null | undefined) => (d ? paraData(d).toLocaleDateString("pt-BR") : "—");
export const dataHoraBR = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "—";
