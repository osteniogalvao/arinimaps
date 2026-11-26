import Link from "next/link";
import { exigirEquipe } from "@/lib/setores-servidor";
import { periodoAgenda, type CompromissoSetor } from "@/lib/agenda-setores";
import { lerAgendaSetores } from "@/lib/agenda-setores-servidor";
import { setorPorId } from "@/lib/setores";
import { CabecalhoPagina, Etiqueta } from "@/components/ui/Pagina";
import { CAMPO_COMPACTO } from "@/components/admin/estilos";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { somenteLeituraEquipe } from "@/lib/seguranca/equipe";
import FormReuniao, { type Reuniao } from "@/components/admin/FormReuniao";

const TZ = "America/Sao_Paulo";
const UUID = /^[0-9a-f-]{36}$/i;
const COR_TIPO: Record<string, string> = {
  Reunião: "border-l-ouro", Visita: "border-l-verde", "Próximo contato": "border-l-sky-500", Tarefa: "border-l-texto-2",
  "Prazo do CRM": "border-l-critico", Despesa: "border-l-alerta", Aluguel: "border-l-alerta",
};

/** "Hoje", "Amanhã" ou "qui., 27/11". */
function rotuloDia(dia: string, hoje: string) {
  if (dia === hoje) return "Hoje";
  if (dia === new Date(Date.parse(hoje) + 86_400_000).toISOString().slice(0, 10)) return "Amanhã";
  const d = new Date(dia + "T12:00:00-03:00");
  return d.toLocaleDateString("pt-BR", { timeZone: TZ, weekday: "short", day: "2-digit", month: "2-digit" });
}

/**
 * Agenda compartilhada da equipe: reuniões e prazos dos setores, por dia.
 *
 * Acesso controlado: cada pessoa vê só os setores em que atua (a Diretoria
 * vê todos); o filtro da URL nunca amplia isso. Dentro dos setores dela, dá
 * para ver a agenda de qualquer colega (áudio do Carlos, 24/11/2026: "com
 * acesso controlado à agenda de todo mundo").
 */
