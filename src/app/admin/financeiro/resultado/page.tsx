import Link from "next/link";
import { CalendarClock, CheckCircle2, Download, FileText, TrendingDown, TrendingUp } from "lucide-react";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { lerEmLotes } from "@/lib/supabase/lotes";
import { exigirSetor } from "@/lib/setores-servidor";
import { formatBRL } from "@/lib/format";
import { CabecalhoPagina, Vazio } from "@/components/ui/Pagina";
import { Indicadores, Secao } from "@/components/admin/Painel";
import { LISTA, LISTA_VAZIA, TABELA, TABELA_CAIXA, TBODY, TH, THEAD, TR } from "@/components/admin/estilos";

type Mes = { mes: string; entradas: number; saidas: number; saldo: number };
const nomeMes = (m: string) =>
  new Date(m + "-15T12:00:00").toLocaleDateString("pt-BR", { month: "short", year: "2-digit" }).replace(" de ", "/").replace(".", "");

/**
 * Painel financeiro da Diretoria (Central de CRMs, etapa 2): resultado por mês
 * a partir dos lançamentos, gasto por centro de custo, o que espera aprovação e
 * o que vence nos próximos dias, mais o arquivo do contador.
 */
export default async function Resultado() {
  await exigirSetor("financeiro", "diretoria");
  const admin = supabaseAdmin();
  const hoje = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  const [ano, mes, dia] = hoje.split("-").map(Number);
  const em7 = new Date(Date.UTC(ano, mes - 1, dia + 7)).toISOString().slice(0, 10);
  const inicioMes = hoje.slice(0, 8) + "01T00:00:00-03:00";
  const ha12 = new Date(Date.UTC(ano, mes - 12, 1)).toISOString().slice(0, 10);

  const [mensal, pendentes, proximas, gastos, notas] = await Promise.all([
    admin.rpc("fn_resultado_mensal", { p_meses: 12 }),
    admin.from("despesas").select("id", { count: "exact", head: true }).eq("status", "pendente"),
    admin.from("despesas").select("id, codigo, descricao, valor, vencimento").eq("status", "aprovada")
      .lte("vencimento", em7).order("vencimento").order("id").limit(20),
    lerEmLotes((de, ate) => admin.from("lancamentos_contabeis").select("valor, centro:centros_custo(nome)")
      .eq("natureza", "saida").eq("estornado", false).gte("data", ha12).lte("data", hoje).order("id").range(de, ate), { maximo: Infinity }),
    lerEmLotes((de, ate) => admin.from("notas_fiscais").select("valor")
      .eq("status", "emitida").gte("emitida_em", inicioMes).order("id").range(de, ate), { maximo: Infinity }),
  ]);
  if (mensal.error || pendentes.error || pendentes.count === null || proximas.error || gastos.error || notas.error) {
    return (
      <div className="max-w-4xl space-y-6">
        <CabecalhoPagina eyebrow="Financeiro" titulo="Resultado e contabilidade" />
        <Vazio icone={FileText} titulo="Resultado indisponível" texto="Não foi possível carregar todos os dados do período. Tente novamente." />
      </div>
    );
  }
  const lista = (mensal.data ?? []) as Mes[];
  const atual = lista[0];
  const centros = new Map<string, number>();
  for (const l of gastos.data) {
    const nome = (l.centro as unknown as { nome: string } | null)?.nome ?? "Sem centro de custo";
    centros.set(nome, (centros.get(nome) ?? 0) + Number(l.valor));
  }
  const totalCentros = [...centros.values()].reduce((a, b) => a + b, 0);
  const emitidas = notas.data;

  return (
    <div className="max-w-6xl space-y-10">
      <CabecalhoPagina eyebrow="Financeiro" titulo="Resultado e contabilidade"
        subtitulo="Entradas e saídas vêm dos lançamentos: despesa paga, comissão recebida e mensalidade paga entram sozinhas."
        acoes={<a href="/api/admin/financeiro/contabil" className="btn-contorno inline-flex items-center gap-2 px-4 py-2.5 text-sm"><Download className="size-4" /> Arquivo do contador (CSV)</a>} />

      <Indicadores itens={[
        { rotulo: "Entradas no mês", icone: TrendingUp, valor: formatBRL(Number(atual?.entradas ?? 0)) },
        { rotulo: "Saídas no mês", icone: TrendingDown, valor: formatBRL(Number(atual?.saidas ?? 0)) },
        { rotulo: "Aguardando aprovação", icone: CheckCircle2, valor: pendentes.count, href: "/admin/registros/despesas?status=pendente", destaque: pendentes.count > 0 },
        { rotulo: "Notas emitidas no mês", icone: FileText, valor: emitidas.length, href: "/admin/registros/notas-fiscais?status=todos",
          nota: emitidas.length ? formatBRL(emitidas.reduce((s, n) => s + Number(n.valor), 0)) : undefined },
      ]} />

      <Secao titulo="Resultado por mês">
        <div className={TABELA_CAIXA}>
          <table className={TABELA}>
            <thead className={THEAD}><tr>
              <th className={TH}>Mês</th><th className={TH + " text-right"}>Entradas</th><th className={TH + " text-right"}>Saídas</th><th className={TH + " text-right"}>Saldo</th>
            </tr></thead>
            <tbody className={TBODY + " tabular-nums"}>
              {lista.map((m) => (
                <tr key={m.mes} className={TR}>
                  <td className="px-4 py-3.5 font-semibold capitalize text-texto">{nomeMes(m.mes)}</td>
                  <td className="px-4 py-3.5 text-right text-verde">{formatBRL(Number(m.entradas))}</td>
                  <td className="px-4 py-3.5 text-right">{formatBRL(Number(m.saidas))}</td>
                  <td className={"px-4 py-3.5 text-right font-semibold " + (Number(m.saldo) < 0 ? "text-critico" : "text-texto")}>{formatBRL(Number(m.saldo))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Secao>

      <div className="grid gap-10 lg:grid-cols-2 lg:gap-6">
        <Secao titulo="Gasto por centro de custo (12 meses)">
          <div className={LISTA}>
            {[...centros.entries()].sort((a, b) => b[1] - a[1]).map(([nome, v]) => (
              <div key={nome} className="px-5 py-3">
                <div className="flex justify-between text-sm"><span className="text-texto">{nome}</span><span className="tabular-nums text-texto">{formatBRL(v)}</span></div>
                <div className="mt-1.5 h-1.5 rounded-full bg-superficie-2"><div className="h-1.5 rounded-full bg-ouro" style={{ width: `${Math.max(2, (v / (totalCentros || 1)) * 100)}%` }} /></div>
              </div>
            ))}
            {!centros.size && <p className={LISTA_VAZIA}>Nenhuma despesa paga ainda.</p>}
          </div>
        </Secao>
        <Secao titulo="Vence nos próximos 7 dias">
          <div className={LISTA}>
            {(proximas.data ?? []).map((d) => (
              <Link key={d.id} href="/admin/registros/despesas?status=aprovada" className="flex items-center justify-between gap-4 px-5 py-3.5 text-[0.95rem] hover:bg-superficie-2/70">
                <span className="min-w-0">
                  <span className="font-medium text-texto">{d.descricao}</span>
                  <span className={"mt-0.5 flex items-center gap-1 text-sm " + (d.vencimento < hoje ? "text-critico" : "text-texto-2")}>
                    <CalendarClock className="size-3.5" /> {d.codigo} · {new Date(d.vencimento + "T12:00:00").toLocaleDateString("pt-BR")}
                  </span>
                </span>
                <span className="lp-display text-lg tabular-nums text-texto">{formatBRL(Number(d.valor))}</span>
              </Link>
            ))}
            {!proximas.data?.length && <p className={LISTA_VAZIA}>Nada vencendo.</p>}
          </div>
        </Secao>
      </div>
    </div>
  );
}
