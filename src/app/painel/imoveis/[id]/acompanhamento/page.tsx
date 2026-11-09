import { CalendarCheck2, CalendarClock, CalendarX2, Compass, HandCoins, MessageCircle, UserRoundCheck, type LucideIcon } from "lucide-react";
import { exigirAnunciante } from "@/lib/imovel/anunciante";
import { carregarAcompanhamento, lembretesDoImovel } from "@/lib/acompanhamento/servidor";
import { PROPOSTA_STATUS_LABEL, dataBR, dataHoraBR, linkWhatsApp } from "@/lib/acompanhamento/textos";
import { Estatistica, Etiqueta } from "@/components/ui/Pagina";
import { formatBRL } from "@/lib/format";
import Lembretes from "./Lembretes";

const ICONE_VISITA: Record<string, LucideIcon> = {
  agendada: CalendarClock, realizada: CalendarCheck2, cancelada: CalendarX2, nao_compareceu: CalendarX2, remarcada: CalendarClock,
};
const TOM_PROPOSTA: Record<string, "verde" | "ouro" | "critico" | "neutro"> = {
  enviada: "ouro", aceita: "verde", contraproposta: "neutro", recusada: "critico",
};

/**
 * Aba Acompanhamento (item 28, referência Quave.imob): o proprietário vê as
 * visitas, o retorno de cada uma, as propostas (só o resumo: o comprador não
 * é identificado), os próximos passos e quem está conduzindo o atendimento.
 */
