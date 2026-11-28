import Link from "next/link";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { lerEmLotes } from "@/lib/supabase/lotes";
import { exigirSetor } from "@/lib/setores-servidor";
import { CircleDollarSign, HandCoins, Plus, Receipt, Scale } from "lucide-react";
import { formatBRLFinanceiro as formatBRL } from "@/lib/format";
import { Indicadores, Secao, dataBR } from "@/components/admin/Painel";
import { CabecalhoPagina } from "@/components/ui/Pagina";
import { CAMPO_COMPACTO, CODIGO, TABELA, TABELA_CAIXA, TBODY, TD, TH, THEAD, TR } from "@/components/admin/estilos";

export const metadata = { title: "Financeiro do imóvel" };

const DATA = /^\d{4}-\d{2}-\d{2}$/;
const DESPESA_LABEL: Record<string, string> = { pendente: "Aguardando aprovação", aprovada: "Aprovada", paga: "Paga" };
const COMISSAO_LABEL: Record<string, string> = { registrada: "Registrada", cobrada: "Cobrada", paga: "Paga", conciliada: "Conciliada" };

type Imovel = { codigo: string; titulo: string | null } | null;

/**
 * Financeiro do imóvel (porte do CRM da Arini Negócios): por período, o que
 * cada imóvel trouxe (fechamentos e comissão) e o que custou (despesas ligadas
 * ao imóvel, migration 0178). As despesas seguem a aprovação do Financeiro.
 */
