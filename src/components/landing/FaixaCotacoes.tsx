/**
 * Faixa de cotações do agro no topo do site (itens 1.2.1 e 1.2.2 da revisão).
 * Os valores chegam prontos do servidor (SiteHeader → cache do banco); aqui é
 * só CSS: a lista vai duas vezes e a animação anda meia largura, como a
 * FontesMarquee. Pausa com o mouse em cima ou com foco num item e para com
 * `prefers-reduced-motion` (regras de `.lp-marquee` no globals.css).
 *
 * Cada cotação é um link para a página dela em /mercado (gráfico, histórico e
 * busca). Antes a faixa inteira era um link só, e quem queria ver o boi gordo
 * caía na série em destaque (vídeo do Carlos, 10/11/2026: "aqui a pessoa não
 * tem como clicar (...) eu quero o clicável, que abra uma aba própria").
 *
 * 17/11: além da variação do dia, cada item mostra a de 30 dias e uma
 * minilinha dos últimos fechamentos; no fim, o atalho para receber as
 * cotações pelo WhatsApp (atendimento automático, comando COTAÇÕES).
 */

import Link from "next/link";
import { ArrowDownRight, ArrowRight, ArrowUpRight, MessageCircle, Minus } from "lucide-react";
import {
  type CotacaoFaixa, formatarValor, formatarVariacao, rotuloFaixa, sentido,
} from "@/lib/mercado/formato";

// cores fixas: a faixa é sempre escura (Verde Profundo), nos dois temas
const COR = { alta: "text-[#7FC29F]", baixa: "text-[#FF8F80]", estavel: "text-white/55" } as const;

function Variacao({ v }: { v: number | null }) {
  if (v == null) return null;
  const s = sentido(v);
  const Seta = s === "alta" ? ArrowUpRight : s === "baixa" ? ArrowDownRight : Minus;
  return (
    <span className={`inline-flex items-center gap-0.5 font-semibold tabular-nums ${COR[s]}`}>
      <Seta className="size-3.5" aria-hidden />
      <span className="sr-only">{s === "alta" ? "alta de" : s === "baixa" ? "queda de" : "estável,"}</span>
      {formatarVariacao(v)}
    </span>
  );
}

const TRACO = { alta: "#7FC29F", baixa: "#FF8F80", estavel: "rgba(255,255,255,.45)" } as const;

/** Minilinha dos últimos fechamentos, na cor do sentido do período. */
function Linha({ valores }: { valores: number[] }) {
  if (valores.length < 3) return null;
  const min = Math.min(...valores), max = Math.max(...valores), faixa = max - min || 1;
  const pts = valores.map((v, i) => `${((i / (valores.length - 1)) * 40).toFixed(1)},${(13 - ((v - min) / faixa) * 12).toFixed(1)}`).join(" ");
  const s = sentido((valores[valores.length - 1] / valores[0] - 1) * 100);
  return (
    <svg viewBox="0 0 40 14" className="hidden h-3.5 w-10 self-center sm:block" aria-hidden>
      <polyline points={pts} fill="none" stroke={TRACO[s]} strokeWidth="1.4" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function Lista({ itens, oculta = false }: { itens: CotacaoFaixa[]; oculta?: boolean }) {
  return (
    <ul className="flex shrink-0 items-center" aria-hidden={oculta || undefined}>
      {itens.map((c) => (
        <li key={c.id} className="flex shrink-0 items-center">
          {/* a cópia que só existe para o carrossel emendar fica fora da ordem do Tab */}
          <Link
            href={`/mercado?serie=${encodeURIComponent(c.slug)}`}
            tabIndex={oculta ? -1 : undefined}
            title={`Ver ${rotuloFaixa(c)}: gráfico, histórico e outras praças`}
            className="flex items-baseline gap-2 whitespace-nowrap rounded-md px-4 py-1 outline-none transition-colors hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-[#D9BD6F] md:px-5"
          >
            <span className="font-semibold text-white/90">{rotuloFaixa(c)}</span>
            <span className="tabular-nums text-white">
              {c.unidade.startsWith("R$") ? "R$ " : ""}
              {formatarValor(c.valor, c.casas)}
            </span>
            <span className="text-xs text-white/50">{c.unidade.startsWith("R$/") ? c.unidade.slice(2) : c.unidade === "pontos" ? "pts" : c.unidade}</span>
            <Variacao v={c.variacao} />
            <Linha valores={c.linha} />
            {c.variacao30 != null && (
              <span className="text-xs tabular-nums text-white/55">
                30d <span className={COR[sentido(c.variacao30)]}>{formatarVariacao(c.variacao30)}</span>
              </span>
            )}
          </Link>
          <span className="mx-1 h-3 w-px self-center bg-white/15" aria-hidden />
        </li>
      ))}
    </ul>
  );
}

export default function FaixaCotacoes({ itens, whatsapp }: { itens: CotacaoFaixa[]; whatsapp?: string }) {
  // ~6 s por item: dá para ler sem pressa
  const duracao = `${Math.max(28, itens.length * 7)}s`;
  const wa = whatsapp?.replace(/\D/g, "");
  return (
    <div className="lp-marquee-grupo group lp-container flex h-10 items-center gap-4 text-[13px] text-white/85 md:text-sm">
      <Link
        href="/mercado"
        className="hidden shrink-0 rounded-md text-[11px] font-semibold uppercase tracking-[0.14em] text-[#D9BD6F] outline-none hover:text-white focus-visible:ring-2 focus-visible:ring-[#D9BD6F] sm:inline"
      >
        Cotações
      </Link>
      <div className="relative min-w-0 flex-1 overflow-hidden [mask-image:linear-gradient(90deg,transparent,#000_5%,#000_95%,transparent)]">
        {/* com o mouse em cima ou o foco num item, a faixa para: dá para mirar e clicar */}
        <div
          className="lp-marquee flex w-max items-center group-focus-within:[animation-play-state:paused]"
          style={{ ["--lp-marquee-dur" as string]: duracao }}
        >
          <Lista itens={itens} />
          <Lista itens={itens} oculta />
        </div>
      </div>
      {wa && (
        <a
          href={`https://wa.me/${wa}?text=${encodeURIComponent("COTAÇÕES")}`}
          target="_blank"
          rel="noopener noreferrer"
          title="Receba as cotações do dia no WhatsApp, com resposta automática"
          className="flex shrink-0 items-center gap-1.5 rounded-md text-[#7FC29F] outline-none transition hover:text-white focus-visible:ring-2 focus-visible:ring-[#D9BD6F]"
        >
          <MessageCircle className="size-3.5" aria-hidden />
          <span className="hidden lg:inline">No WhatsApp</span>
          <span className="sr-only lg:hidden">Receber as cotações no WhatsApp</span>
        </a>
      )}
      <Link
        href="/mercado"
        className="group/todas flex shrink-0 items-center gap-1.5 rounded-md text-white/60 outline-none transition hover:text-white focus-visible:ring-2 focus-visible:ring-[#D9BD6F]"
      >
        <span className="hidden md:inline">Consulte todas as cotações</span>
        <span className="md:hidden">Todas<span className="sr-only"> as cotações</span></span>
        <ArrowRight className="size-3.5 transition-transform group-hover/todas:translate-x-0.5 motion-reduce:transition-none" aria-hidden />
      </Link>
    </div>
  );
}
