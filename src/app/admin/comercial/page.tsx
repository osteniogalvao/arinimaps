import Link from "next/link";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { exigirSetor } from "@/lib/setores-servidor";
import { ETAPAS, ETAPA_LABEL } from "@/lib/funil";
import { CalendarClock, FileText, Handshake, TrendingUp, UserPlus, Users } from "lucide-react";
import { formatBRL } from "@/lib/format";
import { CabecalhoSetor, Indicadores, Secao, TarefasDoSetor, contar, dataHoraBR, LinkAcao } from "@/components/admin/Painel";
import { CODIGO, LINHA_LISTA, LISTA, LISTA_VAZIA } from "@/components/admin/estilos";
import { Etiqueta } from "@/components/ui/Pagina";
import { pendenciasIntermediador } from "@/lib/acompanhamento/servidor";
import PendenciasIntermediador from "@/components/acompanhamento/PendenciasIntermediador";

const dias = (d: string) => Math.floor((Date.now() - new Date(d).getTime()) / 86_400_000);

/** Comercial: o funil em números, as visitas marcadas e o que está parado. */
export default async function PainelComercial() {
  const user = await exigirSetor("comercial");
  const admin = supabaseAdmin();
  const agora = new Date().toISOString();
  const ha30 = new Date(Date.now() - 30 * 86_400_000).toISOString();

  const [leads30, { data: opps }, { data: visitas }, { data: propostas }, vendas30, parceirosAtivos] = await Promise.all([
    contar("leads", (q) => q.gte("created_at", ha30)),
    admin.from("opportunities")
      .select("id, codigo, etapa, updated_at, responsavel_tipo, lead:leads(nome), property:properties(codigo, titulo)")
      .not("etapa", "in", "(fechado,pos_venda,perdido)").order("updated_at").limit(300),
    admin.from("visits")
      .select("id, data_hora, status, opportunity:opportunities(id, codigo, lead:leads(nome), property:properties(titulo))")
      .eq("status", "agendada").gte("data_hora", agora).order("data_hora").limit(12),
    admin.from("proposals")
      .select("id, valor, autor_lado, created_at, opportunity:opportunities(id, codigo, property:properties(titulo))")
      .eq("status", "enviada").order("created_at", { ascending: false }).limit(12),
    admin.from("sales").select("valor_final").gte("created_at", ha30)
      .then(({ data }) => ({ n: data?.length ?? 0, volume: (data ?? []).reduce((s, v) => s + Number(v.valor_final), 0) })),
    contar("partners", (q) => q.in("status", ["aprovado", "ativo"])),
  ]);

  const pendencias = await pendenciasIntermediador({ central: true }).catch(() => null);

  const porEtapa = new Map<string, number>();
  for (const o of opps ?? []) porEtapa.set(o.etapa, (porEtapa.get(o.etapa) ?? 0) + 1);
  const maior = Math.max(1, ...porEtapa.values());
  const novos = porEtapa.get("novo_lead") ?? 0;
  // sem movimento há 7 dias ou mais: o lead esfria
  const paradas = (opps ?? []).filter((o) => dias(o.updated_at) >= 7).slice(0, 12);

  type Opp = { id: string; codigo: string; lead?: { nome: string } | null; property?: { codigo?: string; titulo: string } | null };

  return (
    <div className="space-y-10 md:space-y-12">
      <CabecalhoSetor setor="comercial" />

      <Indicadores itens={[
        { rotulo: "Leads novos sem contato", icone: UserPlus, valor: novos, href: "/admin/leads", destaque: novos > 0 },
        { rotulo: "Interessados em 30 dias", icone: Users, valor: leads30 },
        { rotulo: "Vendas em 30 dias", icone: TrendingUp, valor: vendas30.n, nota: vendas30.n ? formatBRL(vendas30.volume) : undefined },
        { rotulo: "Parceiros ativos", icone: Handshake, valor: parceirosAtivos, href: "/admin/cadastros" },
      ]} />

      {/* item 28: pendências da Central como intermediadora (visita sem feedback, proprietário sem atualização) */}
      {pendencias && <PendenciasIntermediador pendencias={pendencias} hrefOportunidade="/admin/oportunidades" />}

      <Secao titulo="Funil agora" acao={<LinkAcao href="/admin/funil">Abrir o funil</LinkAcao>}>
        <div className="cartao p-6 space-y-3">
          {ETAPAS.filter((e) => !["fechado", "pos_venda"].includes(e)).map((e) => {
            const n = porEtapa.get(e) ?? 0;
            return (
              <div key={e} className="grid grid-cols-[8rem_1fr_2.5rem] sm:grid-cols-[11rem_1fr_3rem] items-center gap-4 text-[0.95rem]">
                <span className="text-texto-2 truncate">{ETAPA_LABEL[e]}</span>
                <span className="h-2.5 rounded-full bg-superficie-2 overflow-hidden">
                  <span className={"block h-full rounded-full " + (e === "novo_lead" && n > 0 ? "bg-ouro" : "bg-verde")} style={{ width: `${(n / maior) * 100}%` }} />
                </span>
                <span className="lp-display text-right text-lg leading-none tabular-nums text-texto">{n}</span>
              </div>
            );
          })}
        </div>
      </Secao>

      <div className="grid gap-10 lg:gap-6 lg:grid-cols-2">
        <Secao titulo="Próximas visitas">
          <div className={LISTA}>
            {(visitas ?? []).map((v) => {
              const o = v.opportunity as unknown as Opp | null;
              return (
                <Link key={v.id} href={o ? `/admin/oportunidades/${o.id}` : "/admin/funil"}
                  className="block px-5 py-3.5 text-[0.95rem] transition-colors hover:bg-superficie-2/70">
                  <p className="flex items-center gap-2 font-medium text-texto">
                    <CalendarClock className="size-4 shrink-0 text-verde" />
                    <span className="tabular-nums">{dataHoraBR(v.data_hora)}</span> · {o?.lead?.nome ?? "interessado"}
                  </p>
                  <p className="mt-0.5 text-sm text-texto-2">{o?.codigo} · {o?.property?.titulo}</p>
                </Link>
              );
            })}
            {!visitas?.length && <p className={LISTA_VAZIA}>Nenhuma visita marcada.</p>}
          </div>
        </Secao>

        <Secao titulo="Propostas aguardando resposta">
          <div className={LISTA}>
            {(propostas ?? []).map((p) => {
              const o = p.opportunity as unknown as Opp | null;
              return (
                <Link key={p.id} href={o ? `/admin/oportunidades/${o.id}` : "/admin/funil"}
                  className="block px-5 py-3.5 text-[0.95rem] transition-colors hover:bg-superficie-2/70">
                  <p className="flex items-center gap-2 font-medium text-texto">
                    <FileText className="size-4 shrink-0 text-verde" />
                    <span className="tabular-nums">{formatBRL(Number(p.valor))}</span> · do {p.autor_lado}
                  </p>
                  <p className="mt-0.5 text-sm text-texto-2">{o?.codigo} · {o?.property?.titulo}</p>
                </Link>
              );
            })}
            {!propostas?.length && <p className={LISTA_VAZIA}>Nenhuma proposta em aberto.</p>}
          </div>
        </Secao>
      </div>

      <Secao titulo="Oportunidades paradas há 7 dias ou mais">
        <div className={LISTA}>
          {paradas.map((o) => {
            const op = o as unknown as Opp & { etapa: string; updated_at: string };
            return (
              <Link key={op.id} href={`/admin/oportunidades/${op.id}`}
                className={LINHA_LISTA}>
                <span className={CODIGO}>{op.codigo}</span>
                <span className="flex-1 min-w-48 font-medium text-texto">
                  {op.lead?.nome ?? "interessado"}<span className="font-normal text-sm text-texto-2"> · {op.property?.titulo}</span>
                </span>
                <Etiqueta>{ETAPA_LABEL[op.etapa]}</Etiqueta>
                <span className="text-xs font-semibold text-alerta tabular-nums whitespace-nowrap">{dias(op.updated_at)} dias</span>
              </Link>
            );
          })}
          {!paradas.length && <p className={LISTA_VAZIA}>Nenhuma oportunidade parada.</p>}
        </div>
      </Secao>

      <TarefasDoSetor setor="comercial" souEu={user.id} />
    </div>
  );
}
