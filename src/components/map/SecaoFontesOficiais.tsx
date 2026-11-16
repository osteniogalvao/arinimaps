import Link from "next/link";
import FontesLista, { type FonteConsultada } from "@/components/rural/FontesLista";
import BotaoConsultarArea from "@/components/map/BotaoConsultarArea";
import type { Acesso } from "@/lib/planos";
import { ArrowRight, Info, Lock, LogIn } from "lucide-react";

/**
 * Seção "Informações territoriais" das páginas de consulta (CAR, lote, área
 * desenhada): botão de consultar conforme conta/plano/cota, a lista por fonte e
 * os avisos que não podem faltar (fonte não consultada ≠ ausência de restrição).
 */
export default function SecaoFontesOficiais({
  url, corpo, descricao, logado, podeConsultar, acesso, cotaRestante, lista, pendentes, jaConsultou, raioM, alvo = "a área",
}: {
  url: string;
  corpo?: unknown;
  descricao: string;
  logado: boolean;
  podeConsultar: boolean;
  acesso: Acesso;
  cotaRestante: number | null;
  lista: FonteConsultada[];
  pendentes: string[];
  jaConsultou: boolean;
  raioM: number;
  alvo?: string;
}) {
  return (
    <section className="space-y-6">
      <div className="flex items-end justify-between gap-5 flex-wrap">
        <div className="min-w-0">
          <p className="lp-eyebrow text-xs">Fontes oficiais</p>
          <h2 className="lp-display mt-2 text-2xl md:text-[1.75rem] text-texto">Informações territoriais</h2>
          <p className="mt-2 text-base leading-relaxed text-texto-2 max-w-2xl">{descricao}</p>
        </div>
        {!logado ? (
          <Link href="/entrar" className="btn-verde inline-flex items-center gap-2 px-5 py-3 text-sm"><LogIn className="size-4" /> Entre para consultar</Link>
        ) : !podeConsultar ? (
          <div className="text-right text-sm space-y-1.5 max-w-80">
            <p className="flex items-center justify-end gap-1.5 font-semibold text-texto"><Lock className="size-4 text-ouro" /> A consulta de área faz parte da consulta profissional.</p>
            <p className="text-xs text-texto-2">
              Seu plano{acesso.planNome ? ` (${acesso.planNome})` : ""} não inclui o cruzamento com as fontes oficiais.
            </p>
            <Link href="/planos" className="btn-ouro inline-flex items-center gap-1.5 px-5 py-3 text-sm">Ver planos <ArrowRight className="size-4" /></Link>
          </div>
        ) : (
          <BotaoConsultarArea key={raioM} raioM={raioM} url={url} corpo={corpo} jaConsultou={jaConsultou} planNome={acesso.planNome} cotaRestante={cotaRestante} />
        )}
      </div>

      {jaConsultou
        ? <FontesLista fontes={lista} />
        : (
          <p className="cartao flex items-start gap-3 p-6 text-base leading-relaxed text-texto-2">
            <Info className="mt-1 size-5 shrink-0 text-verde" aria-hidden />
            <span>
            {!logado
              ? `Crie uma conta ou entre para consultar as fontes oficiais sobre ${alvo}.`
              : !podeConsultar
              ? `Nenhuma consulta feita ainda para ${alvo}. O cruzamento com as fontes oficiais está disponível nos planos profissionais.`
              : `Nenhuma consulta feita ainda para ${alvo}. Clique em “Consultar fontes oficiais” — leva de 10 a 40 segundos.`}
            </span>
          </p>
        )}

      {pendentes.length > 0 && (
        <p className="text-sm leading-relaxed text-texto-2">
          Ainda não consultadas automaticamente (dependem de arquivo oficial):{" "}
          {pendentes.join(", ")}. A ausência delas aqui não significa ausência de restrição.
        </p>
      )}
      <p className="border-t border-linha pt-4 text-xs leading-relaxed text-texto-2">
        Consulta informativa. Não é laudo, parecer nem certidão, e não substitui os documentos oficiais do imóvel.
      </p>
    </section>
  );
}
