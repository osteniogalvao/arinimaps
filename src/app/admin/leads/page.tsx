import Link from "next/link";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ETAPAS, ETAPA_LABEL } from "@/lib/funil";
import { exigirSetor } from "@/lib/setores-servidor";
import { ArrowRight, Building2, CalendarClock, Download, Filter, Mail, Phone, Plus, Tag, Upload, Users } from "lucide-react";
import { BotaoLink, CabecalhoPagina, Etiqueta, Vazio } from "@/components/ui/Pagina";
import { CAMPO_COMPACTO, CODIGO, LISTA, aba } from "@/components/admin/estilos";
import { equipeAtiva } from "@/components/admin/Painel";
import { ORIGEM_LABEL, TEMPERATURAS, TEMPERATURA_LABEL, TEMPERATURA_TOM, soDigitos, type Temperatura } from "@/lib/crm-comercial";

type Linha = {
  id: string; codigo: string; etapa: string; created_at: string; lead: unknown; property: unknown;
  responsavel_user_id?: string | null; prazo_atendimento?: string | null; primeiro_atendimento_em?: string | null;
  temperatura?: string | null; etiquetas?: string[] | null; proxima_acao?: string | null; proxima_acao_em?: string | null;
};

const UUID = /^[0-9a-f-]{36}$/i;

