import Link from "next/link";
import { CalendarClock, CalendarDays, ChevronLeft, ChevronRight, MapPin, PhoneCall } from "lucide-react";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { exigirSetor } from "@/lib/setores-servidor";
import { CabecalhoPagina, Etiqueta } from "@/components/ui/Pagina";
import { CAMPO_COMPACTO, aba } from "@/components/admin/estilos";
import { equipeAtiva } from "@/components/admin/Painel";

type Compromisso = {
  quando: string; tipo: "visita" | "acao"; titulo: string; detalhe: string; oppId: string; codigo: string;
  responsavel: string | null; status?: string;
};

const FUSO = "America/Sao_Paulo";
const diaChave = (d: string | Date) => new Intl.DateTimeFormat("en-CA", { timeZone: FUSO }).format(new Date(d));
const UUID = /^[0-9a-f-]{36}$/i;

/**
 * Agenda do Comercial: visitas marcadas e próximas ações (follow-ups) da
 * semana, por corretor. Ações vencidas aparecem no topo até serem feitas.
 */
export default async function AgendaComercial({ searchParams }: PageProps<"/admin/agenda">) {
  const user = await exigirSetor("comercial");
  const sp = await searchParams;
  const semana = Math.max(-26, Math.min(26, Number(sp.semana) || 0));
  const quem = typeof sp.corretor === "string" && (UUID.test(sp.corretor) || sp.corretor === "todos") ? sp.corretor : user.id;
  const admin = supabaseAdmin();

  // semana de segunda a domingo, no fuso de Brasília
  const hoje = new Date(`${diaChave(new Date())}T12:00:00-03:00`);
  const dow = (hoje.getUTCDay() + 6) % 7;
  const inicio = new Date(hoje.getTime() - dow * 86_400_000 + semana * 7 * 86_400_000);
  inicio.setUTCHours(3, 0, 0, 0);
  const fim = new Date(inicio.getTime() + 7 * 86_400_000);

  const visitasQ = admin.from("visits")
    .select("id, data_hora, status, responsavel, opportunity:opportunities!inner(id, codigo, responsavel_user_id, lead:leads(nome, telefone), property:properties(codigo, titulo, municipality:municipalities!properties_municipality_id_fkey(nome, uf)))")
    .gte("data_hora", inicio.toISOString()).lt("data_hora", fim.toISOString()).order("data_hora").limit(500);

  const acoesQ = (de: string | null, ate: string) => {
    let q = admin.from("oportunidades_oficiais")
      .select("id, codigo, proxima_acao, proxima_acao_em, responsavel_user_id, etapa, lead:leads(nome, telefone), property:properties(codigo, titulo)")
      .not("proxima_acao_em", "is", null).lt("proxima_acao_em", ate).not("etapa", "in", "(fechado,pos_venda,perdido)")
      .order("proxima_acao_em").limit(300);
    if (de) q = q.gte("proxima_acao_em", de);
    if (quem !== "todos") q = q.eq("responsavel_user_id", quem);
    return q;
  };

  const [vis, acoes, vencidas, equipe] = await Promise.all([
    visitasQ,
    acoesQ(inicio.toISOString(), fim.toISOString()),
    semana === 0 ? acoesQ(null, new Date().toISOString()) : Promise.resolve({ data: [], error: null }),
    equipeAtiva(),
  ]);
  const semCrm = !!acoes.error;
  const nome = new Map(equipe.map((m) => [m.user_id, m.nome]));

  type Opp = { id: string; codigo: string; responsavel_user_id?: string | null; lead: { nome: string; telefone: string | null } | null; property: { codigo: string; titulo: string; municipality?: { nome: string; uf: string } | null } | null };
  const itens: Compromisso[] = [];
  for (const v of vis.data ?? []) {
    const o = v.opportunity as unknown as Opp;
    // a visita é de quem a conduz; sem condutor, do corretor do lead
    if (quem !== "todos" && (v.responsavel ?? o.responsavel_user_id) !== quem) continue;
    itens.push({
      quando: v.data_hora, tipo: "visita", titulo: `Visita · ${o.lead?.nome ?? "cliente"}`,
      detalhe: `${o.property?.codigo ?? ""} — ${o.property?.titulo ?? ""}${o.property?.municipality ? ` · ${o.property.municipality.nome}/${o.property.municipality.uf}` : ""}`,
      oppId: o.id, codigo: o.codigo, responsavel: v.responsavel ?? o.responsavel_user_id ?? null, status: v.status,
    });
  }
  for (const a of acoes.data ?? []) {
    const o = a as unknown as Opp & { proxima_acao: string; proxima_acao_em: string };
    itens.push({
      quando: o.proxima_acao_em, tipo: "acao", titulo: o.proxima_acao, detalhe: `${o.lead?.nome ?? "cliente"} · ${o.property?.titulo ?? ""}`,
      oppId: o.id, codigo: o.codigo, responsavel: o.responsavel_user_id ?? null,
    });
  }
  itens.sort((a, b) => a.quando.localeCompare(b.quando));
  const dias = Array.from({ length: 7 }, (_, i) => new Date(inicio.getTime() + i * 86_400_000 + 12 * 3_600_000));
  const porDia = new Map<string, Compromisso[]>();
  for (const it of itens) porDia.set(diaChave(it.quando), [...(porDia.get(diaChave(it.quando)) ?? []), it]);
  const hojeChave = diaChave(new Date());
  const atrasadas = (vencidas.data ?? []) as unknown as (Opp & { proxima_acao: string; proxima_acao_em: string })[];
  const link = (extra: Record<string, string | number>) => {
    const u = new URLSearchParams({ corretor: quem, semana: String(semana) });
    for (const [k, v] of Object.entries(extra)) u.set(k, String(v));
    return `/admin/agenda?${u}`;
  };
  const hora = (d: string) => new Date(d).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: FUSO });

  return (
    <div className="max-w-6xl space-y-6">
      <CabecalhoPagina eyebrow="Comercial" titulo="Agenda comercial"
        subtitulo="Visitas marcadas e próximas ações dos leads. A próxima ação se agenda dentro da oportunidade, no painel do CRM." />

      <div className="flex flex-wrap items-center gap-3">
        <Link href={link({ semana: semana - 1 })} className={aba(false)} aria-label="Semana anterior"><ChevronLeft className="size-4" /></Link>
        <Link href={link({ semana: 0 })} className={aba(semana === 0)}>Esta semana</Link>
        <Link href={link({ semana: semana + 1 })} className={aba(false)} aria-label="Próxima semana"><ChevronRight className="size-4" /></Link>
        <span className="text-sm text-texto-2">
          {inicio.toLocaleDateString("pt-BR", { day: "2-digit", month: "short", timeZone: FUSO })} a{" "}
          {new Date(fim.getTime() - 86_400_000).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric", timeZone: FUSO })}
        </span>
        <form action="/admin/agenda" className="ml-auto flex items-center gap-2">
          <input type="hidden" name="semana" value={semana} />
          <select name="corretor" defaultValue={quem} className={CAMPO_COMPACTO} aria-label="Corretor">
            <option value={user.id}>Minha agenda</option>
            <option value="todos">Toda a equipe</option>
            {equipe.filter((m) => m.user_id !== user.id).map((m) => <option key={m.user_id} value={m.user_id}>{m.nome}</option>)}
          </select>
          <button className="lp-btn lp-btn-verde !px-4 !py-2 text-sm">Ver</button>
        </form>
      </div>

      {semCrm && (
        <p className="rounded-xl border border-alerta/40 bg-alerta/10 px-4 py-3 text-sm text-alerta">
          As próximas ações aparecem aqui depois da migration 0147 (CRM comercial). Por enquanto, só as visitas.
        </p>
      )}

      {!!atrasadas.length && (
        <section className="cartao border-critico/40 p-5">
          <h2 className="mb-3 flex items-center gap-2 font-semibold text-critico"><CalendarClock className="size-5" /> Ações atrasadas ({atrasadas.length})</h2>
          <ul className="divide-y divide-linha">
            {atrasadas.slice(0, 30).map((o) => (
              <li key={o.id}>
                <Link href={`/admin/oportunidades/${o.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 text-sm hover:text-verde">
                  <span className="tabular-nums font-semibold text-critico">{new Date(o.proxima_acao_em).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: FUSO })}</span>
                  <span className="font-medium text-texto">{o.proxima_acao}</span>
                  <span className="text-texto-2">· {o.lead?.nome} · {o.codigo}</span>
                  {quem === "todos" && <span className="text-xs text-texto-2">· {o.responsavel_user_id ? nome.get(o.responsavel_user_id) ?? "equipe" : "sem corretor"}</span>}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-7">
        {dias.map((d) => {
          const k = diaChave(d);
          const lista = porDia.get(k) ?? [];
          return (
            <section key={k} className={"flex min-h-40 flex-col rounded-2xl border bg-superficie p-3 " + (k === hojeChave ? "border-verde" : "border-linha")}>
              <h2 className="mb-2 flex items-baseline justify-between text-sm">
                <span className="font-semibold capitalize text-texto">{d.toLocaleDateString("pt-BR", { weekday: "short", timeZone: FUSO })}</span>
                <span className="tabular-nums text-texto-2">{d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: FUSO })}</span>
              </h2>
              <div className="space-y-2">
                {lista.map((it, i) => (
                  <Link key={`${it.oppId}-${i}`} href={`/admin/oportunidades/${it.oppId}`}
                    className={"block rounded-xl border p-2.5 text-xs transition-colors hover:border-verde/60 " + (it.tipo === "visita" ? "border-verde/30 bg-verde/8" : "border-ouro/30 bg-ouro/8")}>
                    <p className="flex items-center gap-1.5 font-semibold text-texto">
                      {it.tipo === "visita" ? <MapPin className="size-3.5 shrink-0 text-verde" /> : <PhoneCall className="size-3.5 shrink-0 text-ouro" />}
                      <span className="tabular-nums">{hora(it.quando)}</span>
                    </p>
                    <p className="mt-1 line-clamp-2 font-medium text-texto">{it.titulo}</p>
                    <p className="mt-0.5 line-clamp-2 text-texto-2">{it.detalhe}</p>
                    {quem === "todos" && <p className="mt-1 text-texto-2">{it.responsavel ? nome.get(it.responsavel) ?? "equipe" : "sem corretor"}</p>}
                    {it.status && it.status !== "agendada" && <Etiqueta className="mt-1">{it.status}</Etiqueta>}
                  </Link>
                ))}
                {!lista.length && <p className="py-4 text-center text-xs text-texto-2">Livre</p>}
              </div>
            </section>
          );
        })}
      </div>
      <p className="flex flex-wrap gap-4 text-xs text-texto-2">
        <span className="inline-flex items-center gap-1.5"><MapPin className="size-3.5 text-verde" /> Visita</span>
        <span className="inline-flex items-center gap-1.5"><PhoneCall className="size-3.5 text-ouro" /> Próxima ação do lead</span>
        <span className="inline-flex items-center gap-1.5"><CalendarDays className="size-3.5" /> Marque visitas dentro da oportunidade</span>
      </p>
    </div>
  );
}
