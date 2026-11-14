import { supabaseAdmin } from "@/lib/supabase/admin";
import { lerEmLotes } from "@/lib/supabase/lotes";
import { exigirSetor } from "@/lib/setores-servidor";
import { CircleDollarSign, Download, Receipt, Repeat, Wallet } from "lucide-react";
import { formatBRL, plural } from "@/lib/format";
import { CabecalhoSetor, Indicadores, Secao, TarefasDoSetor, dataBR, LinkAcao } from "@/components/admin/Painel";
import { LISTA, LISTA_VAZIA, TABELA, TABELA_CAIXA, TBODY, TH, THEAD, TR } from "@/components/admin/estilos";
import { Vazio } from "@/components/ui/Pagina";

type Mes = {
  mes: string; vendas: number; volume_vendido: number;
  comissao_registrada: number; comissao_recebida: number;
  mensalidade_faturada: number; mensalidade_recebida: number;
};

const nomeMes = (m: string) =>
  new Date(m + "-15T12:00:00").toLocaleDateString("pt-BR", { month: "short", year: "2-digit" }).replace(" de ", "/").replace(".", "");

/** Financeiro: receita por mês, o que falta receber e o que está vencido. */
export default async function PainelFinanceiro() {
  const user = await exigirSetor("financeiro");
  const admin = supabaseAdmin();

  const [mensal, comissoes, faturas, atrasadas, assinaturas] = await Promise.all([
    admin.rpc("fn_financeiro_mensal", { p_meses: 12 }),
    lerEmLotes((de, ate) => admin.from("commissions")
      .select("id, valor, status, created_at, sale:sales(data_venda, property:properties(codigo, titulo))")
      .in("status", ["registrada", "cobrada"]).order("created_at").order("id").range(de, ate), { maximo: Infinity }),
    admin.from("invoices")
      .select("id, competencia, valor, status, subscription:subscriptions(property:properties(codigo, titulo))")
      .in("status", ["aberta", "vencida"]).order("competencia").order("id").limit(40),
    lerEmLotes((de, ate) => admin.from("invoices").select("valor").eq("status", "vencida")
      .order("id").range(de, ate), { maximo: Infinity }),
    lerEmLotes((de, ate) => admin.from("subscriptions").select("valor_mensal").eq("status", "ativa")
      .order("id").range(de, ate), { maximo: Infinity }),
  ]);
  if (mensal.error || comissoes.error || faturas.error || atrasadas.error || assinaturas.error) {
    return <><CabecalhoSetor setor="financeiro" /><Vazio icone={Receipt} titulo="Financeiro indisponível"
      texto="Não foi possível carregar todos os dados do período. Tente novamente." /></>;
  }

  const meses = (mensal.data ?? []) as Mes[];
  const atual = meses[0];
  const aReceber = comissoes.data.reduce((s, c) => s + Number(c.valor), 0);
  const vencidas = atrasadas.data;
  const recorrente = assinaturas.data.reduce((s, a) => s + Number(a.valor_mensal), 0);
  const recebido12 = meses.reduce((s, m) => s + Number(m.comissao_recebida) + Number(m.mensalidade_recebida), 0);
  const brl = (v: number) => (Number(v) ? formatBRL(Number(v)) : "—");

  return (
    <div className="space-y-10 md:space-y-12">
      <CabecalhoSetor setor="financeiro">
        <a href="/api/admin/financeiro/exportar" className="btn-contorno inline-flex items-center gap-2 px-4 py-2.5 text-sm"><Download className="size-4" /> Baixar planilha (CSV)</a>
      </CabecalhoSetor>

      <Indicadores itens={[
        { rotulo: "Comissões a receber", icone: Wallet, valor: formatBRL(aReceber), href: "/admin/comissoes", destaque: aReceber > 0 },
        { rotulo: "Faturas vencidas", icone: Receipt, valor: vencidas.length, href: "/admin/mensalidades", destaque: vencidas.length > 0,
          nota: vencidas.length ? formatBRL(vencidas.reduce((s, f) => s + Number(f.valor), 0)) : undefined },
        { rotulo: "Mensalidade recorrente", icone: Repeat, valor: formatBRL(recorrente), nota: "por mês, anúncios ativos" },
        { rotulo: "Recebido em 12 meses", icone: CircleDollarSign, valor: formatBRL(recebido12), nota: atual ? `${plural(atual.vendas, "venda")} neste mês` : undefined },
      ]} />

      <Secao titulo="Receita por mês">
        <div className={TABELA_CAIXA}>
          <table className={TABELA}>
            <thead>
              <tr className={THEAD}>
                <th className={TH}>Mês</th>
                <th className={TH + " text-right"}>Vendas</th>
                <th className={TH + " text-right"}>Volume vendido</th>
                <th className={TH + " text-right"}>Comissão gerada</th>
                <th className={TH + " text-right"}>Comissão recebida</th>
                <th className={TH + " text-right"}>Mensalidade faturada</th>
                <th className={TH + " text-right"}>Mensalidade recebida</th>
              </tr>
            </thead>
            <tbody className={TBODY + " tabular-nums"}>
              {meses.map((m) => (
                <tr key={m.mes} className={TR}>
                  <td className="px-4 py-3.5 font-semibold text-texto capitalize">{nomeMes(m.mes)}</td>
                  <td className="px-4 py-3.5 text-right">{m.vendas || "—"}</td>
                  <td className="px-4 py-3.5 text-right">{brl(m.volume_vendido)}</td>
                  <td className="px-4 py-3.5 text-right">{brl(m.comissao_registrada)}</td>
                  <td className="px-4 py-3.5 text-right text-verde">{brl(m.comissao_recebida)}</td>
                  <td className="px-4 py-3.5 text-right">{brl(m.mensalidade_faturada)}</td>
                  <td className="px-4 py-3.5 text-right text-verde">{brl(m.mensalidade_recebida)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Secao>

      <div className="grid gap-10 lg:gap-6 lg:grid-cols-2">
        <Secao titulo="Comissões a receber" acao={<LinkAcao href="/admin/comissoes">Abrir comissões</LinkAcao>}>
          <div className={LISTA}>
            {comissoes.data.map((c) => {
              const venda = c.sale as unknown as { data_venda: string; property: { codigo: string; titulo: string } | null } | null;
              return (
                <div key={c.id} className="flex items-center justify-between gap-4 px-5 py-3.5 text-[0.95rem]">
                  <span className="min-w-0">
                    <span className="font-medium text-texto">{venda?.property?.titulo ?? "Venda"}</span>
                    <span className="mt-0.5 block text-sm text-texto-2">{venda?.property?.codigo} · venda em {dataBR(venda?.data_venda)} · {c.status}</span>
                  </span>
                  <span className="lp-display text-lg tabular-nums whitespace-nowrap text-texto">{formatBRL(Number(c.valor))}</span>
                </div>
              );
            })}
            {!comissoes.data.length && <p className={LISTA_VAZIA}>Nenhuma comissão em aberto.</p>}
          </div>
        </Secao>

        <Secao titulo="Faturas em aberto" acao={<LinkAcao href="/admin/mensalidades">Abrir mensalidades</LinkAcao>}>
          <div className={LISTA}>
            {(faturas.data ?? []).map((f) => {
              const p = (f.subscription as unknown as { property: { codigo: string; titulo: string } | null } | null)?.property;
              return (
                <div key={f.id} className="flex items-center justify-between gap-4 px-5 py-3.5 text-[0.95rem]">
                  <span className="min-w-0">
                    <span className="font-medium text-texto">{p?.titulo ?? "Anúncio"}</span>
                    <span className={"mt-0.5 block text-sm " + (f.status === "vencida" ? "text-critico" : "text-texto-2")}>
                      {p?.codigo} · competência {new Date(f.competencia + "T12:00:00").toLocaleDateString("pt-BR", { month: "2-digit", year: "numeric" })} · {f.status}
                    </span>
                  </span>
                  <span className="lp-display text-lg tabular-nums whitespace-nowrap text-texto">{formatBRL(Number(f.valor))}</span>
                </div>
              );
            })}
            {!faturas.data?.length && <p className={LISTA_VAZIA}>Nenhuma fatura em aberto.</p>}
          </div>
        </Secao>
      </div>

      <TarefasDoSetor setor="financeiro" souEu={user.id} />
    </div>
  );
}