export default async function AdminLeads({ searchParams }: PageProps<"/admin/leads">) {
  const user = await exigirSetor("comercial");
  const sp = await searchParams;
  const um = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const visao = um("meus") === "1" ? "meus" : um("vencidos") === "1" ? "vencidos" : um("followup") === "1" ? "followup" : "todos";
  const busca = um("q").trim().slice(0, 80);
  const etapa = ETAPA_LABEL[um("etapa")] ? um("etapa") : "";
  const corretor = UUID.test(um("corretor")) ? um("corretor") : um("corretor") === "sem" ? "sem" : "";
  const temperatura = TEMPERATURAS.includes(um("temperatura") as Temperatura) ? um("temperatura") : "";
  const etiqueta = um("etiqueta").trim().toLowerCase().slice(0, 30);
  const admin = supabaseAdmin();
  const CAMPOS = `
      id, codigo, etapa, created_at,
      lead:leads!inner(nome, telefone, email, mensagem, origem),
      property:properties(codigo, titulo)`;
  const agoraIso = new Date().toISOString();

  // com a 0147: temperatura, etiquetas e próxima ação; com a 0065: quem atende; sem elas, a lista de antes
  const monta = (campos: string, completo: boolean) => {
    let q = admin.from("oportunidades_oficiais").select(campos).order("created_at", { ascending: false }).limit(200);
    if (etapa) q = q.eq("etapa", etapa);
    if (busca) {
      const d = soDigitos(busca);
      const termo = busca.replace(/[%,()*]/g, " ");
      q = /^(OP|AIB)-?\d+/i.test(busca)
        ? q.ilike("codigo", `%${termo}%`)
        : d.length >= 6
          // telefone gravado com máscara: casa os últimos 8 dígitos com qualquer coisa entre eles
          ? q.ilike("lead.telefone", `%${d.slice(-8).split("").join("%")}%`)
          : q.or(`nome.ilike.%${termo}%,email.ilike.%${termo}%`, { referencedTable: "lead" });
    }
    if (!completo) return q;
    if (visao === "meus") q = q.eq("responsavel_user_id", user.id).not("etapa", "in", "(fechado,pos_venda,perdido)");
    if (visao === "vencidos") q = q.is("primeiro_atendimento_em", null).eq("etapa", "novo_lead").lt("prazo_atendimento", agoraIso);
    if (visao === "followup") q = q.lte("proxima_acao_em", agoraIso).not("etapa", "in", "(fechado,pos_venda,perdido)");
    if (corretor === "sem") q = q.is("responsavel_user_id", null);
    else if (corretor) q = q.eq("responsavel_user_id", corretor);
    if (temperatura) q = q.eq("temperatura", temperatura);
    if (etiqueta) q = q.contains("etiquetas", [etiqueta]);
    return q;
  };
  const [r, equipe] = await Promise.all([
    monta(`${CAMPOS}, responsavel_user_id, prazo_atendimento, primeiro_atendimento_em, temperatura, etiquetas, proxima_acao, proxima_acao_em`, true),
    equipeAtiva(),
  ]);
  const semCrm = !!r.error;
  const opps = (r.error ? (await monta(CAMPOS, false)).data : r.data) as unknown as Linha[] | null;
  const nome = new Map(equipe.map((m) => [m.user_id, m.nome]));
  const agora = Date.now();
  const filtrosAtivos = !!(busca || etapa || corretor || temperatura || etiqueta);
  const exportar = new URLSearchParams(Object.entries({ etapa, corretor: UUID.test(corretor) ? corretor : "", temperatura }).filter(([, v]) => v));
  const qs = (extra: Record<string, string>) => {
    const u = new URLSearchParams(Object.entries({ q: busca, etapa, corretor, temperatura, etiqueta }).filter(([, v]) => v));
    for (const [k, v] of Object.entries(extra)) u.set(k, v);
    const s = u.toString();
    return s ? `?${s}` : "";
  };

  return (
    <div className="space-y-6">
      <CabecalhoPagina eyebrow="Comercial" titulo="Leads e oportunidades"
        subtitulo={<>Todo interesse vira uma oportunidade com ID único. Abra a oportunidade para registrar contatos, agendar a próxima
          ação, marcar visita, enviar propostas e fechar a venda.</>}
        acoes={<div className="flex flex-wrap gap-2">
          <BotaoLink href="/admin/leads/novo" seta={false}><Plus /> Novo lead</BotaoLink>
          <BotaoLink href="/admin/funil" variante="contorno" seta={false}><Filter /> Funil</BotaoLink>
        </div>} />

      <div className="flex flex-wrap items-center gap-2">
        <Link href={`/admin/leads${qs({})}`} className={aba(visao === "todos")}>Todos</Link>
        <Link href={`/admin/leads${qs({ meus: "1" })}`} className={aba(visao === "meus")}>Meus leads</Link>
        <Link href={`/admin/leads${qs({ followup: "1" })}`} className={aba(visao === "followup")}><CalendarClock className="size-4" /> Ações para hoje</Link>
        <Link href={`/admin/leads${qs({ vencidos: "1" })}`} className={aba(visao === "vencidos")}>Sem contato no prazo</Link>
        <span className="ml-auto flex flex-wrap gap-3 text-sm">
          <Link href="/admin/leads/importar" className="inline-flex items-center gap-1.5 font-semibold text-verde hover:underline"><Upload className="size-4" /> Importar</Link>
          <a href={`/api/admin/crm-comercial/exportar${exportar.size ? `?${exportar}` : ""}`} className="inline-flex items-center gap-1.5 font-semibold text-verde hover:underline">
            <Download className="size-4" /> Exportar planilha
          </a>
        </span>
      </div>

      <form className="cartao flex flex-wrap items-end gap-3 p-4" action="/admin/leads">
        {visao !== "todos" && <input type="hidden" name={visao === "followup" ? "followup" : visao} value="1" />}
        <label className="flex min-w-56 flex-1 flex-col gap-1 text-xs font-semibold text-texto-2">Buscar
          <input name="q" defaultValue={busca} placeholder="Nome, e-mail, telefone ou OP-000123" className={CAMPO_COMPACTO} />
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold text-texto-2">Etapa
          <select name="etapa" defaultValue={etapa} className={CAMPO_COMPACTO}>
            <option value="">Todas</option>
            {[...ETAPAS, "perdido"].map((e) => <option key={e} value={e}>{ETAPA_LABEL[e]}</option>)}
          </select>
        </label>
        {!semCrm && <>
          <label className="flex flex-col gap-1 text-xs font-semibold text-texto-2">Corretor
            <select name="corretor" defaultValue={corretor} className={CAMPO_COMPACTO}>
              <option value="">Todos</option>
              <option value="sem">Sem corretor</option>
              {equipe.map((m) => <option key={m.user_id} value={m.user_id}>{m.nome}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-texto-2">Temperatura
            <select name="temperatura" defaultValue={temperatura} className={CAMPO_COMPACTO}>
              <option value="">Todas</option>
              {TEMPERATURAS.map((t) => <option key={t} value={t}>{TEMPERATURA_LABEL[t]}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-texto-2">Etiqueta
            <input name="etiqueta" defaultValue={etiqueta} placeholder="ex.: investidor" className={CAMPO_COMPACTO + " w-36"} />
          </label>
        </>}
        <button className="lp-btn lp-btn-verde !px-4 !py-2 text-sm">Filtrar</button>
        {filtrosAtivos && <Link href="/admin/leads" className="text-sm font-semibold text-texto-2 hover:text-texto">Limpar</Link>}
      </form>

      {semCrm && (
        <p className="rounded-xl border border-alerta/40 bg-alerta/10 px-4 py-3 text-sm text-alerta">
          Filtros por corretor, temperatura, etiqueta e próxima ação aparecem depois da migration 0147 (CRM comercial).
        </p>
      )}

      {!opps?.length ? (
        <Vazio icone={Users} titulo={filtrosAtivos || visao !== "todos" ? "Nada com esses filtros" : "Nenhum lead ainda"}
          texto={filtrosAtivos || visao !== "todos" ? "Mude os filtros ou cadastre um lead." : "Quando alguém clicar em “Tenho interesse”, aparece aqui na hora. Ligação e balcão entram por “Novo lead”."} />
      ) : (
        <div className={LISTA}>
          {opps.map((o) => {
            const lead = o.lead as unknown as { nome: string; telefone: string | null; email: string | null; mensagem: string | null; origem: string } | null;
            const prop = o.property as unknown as { codigo: string; titulo: string } | null;
            const atrasada = o.proxima_acao_em && +new Date(o.proxima_acao_em) < agora;
            return (
              <div key={o.id} className="flex flex-wrap items-start gap-x-5 gap-y-3 px-5 py-4 transition-colors hover:bg-superficie-2/70">
                <div className="flex-1 min-w-60">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="lp-display text-lg text-texto">{lead?.nome ?? "—"}</span>
                    <span className={CODIGO}>{o.codigo}</span>
                    {o.temperatura && <Etiqueta tom={TEMPERATURA_TOM[o.temperatura as Temperatura]}>{TEMPERATURA_LABEL[o.temperatura as Temperatura]}</Etiqueta>}
                    {lead?.origem && <span className="text-xs text-texto-2">· {ORIGEM_LABEL[lead.origem] ?? lead.origem}</span>}
                  </p>
                  <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-texto-2">
                    {lead?.telefone && <span className="inline-flex items-center gap-1.5"><Phone className="size-3.5" />{lead.telefone}</span>}
                    {lead?.email && <span className="inline-flex items-center gap-1.5"><Mail className="size-3.5" />{lead.email}</span>}
                  </p>
                  {lead?.mensagem && <p className="mt-2 line-clamp-2 text-[0.95rem] leading-relaxed text-texto-2">“{lead.mensagem}”</p>}
                  <p className="mt-2 inline-flex items-center gap-1.5 text-sm text-texto-2">
                    <Building2 className="size-3.5 shrink-0" />
                    <span className="font-mono text-xs">{prop?.codigo}</span> — {prop?.titulo}
                  </p>
                  {!!o.etiquetas?.length && (
                    <p className="mt-2 flex flex-wrap gap-1.5">
                      {o.etiquetas.map((t) => (
                        <Link key={t} href={`/admin/leads?etiqueta=${encodeURIComponent(t)}`}
                          className="inline-flex items-center gap-1 rounded-full bg-superficie-2 px-2 py-0.5 text-xs text-texto-2 hover:text-texto">
                          <Tag className="size-3" />{t}
                        </Link>
                      ))}
                    </p>
                  )}
                  {o.proxima_acao && (
                    <p className={"mt-2 inline-flex items-center gap-1.5 text-sm " + (atrasada ? "font-semibold text-critico" : "text-texto")}>
                      <CalendarClock className="size-3.5" />{o.proxima_acao}
                      {o.proxima_acao_em && <span className="tabular-nums"> · {new Date(o.proxima_acao_em).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}</span>}
                    </p>
                  )}
                </div>
                <div className="flex flex-col items-start gap-2 sm:items-end">
                  <Etiqueta tom="ouro">{ETAPA_LABEL[o.etapa] ?? o.etapa}</Etiqueta>
                  {o.responsavel_user_id !== undefined && (
                    <p className="text-xs text-texto-2">
                      {o.responsavel_user_id ? `com ${o.responsavel_user_id === user.id ? "você" : nome.get(o.responsavel_user_id) ?? "equipe"}` : "sem corretor"}
                      {!o.primeiro_atendimento_em && o.prazo_atendimento && (
                        <span className={new Date(o.prazo_atendimento).getTime() < agora ? " font-semibold text-critico" : " text-ouro"}>
                          {" "}· contato até {new Date(o.prazo_atendimento).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                        </span>
                      )}
                    </p>
                  )}
                  <p className="text-xs text-texto-2 tabular-nums">
                    {new Date(o.created_at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}
                  </p>
                  <Link href={`/admin/oportunidades/${o.id}`}
                    className="inline-flex items-center gap-1.5 text-sm font-semibold text-verde hover:underline underline-offset-4">
                    Abrir oportunidade <ArrowRight className="size-4" />
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {opps?.length === 200 && <p className="text-sm text-texto-2">Mostrando as 200 mais recentes. Use os filtros ou exporte a planilha para ver todas.</p>}
    </div>
  );
}
