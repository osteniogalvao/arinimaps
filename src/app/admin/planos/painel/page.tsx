import { BarChart3 } from "lucide-react";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { exigirSetor } from "@/lib/setores-servidor";
import { formatBRLFinanceiro } from "@/lib/format";
import { CabecalhoPagina, Vazio } from "@/components/ui/Pagina";
import { Indicadores, LinkAcao, Secao } from "@/components/admin/Painel";
import { TABELA, TABELA_CAIXA, TBODY, TD, TH, THEAD, TR } from "@/components/admin/estilos";
import { PAPEIS_EQUIPE_IDS } from "@/lib/planos";

type Assinatura = {
  plano: string; ciclo: "mensal" | "anual"; recorrente: number; adicionais: number;
  liberado_em: string; aceite: string | null; inicio: string | null; cancelado: string | null;
};

/** Valor mensal da assinatura em reais (anual dividido por 12; adicionais já são mensais). */
const mensal = (a: Assinatura) => ((a.ciclo === "anual" ? a.recorrente / 12 : a.recorrente) + a.adicionais) / 100;
const mes = (d: string) => d.slice(0, 7);
const rotuloMes = (m: string) => new Date(m + "-15T12:00:00").toLocaleDateString("pt-BR", { month: "short" }).replace(".", "");

/**
 * Painel de planos (áudio do Carlos, 19/11/2026 18h54): quantos pacotes estão
 * ativos, quais foram contratados, receita média e baixas, com gráfico.
 * Fonte: assinaturas_cotadas (pagas, valores em centavos), faturas_cotadas e
 * as contas por plano em profiles (inclui gratuitos).
 */
