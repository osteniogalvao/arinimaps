import Link from "next/link";
import { ClipboardList, MessageSquareWarning, UserRoundX } from "lucide-react";
import type { Pendencias } from "@/lib/acompanhamento/servidor";
import { DIAS_SEM_ATUALIZACAO, HORAS_SEM_FEEDBACK, dataBR, dataHoraBR } from "@/lib/acompanhamento/textos";
import AtualizarProprietario from "./AtualizarProprietario";

/**
 * Pendências do intermediador responsável (item 28): visitas realizadas sem
 * feedback há mais de 48 h e proprietários sem atualização há 7 dias. Aparece
 * no painel do corretor parceiro e no Comercial da Central. Sem pendência, some.
 */
export default function PendenciasIntermediador({ pendencias, hrefOportunidade }: {
  pendencias: Pendencias;
  /** base do link da oportunidade: /painel/oportunidades ou /admin/oportunidades */
  hrefOportunidade: string;
}) {
  if (!pendencias.total) return null;
  const { visitasSemFeedback: visitas, semAtualizacao: semAtual } = pendencias;
  return (
    <section className="cartao !border-ouro/60 p-5 md:p-7" aria-labelledby="titulo-pendencias">
      <header className="flex items-start gap-4">
        <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-ouro/15 text-ouro">
          <ClipboardList className="size-5" />
        </span>
        <div className="min-w-0">
          <h2 id="titulo-pendencias" className="lp-display text-xl md:text-2xl text-texto">
            Pendências com proprietários <span className="tabular-nums text-ouro">({pendencias.total})</span>
          </h2>
          <p className="mt-1 text-base text-texto-2">O proprietário acompanha o imóvel pelo painel. Mantenha-o informado.</p>
        </div>
      </header>

      {visitas.length > 0 && (
        <div className="mt-6">
          <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.12em] text-texto-2">
            <MessageSquareWarning className="size-4" /> Visita realizada sem feedback há mais de {HORAS_SEM_FEEDBACK} h
            <span className="rounded-md bg-superficie-2 px-1.5 py-0.5 text-xs tabular-nums">{visitas.length}</span>
          </h3>
          <ul className="mt-3 divide-y divide-linha rounded-xl border border-linha">
            {visitas.slice(0, 20).map((v) => (
              <li key={v.visitaId}>
                <Link href={`${hrefOportunidade}/${v.opportunityId}`}
                  className="flex flex-col gap-1 px-4 py-3 text-[0.95rem] transition-colors hover:bg-superficie-2/70 sm:flex-row sm:items-center sm:justify-between">
                  <span className="min-w-0 truncate text-texto">{v.imovel || v.codigoOpp}</span>
                  <span className="shrink-0 text-sm text-texto-2">{v.codigoOpp} · visita em {dataHoraBR(v.dataHora)} · registrar feedback</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {semAtual.length > 0 && (
        <div className="mt-6">
          <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.12em] text-texto-2">
            <UserRoundX className="size-4" /> Proprietário sem atualização há {DIAS_SEM_ATUALIZACAO} dias
            <span className="rounded-md bg-superficie-2 px-1.5 py-0.5 text-xs tabular-nums">{semAtual.length}</span>
          </h3>
          <ul className="mt-3 space-y-3">
            {semAtual.slice(0, 20).map((p) => (
              <li key={p.propertyId} className="rounded-xl border border-linha p-4">
                <p className="text-[0.95rem] text-texto">
                  <span className="font-mono text-sm text-texto-2">{p.codigo}</span> · {p.titulo}
                </p>
                <p className="mt-1 text-sm text-texto-2">
                  {p.proprietario} · última atualização em {dataBR(p.ultima)}
                </p>
                <AtualizarProprietario propertyId={p.propertyId} codigo={p.codigo} telefone={p.telefone}
                  nome={p.proprietario} atual={p.proximosPassos} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
