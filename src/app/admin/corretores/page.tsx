import Link from "next/link";
import { Target } from "lucide-react";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { exigirSetor } from "@/lib/setores-servidor";
import { CabecalhoPagina, Vazio } from "@/components/ui/Pagina";
import { aba } from "@/components/admin/estilos";
import { formatBRL } from "@/lib/format";
import { mesDe } from "@/lib/crm-comercial";
import MetaForm from "@/components/crm-comercial/MetaForm";

type Numeros = { leads: number; atendimentos: number; visitas: number; propostas: number; vendas: number; vgv: number; perdidos: number };
const ZERO: Numeros = { leads: 0, atendimentos: 0, visitas: 0, propostas: 0, vendas: 0, vgv: 0, perdidos: 0 };

function Barra({ feito, meta, dinheiro = false }: { feito: number; meta: number; dinheiro?: boolean }) {
  const pct = meta > 0 ? Math.min(100, Math.round((feito / meta) * 100)) : 0;
  return (
    <div className="min-w-24">
      <p className="tabular-nums text-sm text-texto">
        <b>{dinheiro ? formatBRL(feito) : feito}</b>
        {meta > 0 && <span className="text-texto-2"> / {dinheiro ? formatBRL(meta) : meta}</span>}
      </p>
      {meta > 0 && (
        <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-superficie-2">
          <span className={"block h-full rounded-full " + (pct >= 100 ? "bg-verde" : pct >= 60 ? "bg-ouro" : "bg-critico/70")} style={{ width: `${pct}%` }} />
        </span>
      )}
    </div>
  );
}

/**
 * Desempenho dos corretores no mês, contra a meta (migration 0147). A
 * Diretoria define as metas; o Comercial acompanha.
 */
