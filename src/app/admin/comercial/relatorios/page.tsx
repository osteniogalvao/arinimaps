import Link from "next/link";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { exigirSetor } from "@/lib/setores-servidor";
import { CabecalhoPagina } from "@/components/ui/Pagina";
import { TABELA, TABELA_CAIXA, TBODY, TD, TH, THEAD, TR, aba } from "@/components/admin/estilos";
import { ETAPAS, ETAPA_LABEL } from "@/lib/funil";
import { ORIGEM_LABEL } from "@/lib/crm-comercial";
import { formatBRL } from "@/lib/format";

const PERIODOS = [30, 90, 365] as const;

/** Relatórios do CRM comercial: conversão por origem e por etapa, perdas e tempos. */
export default async function RelatoriosComerciais({ searchParams }: PageProps<"/admin/comercial/relatorios">) {
  await exigirSetor("comercial", "diretoria");
  const sp = await searchParams;
  const dias = PERIODOS.includes(Number(sp.dias) as never) ? Number(sp.dias) : 90;
  const desde = new Date(Date.now() - dias * 86_400_000).toISOString();
  const admin = supabaseAdmin();
  const comCrm = await admin.from("oportunidades_oficiais")
    .select("id, etapa, created_at, motivo_perda, atribuida_em, primeiro_atendimento_em, lead:leads(origem), property:properties(valor)")
    .gte("created_at", desde).limit(20000);
  const r = comCrm.error
    ? await admin.from("oportunidades_oficiais").select("id, etapa, created_at, motivo_perda, lead:leads(origem), property:properties(valor)").gte("created_at", desde).limit(20000)
    : comCrm;
  type O = { id: string; etapa: string; created_at: string; motivo_perda: string | null; atribuida_em?: string | null; primeiro_atendimento_em?: string | null; lead: { origem: string } | null; property: { valor: number | null } | null };
  const opps = (r.data ?? []) as unknown as O[];
  const ids = opps.map((o) => o.id);
  const { data: vendas } = ids.length
    ? await admin.from("vendas_oficiais").select("opportunity_id, valor_final, created_at").in("opportunity_id", ids.slice(0, 5000))
    : { data: [] as { opportunity_id: string; valor_final: number; created_at: string }[] };
  const venda = new Map((vendas ?? []).map((v) => [v.opportunity_id, v]));

  const ganho = (e: string) => e === "fechado" || e === "pos_venda";
  // por origem
  const origens = new Map<string, { leads: number; ganhos: number; perdidos: number; vgv: number }>();
  for (const o of opps) {
    const k = o.lead?.origem ?? "pagina";
    const x = origens.get(k) ?? { leads: 0, ganhos: 0, perdidos: 0, vgv: 0 };
    x.leads++;
    if (ganho(o.etapa)) { x.ganhos++; x.vgv += Number(venda.get(o.id)?.valor_final ?? 0); }
    if (o.etapa === "perdido") x.perdidos++;
    origens.set(k, x);
  }
  // funil: quantas chegaram pelo menos até cada etapa (pela etapa atual; perdidas contam só no total)
  const posicao = (e: string) => ETAPAS.indexOf(e as (typeof ETAPAS)[number]);
  const vivas = opps.filter((o) => o.etapa !== "perdido");
  const alcance = ETAPAS.map((e) => ({ etapa: e, n: vivas.filter((o) => posicao(o.etapa) >= posicao(e)).length }));
  // perdas
  const perdas = new Map<string, number>();
  for (const o of opps.filter((x) => x.etapa === "perdido")) {
    const k = (o.motivo_perda ?? "").split(" · ")[0].trim() || "Sem motivo informado";
    perdas.set(k, (perdas.get(k) ?? 0) + 1);
  }
  const perdasOrd = [...perdas.entries()].sort((a, b) => b[1] - a[1]);
  const totalPerdas = perdasOrd.reduce((s, [, n]) => s + n, 0);
  // tempos
  const minutos = opps.filter((o) => o.atribuida_em && o.primeiro_atendimento_em)
    .map((o) => (+new Date(o.primeiro_atendimento_em!) - +new Date(o.atribuida_em!)) / 60_000).filter((m) => m >= 0);
  const mediana = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
  const tempoContato = mediana(minutos);
  const ciclos = opps.filter((o) => venda.has(o.id)).map((o) => (+new Date(venda.get(o.id)!.created_at) - +new Date(o.created_at)) / 86_400_000);
  const ciclo = mediana(ciclos);
  const ganhosTotal = opps.filter((o) => ganho(o.etapa)).length;
  const fmtMin = (m: number | null) => (m == null ? "—" : m < 60 ? `${Math.round(m)} min` : m < 1440 ? `${(m / 60).toFixed(1)} h` : `${(m / 1440).toFixed(1)} dias`);
  const maior = Math.max(1, alcance[0]?.n ?? 1);

  return (
    <div className="max-w-6xl space-y-8">
      <CabecalhoPagina eyebrow="Comercial" titulo="Relatórios comerciais"
        subtitulo={`Oportunidades criadas nos últimos ${dias} dias: de onde vêm, até onde chegam e por que se perdem.`} />
      <div className="flex gap-2">
        {PERIODOS.map((p) => <Link key={p} href={`/admin/comercial/relatorios?dias=${p}`} className={aba(dias === p)}>{p === 365 ? "12 meses" : `${p} dias`}</Link>)}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {([
          ["Oportunidades", opps.length],
          ["Conversão em venda", opps.length ? `${((ganhosTotal / opps.length) * 100).toFixed(1)}%` : "—"],
          ["Tempo até o 1º contato (mediana)", comCrm.error ? "—" : fmtMin(tempoContato)],
          ["Ciclo até a venda (mediana)", ciclo == null ? "—" : `${Math.round(ciclo)} dias`],
        ] as const).map(([rot, v]) => (
          <div key={rot} className="cartao p-4"><p className="text-xs uppercase tracking-wider text-texto-2">{rot}</p><p className="lp-display mt-1 text-2xl tabular-nums text-texto">{v}</p></div>
        ))}
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-texto">Funil: até onde as oportunidades chegaram</h2>
        <div className="cartao space-y-2.5 p-5">
          {alcance.map(({ etapa, n }) => (
            <div key={etapa} className="grid grid-cols-[9rem_1fr_6rem] items-center gap-3 text-sm sm:grid-cols-[12rem_1fr_7rem]">
              <span className="truncate text-texto-2">{ETAPA_LABEL[etapa]}</span>
              <span className="h-2.5 overflow-hidden rounded-full bg-superficie-2"><span className="block h-full rounded-full bg-verde" style={{ width: `${(n / maior) * 100}%` }} /></span>
              <span className="text-right tabular-nums text-texto">{n} <span className="text-xs text-texto-2">({Math.round((n / maior) * 100)}%)</span></span>
            </div>
          ))}
          <p className="pt-2 text-xs text-texto-2">Conta pela etapa atual; as {totalPerdas} perdidas ficam fora do funil e estão abaixo, por motivo.</p>
        </div>
      </section>

      <div className="grid gap-8 lg:grid-cols-2">
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-texto">Por origem</h2>
          <div className={TABELA_CAIXA}>
            <table className={TABELA + " !min-w-0"}>
              <thead className={THEAD}><tr><th className={TH}>Origem</th><th className={TH}>Leads</th><th className={TH}>Vendas</th><th className={TH}>Conversão</th><th className={TH}>VGV</th></tr></thead>
              <tbody className={TBODY}>
                {[...origens.entries()].sort((a, b) => b[1].leads - a[1].leads).map(([k, x]) => (
                  <tr key={k} className={TR}>
                    <td className={TD}>{ORIGEM_LABEL[k] ?? k}</td><td className={TD + " tabular-nums"}>{x.leads}</td><td className={TD + " tabular-nums"}>{x.ganhos}</td>
                    <td className={TD + " tabular-nums"}>{((x.ganhos / x.leads) * 100).toFixed(1)}%</td><td className={TD + " tabular-nums"}>{formatBRL(x.vgv)}</td>
                  </tr>
                ))}
                {!origens.size && <tr><td className={TD} colSpan={5}>Sem oportunidades no período.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-texto">Motivos de perda</h2>
          <div className="cartao space-y-2.5 p-5">
            {perdasOrd.map(([k, n]) => (
              <div key={k} className="grid grid-cols-[1fr_8rem_3rem] items-center gap-3 text-sm">
                <span className="truncate text-texto">{k}</span>
                <span className="h-2 overflow-hidden rounded-full bg-superficie-2"><span className="block h-full rounded-full bg-critico/70" style={{ width: `${(n / Math.max(1, perdasOrd[0][1])) * 100}%` }} /></span>
                <span className="text-right tabular-nums text-texto-2">{n}</span>
              </div>
            ))}
            {!perdasOrd.length && <p className="text-sm text-texto-2">Nenhuma perda no período.</p>}
          </div>
        </section>
      </div>
    </div>
  );
}