export default async function AgendaSetores({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await exigirEquipe(), sp = await searchParams;
  const hoje = new Date().toLocaleDateString("en-CA", { timeZone: TZ });
  // vistas como na agenda da Arini Negócios: mês e semana em grade, lista por dia
  const vista: "lista" | "semana" | "mes" = sp.vista === "mes" ? "mes" : sp.vista === "semana" ? "semana" : "lista";
  const base = typeof sp.data === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sp.data) && Number.isFinite(Date.parse(sp.data)) ? sp.data : hoje;
  const meio = (d: string) => new Date(d + "T12:00:00-03:00");
  const somar = (d: string, n: number) => new Date(meio(d).getTime() + n * 86_400_000).toLocaleDateString("en-CA", { timeZone: TZ });
  const inicioGrade = vista === "mes" ? somar(base.slice(0, 8) + "01", -meio(base.slice(0, 8) + "01").getUTCDay())
    : vista === "semana" ? somar(base, -meio(base).getUTCDay()) : null;
  const diasGrade = vista === "mes" ? 42 : 7;
  const { de, ate } = inicioGrade ? { de: inicioGrade, ate: somar(inicioGrade, diasGrade - 1) } : periodoAgenda(sp.de, sp.ate, hoje);
  const setores = typeof sp.setor === "string" && user.setores.includes(sp.setor as typeof user.setores[number]) ? [sp.setor] : user.setores;
  const pessoa = typeof sp.pessoa === "string" && (UUID.test(sp.pessoa) || sp.pessoa === "eu") ? (sp.pessoa === "eu" ? user.id : sp.pessoa) : "";
  const { itens: todos, falhas, limitado } = await lerAgendaSetores(setores, de, ate);
  const leitura = somenteLeituraEquipe(user);
  const editar = typeof sp.reuniao === "string" && UUID.test(sp.reuniao) ? sp.reuniao : null;
  const [r, equipe] = await Promise.all([
    editar ? (await supabaseServer()).from("agenda_reunioes").select("*").eq("id", editar).maybeSingle() : Promise.resolve({ data: null, error: null }),
    supabaseAdmin().from("profiles").select("user_id,nome,setores,role,equipe_acesso").eq("ativo", true)
      .in("role", ["admin_central", "analista_arini"]).or(`role.eq.admin_central,setores.ov.{${user.setores.join(",")}}`).order("nome").limit(500),
  ]);
  const membros = (equipe.data ?? []) as { user_id: string; nome: string; setores: string[]; role: string; equipe_acesso: string | null }[];
  const nome = new Map(membros.map((m) => [m.user_id, m.nome || "—"]));
  const itens = pessoa ? todos.filter((i) => i.responsavel === pessoa) : todos;

  // agrupa por dia, na ordem da lista
  const dias: { dia: string; itens: CompromissoSetor[] }[] = [];
  for (const i of itens) {
    const dia = i.data.slice(0, 10);
    const ultimo = dias[dias.length - 1];
    if (ultimo?.dia === dia) ultimo.itens.push(i); else dias.push({ dia, itens: [i] });
  }
  const navegar = (data: string) => new URLSearchParams({ vista, data, ...(setores.length === 1 ? { setor: setores[0] } : {}), ...(typeof sp.pessoa === "string" ? { pessoa: sp.pessoa } : {}) }).toString();
  const mesAnterior = (() => { const d = meio(base.slice(0, 8) + "01"); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 10); })();
  const mesSeguinte = (() => { const d = meio(base.slice(0, 8) + "01"); d.setUTCMonth(d.getUTCMonth() + 1); return d.toISOString().slice(0, 10); })();
  const atrasados = itens.filter((i) => i.data.slice(0, 10) < hoje).length;

  return <div className="max-w-5xl space-y-6">
    <CabecalhoPagina eyebrow="Central" titulo="Agenda compartilhada"
      subtitulo="Reuniões e prazos dos seus setores, dia a dia. Você vê a agenda dos colegas dos setores em que atua." />
    {sp.aviso === "salvo" && <p role="status" className="text-verde">Reunião salva e responsável avisado.</p>}
    {sp.aviso === "invalido" && <p role="alert" className="text-critico">Não foi possível salvar. Confira as datas, o responsável ativo e a tarefa do mesmo setor.</p>}
    {sp.aviso === "conflito" && <p role="alert" className="text-critico">Outra pessoa alterou a reunião. Abra a versão atual antes de salvar.</p>}
    {editar && !r.data && <p role="alert">Reunião indisponível ou fora do seu setor.</p>}
    {!leitura && !equipe.error && <FormReuniao setores={user.setores} pessoas={membros.filter((m) => m.equipe_acesso !== "leitura")}
      reuniao={r.data as Reuniao | undefined} abrir={sp.agendar === "1"} setorInicial={setores.length === 1 ? setores[0] : undefined} />}
    {equipe.error && <p role="alert">Equipe indisponível para agendamento. Tente novamente.</p>}

    <form className="cartao flex flex-wrap items-end gap-3 p-4">
      <label className="grid gap-1 text-sm">Setor<select name="setor" defaultValue={setores.length === 1 ? setores[0] : ""} className={CAMPO_COMPACTO}>
        <option value="">Todos os meus setores</option>{user.setores.map(s => <option key={s} value={s}>{setorPorId(s)?.nome ?? s}</option>)}
      </select></label>
      <label className="grid gap-1 text-sm">Agenda de<select name="pessoa" defaultValue={pessoa === user.id ? "eu" : pessoa} className={CAMPO_COMPACTO}>
        <option value="">Toda a equipe</option><option value="eu">Só a minha</option>
        {membros.filter((m) => m.user_id !== user.id).map((m) => <option key={m.user_id} value={m.user_id}>{m.nome || "—"}</option>)}
      </select></label>
      <input type="hidden" name="vista" value={vista} />{inicioGrade && <input type="hidden" name="data" value={base} />}
      {!inicioGrade && <><label className="grid gap-1 text-sm">De<input type="date" name="de" defaultValue={de} className={CAMPO_COMPACTO} /></label>
      <label className="grid gap-1 text-sm">Até<input type="date" name="ate" defaultValue={ate} className={CAMPO_COMPACTO} /></label></>}
      <button className="btn-verde px-4 py-2">Ver agenda</button>
    </form>

    {user.setores.includes("comercial") && <Link className="text-sm underline" href="/admin/agenda">Abrir agenda comercial de visitas e próximos contatos</Link>}
    {!!falhas.length && <p role="alert" className="text-alerta">Não foi possível consultar: {falhas.join(", ")}. Os demais compromissos estão abaixo.</p>}
    {limitado && <p role="status">Há mais de 500 compromissos em uma das fontes. Reduza o período para consultar todos.</p>}
    <div className="flex flex-wrap items-center gap-2 text-sm text-texto-2">
      <span>{itens.length} compromisso(s) no período.</span>
      {atrasados > 0 && <Etiqueta tom="critico">{atrasados} vencido(s)</Etiqueta>}
      <span>As alterações são feitas na ficha de origem.</span>
    </div>

    <nav className="flex flex-wrap items-center gap-2 text-sm" aria-label="Vista da agenda">
      {(["lista", "semana", "mes"] as const).map((v) => <Link key={v} href={`/admin/agenda-setores?${new URLSearchParams({ vista: v, data: base, ...(setores.length === 1 ? { setor: setores[0] } : {}), ...(typeof sp.pessoa === "string" ? { pessoa: sp.pessoa } : {}) })}`}
        className={`rounded-full border px-3 py-1.5 ${vista === v ? "border-verde bg-verde/10 font-semibold" : "border-linha hover:border-verde"}`}>{v === "mes" ? "Mês" : v === "semana" ? "Semana" : "Lista"}</Link>)}
      {inicioGrade && <>
        <Link className="rounded-full border border-linha px-3 py-1.5" aria-label="Anterior" href={`/admin/agenda-setores?${navegar(vista === "mes" ? mesAnterior : somar(base, -7))}`}>←</Link>
        <Link className="rounded-full border border-linha px-3 py-1.5" href={`/admin/agenda-setores?${navegar(hoje)}`}>Hoje</Link>
        <Link className="rounded-full border border-linha px-3 py-1.5" aria-label="Próximo" href={`/admin/agenda-setores?${navegar(vista === "mes" ? mesSeguinte : somar(base, 7))}`}>→</Link>
        <span className="ml-1 font-semibold capitalize">{vista === "mes" ? new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" }).format(meio(base.slice(0, 8) + "01")) : `${de.split("-").reverse().join("/")} a ${ate.split("-").reverse().join("/")}`}</span>
      </>}
    </nav>

    {inicioGrade && <div className="overflow-x-auto"><div className={`grid ${vista === "mes" ? "min-w-[760px]" : "min-w-[880px]"} grid-cols-7 gap-px overflow-hidden rounded-xl border border-linha bg-linha`}>
      {["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"].map((d) => <div key={d} className="bg-superficie-2 px-2 py-1 text-xs font-semibold text-texto-2">{d}</div>)}
      {Array.from({ length: diasGrade }, (_, i) => somar(de, i)).map((d) => {
        const doDia = itens.filter((i) => i.data.slice(0, 10) === d);
        const limite = vista === "mes" ? 4 : 50;
        return <div key={d} className={`${vista === "mes" ? "min-h-28" : "min-h-64"} bg-superficie p-1 ${vista === "mes" && d.slice(0, 7) !== base.slice(0, 7) ? "opacity-50" : ""}`}>
          <p className={`mb-1 inline-block rounded px-1 text-xs ${d === hoje ? "bg-verde font-bold text-white" : d < hoje ? "text-texto-2" : ""}`}>{Number(d.slice(8))}</p>
          <div className="space-y-1">{doDia.slice(0, limite).map((i) => <Link key={`${i.tipo}:${i.id}`} href={i.href} title={`${i.tipo} · ${setorPorId(i.setor)?.nome ?? i.setor}${i.responsavel ? " · " + (nome.get(i.responsavel) ?? "") : ""}`}
            className={`block truncate rounded border-l-4 ${COR_TIPO[i.tipo] ?? "border-l-linha-forte"} bg-superficie-2 px-1.5 py-0.5 text-xs hover:underline`}>
            {i.hora && <span className="tabular-nums">{i.hora} </span>}{i.titulo}</Link>)}
            {doDia.length > limite && <Link className="text-xs underline" href={`/admin/agenda-setores?${new URLSearchParams({ de: d, ate: d })}`}>+{doDia.length - limite}</Link>}</div>
        </div>;
      })}
    </div></div>}

    {!inicioGrade && <>
    {!dias.length && <p className="rounded-xl border border-dashed border-linha px-4 py-10 text-center text-texto-2">Nenhum compromisso encontrado para este período{pessoa ? ", pessoa" : ""} e setor.</p>}
    <div className="space-y-5">
      {dias.map(({ dia, itens: doDia }) => (
        <section key={dia} aria-label={rotuloDia(dia, hoje)}>
          <h2 className={`mb-2 text-[11px] font-bold uppercase tracking-[0.22em] ${dia < hoje ? "text-critico" : dia === hoje ? "text-ouro" : "text-texto-2"}`}>
            {rotuloDia(dia, hoje)}{dia < hoje && " · vencido"}
          </h2>
          <ul className="divide-y divide-linha overflow-hidden rounded-xl border border-linha bg-superficie">
            {doDia.map(i => <li key={`${i.tipo}:${i.id}`}><Link href={i.href} className="flex flex-wrap items-center gap-3 px-4 py-3 hover:bg-superficie-2">
              <span className="w-12 shrink-0 text-sm tabular-nums text-texto-2">{i.hora ?? "—"}</span>
              <span className="min-w-0 flex-1 font-medium">{i.titulo}</span>
              <span className="text-sm text-texto-2">{[i.tipo, setorPorId(i.setor)?.nome ?? i.setor, i.responsavel ? nome.get(i.responsavel) : null].filter(Boolean).join(" · ")}</span>
            </Link></li>)}
          </ul>
        </section>
      ))}
    </div>
    </>}
  </div>;
}