export default async function PainelPlanos() {
  await exigirSetor("diretoria", "financeiro");
  const admin = supabaseAdmin();
  const [{ data: planos }, { data: assin, error }, { data: faturas }, { data: perfis }] = await Promise.all([
    admin.from("plans").select("id, nome, preco_mensal, ativo").order("ordem").order("id"),
    admin.from("assinaturas_cotadas").select("plano, ciclo, recorrente, adicionais, liberado_em, aceite, inicio, cancelado"),
    admin.from("faturas_cotadas").select("valor, status, inicio").eq("status", "paga"),
    admin.from("profiles").select("role, plan_id").eq("ativo", true).not("plan_id", "is", null),
  ]);
  if (error) return <Vazio icone={BarChart3} titulo="Sem dados de assinatura" texto="O painel lê as assinaturas contratadas (migration 0099)." />;

  const todas = ((assin ?? []) as Assinatura[]).filter((a) => a.aceite);
  const ativas = todas.filter((a) => !a.cancelado);
  const mrr = ativas.reduce((s, a) => s + mensal(a), 0);
  const ticket = ativas.length ? mrr / ativas.length : 0;
  const hoje = new Date();
  const ha30 = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const novas30 = todas.filter((a) => a.aceite! >= ha30).length;
  const baixas30 = todas.filter((a) => a.cancelado && a.cancelado >= ha30).length;
  const ativasHa30 = todas.filter((a) => a.aceite! < ha30 && (!a.cancelado || a.cancelado >= ha30)).length;
  const taxaBaixa = ativasHa30 ? Math.round((baixas30 / ativasHa30) * 1000) / 10 : 0;

  // últimos 12 meses
  const meses: string[] = [];
  for (let i = 11; i >= 0; i--) meses.push(new Date(hoje.getFullYear(), hoje.getMonth() - i, 15).toISOString().slice(0, 7));
  const serie = meses.map((m) => ({
    mes: m,
    novas: todas.filter((a) => mes(a.aceite!) === m).length,
    baixas: todas.filter((a) => a.cancelado && mes(a.cancelado) === m).length,
    ativas: todas.filter((a) => mes(a.aceite!) <= m && (!a.cancelado || mes(a.cancelado) > m)).length,
    recebido: (faturas ?? []).filter((f) => f.inicio && mes(f.inicio) === m).reduce((s, f) => s + f.valor / 100, 0),
  }));

  const contas = new Map<string, number>();
  for (const p of perfis ?? []) if (!PAPEIS_EQUIPE_IDS.includes(p.role)) contas.set(p.plan_id!, (contas.get(p.plan_id!) ?? 0) + 1);
  const porPlano = (planos ?? []).map((p) => {
    const dele = todas.filter((a) => a.plano === p.id);
    const vivas = dele.filter((a) => !a.cancelado);
    const receita = vivas.reduce((s, a) => s + mensal(a), 0);
    return {
      id: p.id, nome: p.nome, inativo: !p.ativo, contas: contas.get(p.id) ?? 0, ativas: vivas.length,
      contratadas: dele.length, baixas: dele.length - vivas.length, receita,
      ticket: vivas.length ? receita / vivas.length : 0,
    };
  }).filter((p) => p.contas || p.contratadas).sort((a, b) => b.receita - a.receita || b.contas - a.contas);

  return (
    <div className="mx-auto max-w-[1280px] space-y-10">
      <CabecalhoPagina variante="simples" eyebrow="Central · Diretoria" titulo="Painel de planos"
        subtitulo="Pacotes ativos, contratações, baixas e receita recorrente. Assinaturas pagas contam a partir do aceite; gratuitos aparecem só em contas por plano."
        acoes={<LinkAcao href="/admin/planos">Planos e nichos</LinkAcao>} />

      <Indicadores itens={[
        { rotulo: "assinaturas ativas", valor: ativas.length },
        { rotulo: "receita mensal recorrente", valor: formatBRLFinanceiro(mrr) },
        { rotulo: "ticket médio por assinatura", valor: formatBRLFinanceiro(ticket) },
        { rotulo: "contratadas em 30 dias", valor: novas30 },
        { rotulo: `baixas em 30 dias (${taxaBaixa.toLocaleString("pt-BR")}%)`, valor: baixas30, destaque: baixas30 > 0 },
      ]} />

      <Secao titulo="Contratações e baixas por mês">
        <GraficoMeses serie={serie} />
      </Secao>

      <Secao titulo="Receita mensal por plano">
        <GraficoPlanos linhas={porPlano.filter((p) => p.receita > 0)} />
      </Secao>

      <Secao titulo="Planos">
        <div className={TABELA_CAIXA}>
          <table className={TABELA}>
            <thead className={THEAD}><tr>
              <th className={TH}>Plano</th><th className={TH}>Contas no plano</th><th className={TH}>Assinaturas ativas</th>
              <th className={TH}>Contratadas</th><th className={TH}>Baixas</th><th className={TH}>Receita mensal</th>
              <th className={TH}>Ticket médio</th><th className={TH}>% da receita</th>
            </tr></thead>
            <tbody className={TBODY}>
              {porPlano.map((p) => (
                <tr key={p.id} className={TR}>
                  <td className={TD + " font-medium text-texto"}>{p.nome}{p.inativo && <span className="ml-2 text-xs text-texto-2">(inativo)</span>}</td>
                  <td className={TD + " tabular-nums"}>{p.contas}</td>
                  <td className={TD + " tabular-nums"}>{p.ativas}</td>
                  <td className={TD + " tabular-nums"}>{p.contratadas}</td>
                  <td className={TD + " tabular-nums " + (p.baixas ? "text-critico" : "")}>{p.baixas}</td>
                  <td className={TD + " tabular-nums"}>{formatBRLFinanceiro(p.receita)}</td>
                  <td className={TD + " tabular-nums"}>{formatBRLFinanceiro(p.ticket)}</td>
                  <td className={TD + " tabular-nums"}>{mrr ? Math.round((p.receita / mrr) * 100) : 0}%</td>
                </tr>
              ))}
              {!porPlano.length && <tr><td className={TD + " text-texto-2"} colSpan={8}>Nenhuma conta com plano ainda.</td></tr>}
            </tbody>
          </table>
        </div>
      </Secao>

      <Secao titulo="Mês a mês">
        <div className={TABELA_CAIXA}>
          <table className={TABELA}>
            <thead className={THEAD}><tr>
              <th className={TH}>Mês</th><th className={TH}>Novas</th><th className={TH}>Baixas</th><th className={TH}>Ativas no fim do mês</th><th className={TH}>Faturas pagas</th>
            </tr></thead>
            <tbody className={TBODY}>
              {[...serie].reverse().map((s) => (
                <tr key={s.mes} className={TR}>
                  <td className={TD}>{rotuloMes(s.mes)}/{s.mes.slice(2, 4)}</td>
                  <td className={TD + " tabular-nums"}>{s.novas}</td>
                  <td className={TD + " tabular-nums"}>{s.baixas}</td>
                  <td className={TD + " tabular-nums"}>{s.ativas}</td>
                  <td className={TD + " tabular-nums"}>{formatBRLFinanceiro(s.recebido)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Secao>
    </div>
  );
}

/** Barras agrupadas: novas (verde) e baixas (ouro) por mês, com rótulo direto no último mês. */
function GraficoMeses({ serie }: { serie: { mes: string; novas: number; baixas: number; ativas: number }[] }) {
  const L = 720, A = 220, base = A - 28, topo = 16;
  const max = Math.max(1, ...serie.flatMap((s) => [s.novas, s.baixas]));
  const passo = L / serie.length, larg = Math.min(14, passo / 3);
  const y = (v: number) => base - ((base - topo) * v) / max;
  return (
    <div className="cartao p-5">
      <div className="mb-3 flex flex-wrap gap-4 text-xs text-texto-2">
        <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-verde" />Contratadas</span>
        <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-ouro" />Baixas</span>
      </div>
      <svg viewBox={`0 0 ${L} ${A}`} className="h-auto w-full" role="img" aria-label="Contratações e baixas nos últimos 12 meses">
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={0} x2={L} y1={y(max * f)} y2={y(max * f)} className="stroke-linha" strokeWidth={1} />
            <text x={0} y={y(max * f) - 4} className="fill-texto-2 text-[10px]">{Math.round(max * f)}</text>
          </g>
        ))}
        {serie.map((s, i) => {
          const cx = passo * i + passo / 2;
          return (
            <g key={s.mes}>
              <rect x={cx - larg - 1} y={y(s.novas)} width={larg} height={Math.max(0, base - y(s.novas))} rx={3} className="fill-verde">
                <title>{`${rotuloMes(s.mes)}: ${s.novas} contratada(s)`}</title>
              </rect>
              <rect x={cx + 1} y={y(s.baixas)} width={larg} height={Math.max(0, base - y(s.baixas))} rx={3} className="fill-ouro">
                <title>{`${rotuloMes(s.mes)}: ${s.baixas} baixa(s)`}</title>
              </rect>
              <rect x={cx - passo / 2} y={topo} width={passo} height={base - topo} fill="transparent">
                <title>{`${rotuloMes(s.mes)}: ${s.novas} contratada(s), ${s.baixas} baixa(s), ${s.ativas} ativa(s)`}</title>
              </rect>
              <text x={cx} y={A - 8} textAnchor="middle" className="fill-texto-2 text-[11px]">{rotuloMes(s.mes)}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/** Barras horizontais: receita mensal recorrente de cada plano. */
function GraficoPlanos({ linhas }: { linhas: { id: string; nome: string; receita: number; ativas: number }[] }) {
  if (!linhas.length) return <p className="cartao px-5 py-8 text-center text-sm text-texto-2">Nenhuma assinatura paga ativa ainda.</p>;
  const max = Math.max(...linhas.map((l) => l.receita));
  return (
    <div className="cartao space-y-3 p-5">
      {linhas.map((l) => (
        <div key={l.id} className="grid grid-cols-[minmax(8rem,14rem)_1fr_auto] items-center gap-3 text-sm" title={`${l.nome}: ${formatBRLFinanceiro(l.receita)} por mês, ${l.ativas} ativa(s)`}>
          <span className="truncate text-texto">{l.nome}</span>
          <span className="h-3 rounded-full bg-superficie-2">
            <span className="block h-3 rounded-full bg-verde" style={{ width: `${Math.max(2, (l.receita / max) * 100)}%` }} />
          </span>
          <span className="tabular-nums text-texto-2">{formatBRLFinanceiro(l.receita)}</span>
        </div>
      ))}
    </div>
  );
}
