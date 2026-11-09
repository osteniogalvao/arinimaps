import { supabaseAdmin } from "@/lib/supabase/admin";
import { ETAPAS, ETAPA_LABEL, LEAD_ORIGEM_LABEL } from "@/lib/funil";
import { formatBRL } from "@/lib/format";
import { exigirSetor } from "@/lib/setores-servidor";
import {
  CircleDollarSign, Filter, Hourglass, Percent, Receipt, TrendingDown, TrendingUp, Wallet,
} from "lucide-react";
import { CabecalhoPagina, Estatistica } from "@/components/ui/Pagina";
import { Secao } from "@/components/admin/Painel";
import { lerEmLotes } from "@/lib/supabase/lotes";

type Kpis = {
  oportunidades_por_etapa: Record<string, number>;
  vendas_total: number;
  comissoes_por_status: Record<string, number>;
  faturas_por_status: Record<string, number>;
  leads_por_origem: Record<string, number>;
};

/**
 * Indicadores somados no banco (fn_relatorio_kpis, migration 0063). Sem a
 * função (migration não aplicada), lê as colunas em lotes e soma aqui — nunca
 * a tabela inteira num pedido só, que o PostgREST corta em 1000 linhas.
 */
async function lerKpis(): Promise<Kpis> {
  const admin = supabaseAdmin();
  const { data, error } = await admin.rpc("fn_relatorio_kpis");
  if (!error && data) return data as Kpis;

  const [opps, vendas, comissoes, faturas, leads] = await Promise.all([
    lerEmLotes<{ etapa: string }>((de, ate) => admin.from("opportunities").select("etapa").order("id").range(de, ate)),
    lerEmLotes<{ valor_final: number }>((de, ate) => admin.from("sales").select("valor_final").order("id").range(de, ate)),
    lerEmLotes<{ valor: number; status: string }>((de, ate) => admin.from("commissions").select("valor, status").order("id").range(de, ate)),
    lerEmLotes<{ valor: number; status: string }>((de, ate) => admin.from("invoices").select("valor, status").order("id").range(de, ate)),
    lerEmLotes<{ origem: string }>((de, ate) => admin.from("leads").select("origem").order("id").range(de, ate)),
  ]);
  const contar = (linhas: Record<string, unknown>[], campo: string) => {
    const m: Record<string, number> = {};
    for (const l of linhas) { const k = String(l[campo] ?? "direto"); m[k] = (m[k] ?? 0) + 1; }
    return m;
  };
  const somar = (linhas: { valor: number; status: string }[]) => {
    const m: Record<string, number> = {};
    for (const l of linhas) m[l.status] = (m[l.status] ?? 0) + Number(l.valor);
    return m;
  };
  return {
    oportunidades_por_etapa: contar(opps.data, "etapa"),
    vendas_total: vendas.data.reduce((s, v) => s + Number(v.valor_final), 0),
    comissoes_por_status: somar(comissoes.data),
    faturas_por_status: somar(faturas.data),
    leads_por_origem: contar(leads.data, "origem"),
  };
}

export default async function AdminRelatorios() {
  await exigirSetor("diretoria");
  const kpis = await lerKpis();

  const porEtapa = new Map<string, number>(Object.entries(kpis.oportunidades_por_etapa).map(([k, v]) => [k, Number(v)]));
  const totalOpps = [...porEtapa.values()].reduce((s, n) => s + n, 0);
  const fechadas = (porEtapa.get("fechado") ?? 0) + (porEtapa.get("pos_venda") ?? 0);
  const perdidas = porEtapa.get("perdido") ?? 0;
  const conversao = totalOpps ? ((fechadas / totalOpps) * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) : "0";

  const somaVendas = Number(kpis.vendas_total ?? 0);
  const somaComissao = (st: string[]) => st.reduce((s, k) => s + Number(kpis.comissoes_por_status[k] ?? 0), 0);
  const somaFaturas = (st: string[]) => st.reduce((s, k) => s + Number(kpis.faturas_por_status[k] ?? 0), 0);

  const porOrigem = new Map<string, number>(Object.entries(kpis.leads_por_origem).map(([k, v]) => [k, Number(v)]));

  const maxEtapa = Math.max(1, ...[...porEtapa.values()]);

  return (
    <div className="space-y-10 md:space-y-12">
      <CabecalhoPagina eyebrow="Diretoria" titulo="Relatórios"
        subtitulo="Indicadores gerais da empresa: funil, vendas, comissões e mensalidades." />

      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        {[
          { l: "Oportunidades", v: String(totalOpps), i: Filter },
          { l: "Conversão em venda", v: `${conversao}%`, i: Percent },
          { l: "Volume vendido (VGV)", v: formatBRL(somaVendas), i: TrendingUp },
          { l: "Comissão recebida", v: formatBRL(somaComissao(["paga", "conciliada"])), i: CircleDollarSign },
          { l: "Comissão a receber", v: formatBRL(somaComissao(["registrada", "cobrada"])), i: Wallet },
          { l: "Mensalidades recebidas", v: formatBRL(somaFaturas(["paga"])), i: Receipt },
          { l: "Mensalidades em aberto", v: formatBRL(somaFaturas(["aberta", "vencida"])), i: Hourglass },
          { l: "Oportunidades perdidas", v: String(perdidas), i: TrendingDown },
        ].map((c) => (
          <Estatistica key={c.l} icone={c.i} valor={<span className="tabular-nums text-[1.6rem] md:text-3xl">{c.v}</span>} rotulo={c.l} />
        ))}
      </div>

      <div className="grid gap-10 lg:gap-6 lg:grid-cols-[1.6fr_1fr]">
        <Secao titulo="Funil por etapa">
          <div className="cartao p-6 space-y-3">
            {[...ETAPAS, "perdido"].map((e) => {
              const n = porEtapa.get(e) ?? 0;
              return (
                <div key={e} className="grid grid-cols-[8rem_1fr_2.5rem] sm:grid-cols-[11rem_1fr_3rem] items-center gap-4 text-[0.95rem]">
                  <span className="truncate text-texto-2">{ETAPA_LABEL[e]}</span>
                  <div className="h-2.5 overflow-hidden rounded-full bg-superficie-2">
                    <div className={`h-full rounded-full ${e === "perdido" ? "bg-critico/70" : "bg-verde"}`}
                      style={{ width: `${(n / maxEtapa) * 100}%` }} />
                  </div>
                  <span className="lp-display text-right text-lg leading-none tabular-nums text-texto">{n}</span>
                </div>
              );
            })}
          </div>
        </Secao>

        <Secao titulo="Leads por origem">
          <div className="cartao p-6 text-[0.95rem]">
            {[...porOrigem.entries()].map(([origem, n]) => (
              <p key={origem} className="flex justify-between gap-3 border-b border-linha py-2.5 last:border-0">
                <span className="text-texto-2">{LEAD_ORIGEM_LABEL[origem] ?? origem}</span>
                <span className="font-semibold tabular-nums text-texto">{n}</span>
              </p>
            ))}
            {!porOrigem.size && <p className="py-4 text-center text-texto-2">Sem leads ainda.</p>}
          </div>
        </Secao>
      </div>
    </div>
  );
}
