import Link from "next/link";
import { Bot, CircleCheck, Gauge, Hourglass, Repeat } from "lucide-react";
import { setorPorId } from "@/lib/setores";
import { NIVEL_COBRANCA_LABEL, type CargaSetor } from "@/lib/matriz";
import type { FiltroGargalos, Gargalo } from "@/lib/matriz-servidor";
import { Secao } from "@/components/admin/Painel";
import { Etiqueta } from "@/components/ui/Pagina";
import { ABA, ABA_ATIVA, LISTA, LINHA_LISTA, TABELA, TABELA_CAIXA, TBODY, TD, TH, THEAD, TR } from "@/components/admin/estilos";

const nomeSetor = (id: string) => setorPorId(id)?.nome ?? id;
const dataBR = (d: string) => new Date(d.slice(0, 10) + "T12:00:00").toLocaleDateString("pt-BR");

/** Resumo diário da Ari (seção 6: "texto curto diário com o que mais pede atenção"). */
export function ResumoAri({ resumo, setores }: {
  resumo: { dia: string; texto: string } | null;
  setores: { setor: string; dia: string; texto: string }[];
}) {
  if (!resumo && !setores.length) return null;
  return (
    <div className="cartao flex items-start gap-4 border-l-4 border-l-ouro p-5">
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-ouro/15 text-ouro"><Bot className="size-5" /></span>
      <div className="min-w-0 flex-1 space-y-2">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ouro">
          Resumo da Ari · {dataBR(resumo?.dia ?? setores[0].dia)}
        </p>
        {resumo && <p className="text-[0.95rem] leading-relaxed text-texto">{resumo.texto}</p>}
        {setores.map((s) => (
          <p key={s.setor} className="text-[0.95rem] leading-relaxed text-texto">
            <strong className="font-semibold">{nomeSetor(s.setor)}:</strong> {s.texto}
          </p>
        ))}
      </div>
    </div>
  );
}