export default async function FinanceiroImovel({ searchParams }: PageProps<"/admin/financeiro/imovel">) {
  await exigirSetor("financeiro");
  const sp = await searchParams;
  const de = typeof sp.de === "string" && DATA.test(sp.de) ? sp.de : "";
  const ate = typeof sp.ate === "string" && DATA.test(sp.ate) ? sp.ate : "";
  const admin = supabaseAdmin();

  const [vendas, despesas] = await Promise.all([
    lerEmLotes<{ id: string; valor_final: number; data_venda: string; property_id: string; property: Imovel; comissao: { valor: number; status: string }[] | { valor: number; status: string } | null }>((i, f) => {
      let q = admin.from("vendas_oficiais")
        .select("id, valor_final, data_venda, property_id, property:properties(codigo, titulo), comissao:commissions(valor, status)");
      if (de) q = q.gte("data_venda", de);
      if (ate) q = q.lte("data_venda", ate);
      return q.order("data_venda", { ascending: false }).order("id").range(i, f) as never;
    }, { maximo: 2000 }),
    lerEmLotes<{ id: string; codigo: string; descricao: string; valor: number; vencimento: string | null; status: string; property_id: string; property: Imovel }>((i, f) => {
      let q = admin.from("despesas").select("id, codigo, descricao, valor, vencimento, status, property_id, property:properties(codigo, titulo)")
        .not("property_id", "is", null).in("status", ["pendente", "aprovada", "paga"]);
      if (de) q = q.gte("vencimento", de);
      if (ate) q = q.lte("vencimento", ate);
      return q.order("vencimento", { ascending: false }).order("id").range(i, f) as never;
    }, { maximo: 2000 }),
  ]);
  const semMigration = !!despesas.error && /property_id/.test(despesas.error.message ?? "");

  const comissaoDe = (v: (typeof vendas.data)[number]) => {
    const c = Array.isArray(v.comissao) ? v.comissao[0] : v.comissao;
    return c ? { valor: Number(c.valor ?? 0), status: c.status } : null;
  };
  const receita = vendas.data.reduce((s, v) => s + Number(v.valor_final ?? 0), 0);
  const comissao = vendas.data.reduce((s, v) => s + (comissaoDe(v)?.valor ?? 0), 0);
  const gastos = despesas.data.reduce((s, d) => s + Number(d.valor ?? 0), 0);

  // resumo por imóvel: comissão que trouxe menos o que custou
  const porImovel = new Map<string, { imovel: Imovel; vendas: number; comissao: number; despesas: number }>();
  const linha = (id: string, imovel: Imovel) => porImovel.get(id) ?? porImovel.set(id, { imovel, vendas: 0, comissao: 0, despesas: 0 }).get(id)!;
  for (const v of vendas.data) { const l = linha(v.property_id, v.property); l.vendas += Number(v.valor_final ?? 0); l.comissao += comissaoDe(v)?.valor ?? 0; }
  for (const d of despesas.data) linha(d.property_id, d.property).despesas += Number(d.valor ?? 0);
  const resumo = [...porImovel.values()].sort((a, b) => (b.comissao - b.despesas) - (a.comissao - a.despesas));

  const periodo = de || ate ? `${de ? dataBR(de) : "início"} a ${ate ? dataBR(ate) : "hoje"}` : "todos os períodos";

  return (
    <div className="space-y-8">
      <CabecalhoPagina variante="simples" eyebrow="CRM · Financeiro" titulo="Financeiro do imóvel"
        subtitulo="Fechamentos, comissões e despesas de cada imóvel, por período." />

      <form className="cartao flex flex-wrap items-end gap-3 p-4 text-sm">
        <label className="text-xs text-texto-2">De<input type="date" name="de" defaultValue={de} className={CAMPO_COMPACTO + " mt-1 block"} /></label>
        <label className="text-xs text-texto-2">Até<input type="date" name="ate" defaultValue={ate} className={CAMPO_COMPACTO + " mt-1 block"} /></label>
        <button className="btn-verde px-4 py-2">Filtrar</button>
        {(de || ate) && <Link href="?" className="px-2 py-2 text-texto-2 hover:text-texto">Limpar</Link>}
        <span className="ml-auto text-texto-2">Período: <strong className="text-texto">{periodo}</strong></span>
      </form>

      {semMigration && (
        <p className="cartao p-4 text-sm text-alerta" role="alert">As despesas por imóvel aparecem depois da migration 0178 (despesa ligada ao imóvel).</p>
      )}

      <Indicadores itens={[
        { rotulo: "Receita (fechamentos)", valor: formatBRL(receita), icone: CircleDollarSign, nota: `${vendas.data.length} venda(s)` },
        { rotulo: "Comissão gerada", valor: formatBRL(comissao), icone: HandCoins, href: "/admin/comissoes" },
        { rotulo: "Despesas de imóvel", valor: formatBRL(gastos), icone: Receipt, nota: `${despesas.data.length} despesa(s)`, href: "/admin/registros/despesas" },
        { rotulo: "Resultado (comissão − despesas)", valor: formatBRL(comissao - gastos), icone: Scale, destaque: comissao - gastos < 0 },
      ]} />

      <Secao titulo="Resultado por imóvel">
        <div className={TABELA_CAIXA}>
          <table className={TABELA}>
            <thead className={THEAD}><tr><th className={TH}>Imóvel</th><th className={TH + " text-right"}>Vendas</th><th className={TH + " text-right"}>Comissão</th><th className={TH + " text-right"}>Despesas</th><th className={TH + " text-right"}>Resultado</th></tr></thead>
            <tbody className={TBODY}>
              {resumo.map((r, i) => (
                <tr key={i} className={TR}>
                  <td className={TD}><span className={CODIGO}>{r.imovel?.codigo ?? "—"}</span> <span className="text-texto">{r.imovel?.titulo ?? ""}</span></td>
                  <td className={TD + " text-right tabular-nums"}>{formatBRL(r.vendas)}</td>
                  <td className={TD + " text-right tabular-nums"}>{formatBRL(r.comissao)}</td>
                  <td className={TD + " text-right tabular-nums"}>{formatBRL(r.despesas)}</td>
                  <td className={TD + " text-right font-semibold tabular-nums " + (r.comissao - r.despesas < 0 ? "text-critico" : "text-texto")}>{formatBRL(r.comissao - r.despesas)}</td>
                </tr>
              ))}
              {!resumo.length && <tr><td colSpan={5} className="px-4 py-10 text-center text-texto-2">Nenhum fechamento ou despesa de imóvel no período.</td></tr>}
            </tbody>
          </table>
        </div>
      </Secao>

      <div className="grid gap-8 xl:grid-cols-2">
        <Secao titulo="Fechamentos">
          <div className={TABELA_CAIXA}>
            <table className={TABELA}>
              <thead className={THEAD}><tr><th className={TH}>Data</th><th className={TH}>Imóvel</th><th className={TH + " text-right"}>Valor</th><th className={TH + " text-right"}>Comissão</th></tr></thead>
              <tbody className={TBODY}>
                {vendas.data.map((v) => {
                  const c = comissaoDe(v);
                  return (
                    <tr key={v.id} className={TR}>
                      <td className={TD + " whitespace-nowrap"}>{dataBR(v.data_venda)}</td>
                      <td className={TD}><span className={CODIGO}>{v.property?.codigo}</span></td>
                      <td className={TD + " text-right tabular-nums"}>{formatBRL(Number(v.valor_final))}</td>
                      <td className={TD + " text-right tabular-nums"}>{c ? <>{formatBRL(c.valor)} <span className="block text-xs text-texto-2">{COMISSAO_LABEL[c.status] ?? c.status}</span></> : "—"}</td>
                    </tr>
                  );
                })}
                {!vendas.data.length && <tr><td colSpan={4} className="px-4 py-10 text-center text-texto-2">Nenhuma venda registrada no período. As vendas entram pelo Comercial, ao fechar a negociação.</td></tr>}
              </tbody>
            </table>
          </div>
        </Secao>

        <Secao titulo="Despesas de imóvel" acao={
          <Link href="/admin/registros/despesas" className="inline-flex items-center gap-1.5 text-sm font-semibold text-verde hover:underline underline-offset-4"><Plus className="size-4" /> Nova despesa</Link>
        }>
          <div className={TABELA_CAIXA}>
            <table className={TABELA}>
              <thead className={THEAD}><tr><th className={TH}>Vencimento</th><th className={TH}>Imóvel</th><th className={TH}>Descrição</th><th className={TH + " text-right"}>Valor</th><th className={TH}>Status</th></tr></thead>
              <tbody className={TBODY}>
                {despesas.data.map((d) => (
                  <tr key={d.id} className={TR}>
                    <td className={TD + " whitespace-nowrap"}>{d.vencimento ? dataBR(d.vencimento) : "—"}</td>
                    <td className={TD}><span className={CODIGO}>{d.property?.codigo}</span></td>
                    <td className={TD}>{d.descricao}<span className={"block " + CODIGO}>{d.codigo}</span></td>
                    <td className={TD + " text-right tabular-nums"}>{formatBRL(Number(d.valor))}</td>
                    <td className={TD}><span className={"rounded-full px-2 py-0.5 text-xs font-semibold " + (d.status === "paga" ? "bg-verde/15 text-verde" : "bg-ouro/15 text-ouro")}>{DESPESA_LABEL[d.status] ?? d.status}</span></td>
                  </tr>
                ))}
                {!despesas.data.length && <tr><td colSpan={5} className="px-4 py-10 text-center text-texto-2">Nenhuma despesa de imóvel no período. Ao lançar uma despesa, escolha o imóvel.</td></tr>}
              </tbody>
            </table>
          </div>
        </Secao>
      </div>
    </div>
  );
}