export default async function Acompanhamento({ params }: PageProps<"/painel/imoveis/[id]/acompanhamento">) {
  const { id } = await params;
  const { ator, imovel } = await exigirAnunciante(id);
  const [ac, lembretes] = await Promise.all([
    carregarAcompanhamento(id),
    lembretesDoImovel(id, ator.userId),
  ]);

  const ultimo = ac.linha[0];
  const mensagem = ultimo?.tipo === "visita"
    ? `Olá! Sou o proprietário do imóvel ${imovel.codigo} (${imovel.titulo}). Vi no painel da Arini: ${ultimo.titulo.toLowerCase()} em ${dataHoraBR(ultimo.quando)}. Pode me contar como foi?`
    : `Olá! Sou o proprietário do imóvel ${imovel.codigo} (${imovel.titulo}). Gostaria de saber como está o atendimento dos interessados.`;
  const whats = ac.intermediador.tipo !== "proprietario" ? linkWhatsApp(ac.intermediador.telefone, mensagem) : null;

  return (
    <div className="max-w-4xl space-y-8">
      <div className="grid gap-5 sm:grid-cols-3">
        <Estatistica icone={CalendarClock} valor={ac.visitas.agendadas} rotulo="Visitas agendadas" urgente={ac.visitas.agendadas > 0} />
        <Estatistica icone={CalendarCheck2} valor={ac.visitas.realizadas} rotulo="Visitas realizadas" />
        <Estatistica icone={HandCoins} valor={ac.propostas.length} rotulo="Propostas recebidas" />
      </div>

      <section className="cartao p-5 md:p-7">
        <div className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
          <div className="flex items-start gap-4">
            <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-verde/12 text-verde">
              <UserRoundCheck className="size-5" />
            </span>
            <div>
              <p className="lp-eyebrow text-xs">Intermediador responsável</p>
              <p className="lp-display mt-1.5 text-xl text-texto">{ac.intermediador.nome}</p>
              <p className="mt-1 text-sm text-texto-2">
                {ac.intermediador.tipo === "parceiro" ? "Corretor parceiro da Arini"
                  : ac.intermediador.tipo === "arini" ? "Equipe comercial da Arini"
                  : ac.intermediador.tipo === "proprietario" ? "A Arini encaminhou o interessado diretamente a você"
                  : "Ainda não há interessado em atendimento. A Central Arini acompanha o anúncio."}
              </p>
            </div>
          </div>
          {whats && (
            <a href={whats} target="_blank" rel="noopener noreferrer"
              className="btn-verde inline-flex shrink-0 items-center justify-center gap-2 px-5 py-2.5 text-sm">
              <MessageCircle className="size-4" /> Abrir no WhatsApp
            </a>
          )}
        </div>
        {whats && <p className="mt-3 text-sm text-texto-2">A mensagem já vai escrita. Você revisa e envia pelo seu WhatsApp.</p>}
      </section>

      <section className="cartao p-5 md:p-7">
        <header className="flex items-start gap-4">
          <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-verde/12 text-verde"><Compass className="size-5" /></span>
          <div className="min-w-0">
            <h2 className="lp-display text-xl md:text-2xl text-texto">Próximos passos</h2>
            {ac.proximosPassos ? (
              <>
                <p className="mt-3 whitespace-pre-line text-base leading-relaxed text-texto">{ac.proximosPassos.texto}</p>
                <p className="mt-2 text-sm text-texto-2">Atualizado pelo intermediador em {dataBR(ac.proximosPassos.atualizadoEm)}.</p>
              </>
            ) : (
              <p className="mt-1.5 text-base text-texto-2">
                O intermediador registra aqui o que vem a seguir. Você recebe um e-mail a cada atualização.
              </p>
            )}
          </div>
        </header>
      </section>

      <section className="space-y-4">
        <h2 className="lp-display text-2xl text-texto">Linha do tempo</h2>
        {ac.linha.length === 0 ? (
          <p className="cartao p-6 text-base text-texto-2">
            Nenhuma visita ou proposta ainda. Quando uma visita for agendada, você recebe um e-mail e ela aparece aqui.
          </p>
        ) : (
          <ol className="cartao divide-y divide-linha !p-0">
            {ac.linha.map((e) => {
              const Icone = e.tipo === "proposta" ? HandCoins : ICONE_VISITA[e.status] ?? CalendarClock;
              return (
                <li key={e.id} className="flex gap-4 px-5 py-4">
                  <span className={`mt-0.5 grid size-9 shrink-0 place-items-center rounded-full ${e.status === "cancelada" || e.status === "nao_compareceu" ? "bg-superficie-2 text-texto-2" : "bg-verde/10 text-verde"}`}>
                    <Icone className="size-[18px]" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                      <p className="font-semibold text-texto">{e.titulo}</p>
                      <p className="text-sm tabular-nums text-texto-2">{dataHoraBR(e.quando)}</p>
                    </div>
                    <p className="text-sm text-texto-2">{e.interessado}</p>
                    {e.tipo === "proposta" ? (
                      <p className="mt-1.5 flex flex-wrap items-center gap-2 text-base text-texto">
                        {e.detalhe}
                        <Etiqueta tom={TOM_PROPOSTA[e.status] ?? "neutro"}>{PROPOSTA_STATUS_LABEL[e.status] ?? e.status}</Etiqueta>
                      </p>
                    ) : e.detalhe ? (
                      <p className="mt-2 rounded-xl bg-superficie-2 px-4 py-3 text-[0.95rem] leading-relaxed text-texto-3">
                        <span className="font-semibold text-texto">Feedback da visita: </span>{e.detalhe}
                      </p>
                    ) : e.status === "realizada" ? (
                      <p className="mt-1.5 text-sm text-texto-2">Feedback ainda não registrado pelo intermediador.</p>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      {ac.propostas.length > 0 && (
        <section className="space-y-4">
          <h2 className="lp-display text-2xl text-texto">Propostas recebidas</h2>
          <p className="text-base text-texto-2">Resumo das rodadas. Os dados do comprador ficam com o intermediador.</p>
          <div className="cartao overflow-x-auto !p-0">
            <table className="w-full min-w-[34rem] text-left text-[0.95rem]">
              <thead className="text-xs uppercase tracking-[0.12em] text-texto-2">
                <tr className="border-b border-linha">
                  <th className="px-5 py-3 font-semibold">Interessado</th>
                  <th className="px-5 py-3 font-semibold">Rodada</th>
                  <th className="px-5 py-3 font-semibold">Valor</th>
                  <th className="px-5 py-3 font-semibold">Situação</th>
                  <th className="px-5 py-3 font-semibold">Data</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-linha">
                {ac.propostas.map((p) => (
                  <tr key={p.id}>
                    <td className="px-5 py-3 text-texto">{p.interessado}</td>
                    <td className="px-5 py-3 text-texto-2">{p.rodada}{p.lado === "vendedor" ? " (contraproposta)" : ""}</td>
                    <td className="px-5 py-3 font-semibold tabular-nums text-texto">{formatBRL(p.valor)}</td>
                    <td className="px-5 py-3"><Etiqueta tom={TOM_PROPOSTA[p.status] ?? "neutro"}>{PROPOSTA_STATUS_LABEL[p.status] ?? p.status}</Etiqueta></td>
                    <td className="px-5 py-3 tabular-nums text-texto-2">{dataBR(p.quando)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* lembretes: escondidos enquanto a migration 0060 não estiver aplicada */}
      {lembretes && <Lembretes propertyId={id} lembretes={lembretes} />}
    </div>
  );
}