/** Fila de gargalos: vencidas de todos os setores visíveis, da mais crítica para a menos. */
export function FilaGargalos({ itens, setores, filtro, hoje, pronto, erroPeriodo }: {
  itens: Gargalo[];
  setores: { id: string; nome: string }[];
  filtro: FiltroGargalos;
  hoje: string;
  pronto: boolean;
  erroPeriodo?: string | null;
}) {
  const link = (f: Partial<FiltroGargalos>) => {
    const p = new URLSearchParams();
    const v = { ...filtro, ...f };
    if (v.setor) p.set("setor", v.setor);
    if (v.tipo) p.set("tipo", v.tipo);
    if (v.de) p.set("de", v.de);
    if (v.ate) p.set("ate", v.ate);
    const q = p.toString();
    return `/admin${q ? "?" + q : ""}#gargalos`;
  };
  const tipos: [string, string][] = [["", "Todos"], ["manual", "Da equipe"], ["encaminhada", "Encaminhadas"], ["automatica", "Do sistema"], ["saltos", "Passou por 3+ setores"]];
  return (
    <section id="gargalos" className="scroll-mt-24">
      <Secao titulo="Fila de gargalos">
        <div className="space-y-3">
          <form action="/admin#gargalos" className="flex flex-wrap items-end gap-3 text-sm">
            <input type="hidden" name="setor" value={filtro.setor} /><input type="hidden" name="tipo" value={filtro.tipo} />
            <label className="space-y-1"><span className="block">Prazo de</span><input aria-label="Prazo de" type="date" name="de" defaultValue={filtro.de} className="rounded-lg border border-linha bg-superficie px-3 py-2" /></label>
            <label className="space-y-1"><span className="block">Prazo até</span><input aria-label="Prazo até" type="date" name="ate" defaultValue={filtro.ate} className="rounded-lg border border-linha bg-superficie px-3 py-2" /></label>
            <button className="btn-verde px-4 py-2">Filtrar período</button>
            <Link href={link({ de: "", ate: "" })} className="px-2 py-2 text-verde">Limpar período</Link>
          </form>
          <p className="text-xs text-texto-2">O período filtra o vencimento das tarefas desta fila. As demais filas, a carga e o resumo mostram a operação atual.</p>
          {erroPeriodo && <p role="alert" className="text-sm text-critico">{erroPeriodo}</p>}
          <div className="flex flex-wrap gap-2">
            {setores.length > 1 && (
              <>
                <Link href={link({ setor: "" })} className={ABA + " " + (!filtro.setor ? ABA_ATIVA : "border-linha text-texto-2 hover:border-linha-forte")}>Todos os setores</Link>
                {setores.map((s) => (
                  <Link key={s.id} href={link({ setor: s.id })}
                    className={ABA + " " + (filtro.setor === s.id ? ABA_ATIVA : "border-linha text-texto-2 hover:border-linha-forte")}>{s.nome}</Link>
                ))}
              </>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {tipos.map(([id, rotulo]) => (
              <Link key={id || "todos"} href={link({ tipo: id })}
                className={"rounded-full border px-3 py-1 text-xs font-semibold " + (filtro.tipo === id ? "border-ouro bg-ouro/15 text-ouro" : "border-linha text-texto-2 hover:border-linha-forte")}>
                {rotulo}
              </Link>
            ))}
          </div>
          <div className={LISTA}>
            {itens.map((t) => (
              <Link key={t.id} href={`/admin/tarefas/${t.id}`} className={LINHA_LISTA}>
                <span className="font-mono text-xs text-texto-2">{t.codigo}</span>
                <span className="min-w-48 flex-1 font-medium text-texto">{t.titulo}</span>
                <span className="text-xs font-semibold uppercase tracking-[0.1em] text-ouro">{nomeSetor(t.setor)}</span>
                <span className="text-xs text-texto-2">{t.responsavelNome ?? "sem responsável"}</span>
                {t.saltos > 2 && (
                  <Etiqueta tom="alerta"><Repeat className="size-3" />{t.saltos} setores</Etiqueta>
                )}
                {t.atraso > 0 && (
                  <Etiqueta tom={t.nivel >= 3 ? "critico" : "alerta"}>
                    <Hourglass className="size-3" />{t.atraso} dia{t.atraso === 1 ? "" : "s"} de atraso
                  </Etiqueta>
                )}
                {t.nivel > 0 && <span className="text-xs text-texto-2">{NIVEL_COBRANCA_LABEL[t.nivel]}</span>}
              </Link>
            ))}
            {!itens.length && !erroPeriodo && (
              <div className="flex flex-col items-center gap-2 px-5 py-8 text-center">
                <CircleCheck className="size-6 text-verde" />
                <p className="text-[0.95rem] text-texto-2">
                  {pronto ? "Nenhum gargalo encontrado nos filtros selecionados." : `Não foi possível consultar a fila completa até ${dataBR(hoje)}. Tente novamente.`}
                </p>
              </div>
            )}
          </div>
        </div>
      </Secao>
    </section>
  );
}

/** Carga por setor: tarefas abertas contra pessoas e capacidade (seção 5, déficit). */
export function CargaSetores({ linhas }: { linhas: CargaSetor[] }) {
  if (!linhas.length) return null;
  return (
    <Secao titulo="Carga por setor">
      <div className={TABELA_CAIXA}>
        <table className={TABELA}>
          <thead className={THEAD}><tr>
            <th className={TH}>Setor</th><th className={TH}>Abertas</th><th className={TH}>Vencidas</th>
            <th className={TH}>Pessoas</th><th className={TH}>Capacidade</th><th className={TH}>Uso</th><th className={TH}>24 h</th>
          </tr></thead>
          <tbody className={TBODY}>
            {linhas.map((c) => {
              const pct = c.capacidade > 0 ? Math.round((c.abertas / c.capacidade) * 100) : c.abertas > 0 ? 999 : 0;
              return (
                <tr key={c.setor} className={TR}>
                  <td className={TD + " font-medium text-texto"}>
                    <Link href={`/admin/tarefas?setor=${c.setor}`} className="hover:text-verde">{nomeSetor(c.setor)}</Link>
                    {c.deficit && <Etiqueta tom="critico" className="ml-2 align-middle !py-0.5">déficit</Etiqueta>}
                  </td>
                  <td className={TD + " tabular-nums"}>{c.abertas}</td>
                  <td className={TD + " tabular-nums " + (c.vencidas ? "font-semibold text-critico" : "")}>{c.vencidas}</td>
                  <td className={TD + " tabular-nums " + (!c.pessoas && c.abertas ? "font-semibold text-critico" : "")}>{c.pessoas}</td>
                  <td className={TD + " tabular-nums"}>{c.capacidade}</td>
                  <td className={TD}>
                    <span className="flex items-center gap-2">
                      <Gauge className={"size-4 " + (pct > 100 ? "text-critico" : pct > 80 ? "text-ouro" : "text-verde")} />
                      <span className="h-1.5 w-16 rounded-full bg-superficie-2">
                        <span className={"block h-1.5 rounded-full " + (pct > 100 ? "bg-critico" : pct > 80 ? "bg-ouro" : "bg-verde")} style={{ width: `${Math.min(100, pct)}%` }} />
                      </span>
                      <span className="text-xs tabular-nums text-texto-2">{pct > 998 ? "sem equipe" : `${pct}%`}</span>
                    </span>
                  </td>
                  <td className={TD + " text-xs text-texto-2"}>+{c.novas24} / ✓{c.concluidas24}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Secao>
  );
}