export default async function Corretores({ searchParams }: PageProps<"/admin/corretores">) {
  const user = await exigirSetor("comercial", "diretoria");
  const sp = await searchParams;
  const mes = typeof sp.mes === "string" && /^\d{4}-\d{2}-01$/.test(sp.mes) ? sp.mes : mesDe();
  const [ano, m] = mes.split("-").map(Number);
  const ini = new Date(Date.UTC(ano, m - 1, 1, 3)).toISOString();
  const fim = new Date(Date.UTC(ano, m, 1, 3)).toISOString();
  const mesAnt = new Date(Date.UTC(ano, m - 2, 1)).toISOString().slice(0, 10);
  const mesSeg = new Date(Date.UTC(ano, m, 1)).toISOString().slice(0, 10);
  const admin = supabaseAdmin();

  const { data: membros } = await admin.from("profiles").select("user_id, nome, role, setores")
    .in("role", ["admin_central", "analista_arini"]).eq("ativo", true).order("nome");
  const time = (membros ?? []).filter((p) => p.role === "admin_central" || (p.setores ?? []).includes("comercial"));
  const ids = time.map((p) => p.user_id);

  const [opps, visitas, propostas, vendas, metasR] = await Promise.all([
    admin.from("oportunidades_oficiais").select("id, responsavel_user_id, created_at, primeiro_atendimento_em, etapa, updated_at")
      .in("responsavel_user_id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]).gte("updated_at", ini).limit(10000),
    admin.from("visits").select("responsavel, data_hora, status, opportunity:opportunities(responsavel_user_id)")
      .gte("data_hora", ini).lt("data_hora", fim).eq("status", "realizada").limit(5000),
    admin.from("proposals").select("created_at, opportunity:opportunities(responsavel_user_id)").gte("created_at", ini).lt("created_at", fim).limit(5000),
    admin.from("vendas_oficiais").select("valor_final, data_venda, opportunity:opportunities(responsavel_user_id)")
      .gte("data_venda", mes).lt("data_venda", mesSeg).limit(5000),
    admin.from("crm_metas").select("user_id, atendimentos, visitas, propostas, vendas, vgv").eq("mes", mes),
  ]);
  if (opps.error) {
    return (
      <div className="max-w-4xl space-y-6">
        <CabecalhoPagina eyebrow="Comercial" titulo="Corretores e metas" />
        <Vazio icone={Target} titulo="Falta atualizar o banco" texto="Esta tela precisa da migration 0065 (rodízio) e da 0147 (CRM comercial)." />
      </div>
    );
  }
  const n = new Map<string, Numeros>(ids.map((id) => [id, { ...ZERO }]));
  const dentro = (d: string | null) => !!d && d >= ini && d < fim;
  for (const o of opps.data ?? []) {
    const x = n.get(o.responsavel_user_id!); if (!x) continue;
    if (dentro(o.created_at)) x.leads++;
    if (dentro(o.primeiro_atendimento_em)) x.atendimentos++;
    if (o.etapa === "perdido" && dentro(o.updated_at)) x.perdidos++;
  }
  const dono = (v: { opportunity: unknown }) => (v.opportunity as { responsavel_user_id: string | null } | null)?.responsavel_user_id ?? null;
  for (const v of visitas.data ?? []) { const x = n.get(v.responsavel ?? dono(v) ?? ""); if (x) x.visitas++; }
  for (const p of propostas.data ?? []) { const x = n.get(dono(p) ?? ""); if (x) x.propostas++; }
  for (const s of vendas.data ?? []) { const x = n.get(dono(s) ?? ""); if (x) { x.vendas++; x.vgv += Number(s.valor_final); } }
  const metas = new Map((metasR.data ?? []).map((mt) => [mt.user_id, mt]));
  const diretoria = user.setores.includes("diretoria");
  const total = [...n.values()].reduce((t, x) => ({ ...t, leads: t.leads + x.leads, atendimentos: t.atendimentos + x.atendimentos,
    visitas: t.visitas + x.visitas, propostas: t.propostas + x.propostas, vendas: t.vendas + x.vendas, vgv: t.vgv + x.vgv, perdidos: t.perdidos + x.perdidos }), { ...ZERO });
  const ranking = [...time].sort((a, b) => (n.get(b.user_id)!.vgv - n.get(a.user_id)!.vgv) || (n.get(b.user_id)!.vendas - n.get(a.user_id)!.vendas) || (n.get(b.user_id)!.visitas - n.get(a.user_id)!.visitas));
  const nomeMes = new Date(Date.UTC(ano, m - 1, 15)).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });

  return (
    <div className="max-w-6xl space-y-6">
      <CabecalhoPagina eyebrow="Comercial" titulo="Corretores e metas"
        subtitulo={<>Leads recebidos, primeiros atendimentos, visitas realizadas, propostas e vendas de cada corretor em <b>{nomeMes}</b>.
          {diretoria ? " Clique em “Meta” para definir os números do mês." : " As metas são definidas pela Diretoria."}</>} />
      <div className="flex flex-wrap items-center gap-2">
        <Link href={`/admin/corretores?mes=${mesAnt}`} className={aba(false)}>← Mês anterior</Link>
        <Link href="/admin/corretores" className={aba(mes === mesDe())}>Mês atual</Link>
        <Link href={`/admin/corretores?mes=${mesSeg}`} className={aba(false)}>Próximo mês →</Link>
      </div>
      {metasR.error && <p className="text-sm text-alerta">As metas aparecem depois da migration 0147 (CRM comercial).</p>}

      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {([["Leads", total.leads], ["Atendidos", total.atendimentos], ["Visitas", total.visitas], ["Propostas", total.propostas], ["Vendas", total.vendas], ["VGV", formatBRL(total.vgv)]] as const).map(([r, v]) => (
          <div key={r} className="cartao p-4"><p className="text-xs uppercase tracking-wider text-texto-2">{r}</p><p className="lp-display mt-1 text-2xl tabular-nums text-texto">{v}</p></div>
        ))}
      </div>

      {!time.length ? (
        <Vazio icone={Target} titulo="Ninguém no Comercial" texto="Coloque a equipe no setor Comercial em Equipe e usuários." />
      ) : (
        <div className="space-y-3">
          {ranking.map((p, i) => {
            const x = n.get(p.user_id)!;
            const mt = metas.get(p.user_id);
            return (
              <section key={p.user_id} className="cartao p-5">
                <div className="flex flex-wrap items-center gap-x-6 gap-y-4">
                  <div className="min-w-44 flex-1">
                    <p className="flex items-center gap-2 font-semibold text-texto">
                      <span className="grid size-7 place-items-center rounded-full bg-ouro/15 text-xs font-bold text-ouro">{i + 1}</span>{p.nome || "—"}
                    </p>
                    <p className="mt-1 text-xs text-texto-2">{x.leads} lead(s) recebido(s) · {x.perdidos} perdido(s)</p>
                  </div>
                  <div><p className="text-[11px] uppercase tracking-wider text-texto-2">Atendimentos</p><Barra feito={x.atendimentos} meta={mt?.atendimentos ?? 0} /></div>
                  <div><p className="text-[11px] uppercase tracking-wider text-texto-2">Visitas</p><Barra feito={x.visitas} meta={mt?.visitas ?? 0} /></div>
                  <div><p className="text-[11px] uppercase tracking-wider text-texto-2">Propostas</p><Barra feito={x.propostas} meta={mt?.propostas ?? 0} /></div>
                  <div><p className="text-[11px] uppercase tracking-wider text-texto-2">Vendas</p><Barra feito={x.vendas} meta={mt?.vendas ?? 0} /></div>
                  <div><p className="text-[11px] uppercase tracking-wider text-texto-2">VGV</p><Barra feito={x.vgv} meta={Number(mt?.vgv ?? 0)} dinheiro /></div>
                  <div className="flex gap-3 text-sm">
                    <Link href={`/admin/leads?corretor=${p.user_id}`} className="font-semibold text-verde hover:underline">Leads</Link>
                    <Link href={`/admin/agenda?corretor=${p.user_id}`} className="font-semibold text-verde hover:underline">Agenda</Link>
                  </div>
                </div>
                {diretoria && !metasR.error && (
                  <MetaForm userId={p.user_id} mes={mes} atual={mt ? { ...mt, vgv: Number(mt.vgv) } : null} />
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
