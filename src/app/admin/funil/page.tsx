import Link from "next/link";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ETAPAS, ETAPA_LABEL } from "@/lib/funil";
import { formatBRL } from "@/lib/format";
import { exigirSetor } from "@/lib/setores-servidor";
import { Building2, UserRound } from "lucide-react";
import { CabecalhoPagina } from "@/components/ui/Pagina";

/**
 * Teto do quadro: as N oportunidades mais recentes. O PostgREST cortaria em
 * 1000 sem avisar; aqui o corte é explícito e a página diz quantas ficaram de
 * fora (a busca por código fica em Oportunidades).
 */
const MAX_CARDS = 500;

export default async function AdminFunil() {
  await exigirSetor("comercial");
  const { data: recentes, count } = await supabaseAdmin()
    .from("opportunities")
    .select(`
      id, codigo, etapa, responsavel_tipo, created_at,
      lead:leads(nome),
      property:properties(codigo, titulo, valor),
      partner:partners!opportunities_responsavel_partner_id_fkey(razao_social)
    `, { count: "exact" })
    .order("created_at", { ascending: false }).limit(MAX_CARDS);
  // no quadro a mais antiga fica no topo da coluna
  const opps = [...(recentes ?? [])].reverse();

  const colunas = [...ETAPAS, "perdido"] as string[];
  const porEtapa = new Map<string, NonNullable<typeof opps>>(colunas.map((e) => [e, []]));
  for (const o of opps ?? []) porEtapa.get(o.etapa)?.push(o);

  return (
    <div className="space-y-6">
      <CabecalhoPagina eyebrow="Comercial" titulo="Funil comercial"
        subtitulo="Clique no card para abrir a oportunidade completa (timeline, visitas, propostas, contrato, venda)." />
      {count != null && count > opps.length && (
        <p className="rounded-xl border border-alerta/40 bg-alerta/10 px-4 py-3 text-sm text-texto">
          Mostrando as {opps.length} oportunidades mais recentes de {count}. As contagens das colunas valem para as que estão na tela.
        </p>
      )}
      <div className="-mx-5 flex gap-4 overflow-x-auto px-5 pb-4 md:-mx-8 md:px-8">
        {colunas.map((etapa) => {
          const cards = porEtapa.get(etapa) ?? [];
          if (etapa === "perdido" && !cards.length) return null;
          const perdido = etapa === "perdido";
          const ganho = etapa === "fechado" || etapa === "pos_venda";
          const total = cards.reduce((s, o) => s + Number((o.property as unknown as { valor: number | null } | null)?.valor ?? 0), 0);
          return (
            <div key={etapa} className="flex w-[17rem] shrink-0 flex-col rounded-2xl border border-linha bg-superficie-2/50">
              <div className={"rounded-t-2xl border-t-4 px-4 pt-3 pb-3 " + (perdido ? "border-t-critico" : ganho ? "border-t-verde" : "border-t-ouro")}>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-texto">{ETAPA_LABEL[etapa]}</p>
                  <span className={"grid min-w-7 h-6 place-items-center rounded-md px-1.5 text-xs font-bold tabular-nums " +
                    (perdido ? "bg-critico/14 text-critico" : ganho ? "bg-verde/14 text-verde" : "bg-superficie text-texto-2 border border-linha")}>
                    {cards.length}
                  </span>
                </div>
                {total > 0 && <p className="mt-1 text-xs text-texto-2 tabular-nums">{formatBRL(total)}</p>}
              </div>
              <div className="flex-1 space-y-2.5 px-2.5 pb-2.5 min-h-24">
                {cards.map((o) => {
                  const lead = o.lead as unknown as { nome: string } | null;
                  const prop = o.property as unknown as { codigo: string; titulo: string; valor: number | null } | null;
                  const partner = o.partner as unknown as { razao_social: string } | null;
                  return (
                    <Link key={o.id} href={`/admin/oportunidades/${o.id}`}
                      className="block rounded-xl border border-linha bg-superficie p-3.5 shadow-[0_1px_2px_var(--sombra-botao)] transition-colors hover:border-verde/60">
                      <p className="font-mono text-[10px] text-texto-2 tabular-nums">{o.codigo}</p>
                      <p className="mt-1 font-semibold leading-snug text-texto">{lead?.nome ?? "—"}</p>
                      <p className="mt-1 flex items-start gap-1.5 text-sm leading-snug text-texto-2">
                        <Building2 className="mt-0.5 size-3.5 shrink-0" /><span className="line-clamp-2">{prop?.titulo}</span>
                      </p>
                      <div className="mt-2.5 flex items-center justify-between gap-2 border-t border-linha pt-2.5">
                        <span className="text-sm font-bold text-verde tabular-nums">{formatBRL(prop?.valor ?? null)}</span>
                        <span className="inline-flex min-w-0 items-center gap-1 text-[11px] text-texto-2">
                          <UserRound className="size-3 shrink-0" />
                          <span className="truncate">
                            {o.responsavel_tipo === "arini" ? "Arini" : o.responsavel_tipo === "proprietario" ? "Proprietário" : partner?.razao_social ?? "Parceiro"}
                          </span>
                        </span>
                      </div>
                    </Link>
                  );
                })}
                {!cards.length && <p className="px-2 py-6 text-center text-xs text-texto-2">Nenhuma oportunidade</p>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
