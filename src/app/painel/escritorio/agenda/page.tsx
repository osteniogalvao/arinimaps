import Link from "next/link";
import {
  STATUS_COMPROMISSO, TIPOS_COMPROMISSO, UUID_ESC, dataHoraSP, diaSP, horaSP, paraCampoDataHora,
} from "@/lib/crm-escritorio";
import {
  Avisos, BOTAO, BOTAO_VERDE, BotaoExcluir, CAMPO_P, CabecalhoEscritorio, CampoResponsavel, SemEscritorio, abrirEscritorio, umParam,
  type Parametros,
} from "../comum";
import { salvarCompromisso, statusCompromisso } from "../acoes";

type Compromisso = {
  id: string; tipo: keyof typeof TIPOS_COMPROMISSO; titulo: string; inicio: string; fim: string | null; dia_inteiro: boolean;
  local: string | null; pessoa_id: string | null; imovel_id: string | null; negocio_id: string | null;
  status: keyof typeof STATUS_COMPROMISSO; observacoes: string | null; responsavel: string | null;
  pessoa: { nome: string; telefone: string | null } | null; imovel: { codigo: string } | null;
};
type Vista = "mes" | "semana" | "lista";
const DIA = 86_400_000;
const SEMANA = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const meio = (dia: string) => new Date(dia + "T12:00:00-03:00");
const somar = (dia: string, n: number) => diaSP(new Date(meio(dia).getTime() + n * DIA));
const COR: Record<string, string> = {
  visita: "border-l-verde", reuniao: "border-l-ouro", ligacao: "border-l-sky-500", tarefa: "border-l-texto-2", prazo: "border-l-critico", outro: "border-l-linha-forte",
};

/**
 * Agenda do escritório: mês, semana e lista, como a agenda do CRM da Arini
 * Negócios. Com equipe, cada pessoa vê a agenda de todos e filtra por
 * responsável (agenda compartilhada).
 */
export default async function AgendaEscritorio({ searchParams }: { searchParams: Promise<Parametros> }) {
  const s = await abrirEscritorio();
  if (s.status !== 200) return <SemEscritorio status={s.status} />;
  const sp = await searchParams;
  const vista: Vista = (["mes", "semana", "lista"] as const).find((v) => v === sp.vista) ?? "mes";
  const hoje = diaSP(new Date());
  const base = /^\d{4}-\d{2}-\d{2}$/.test(umParam(sp, "data")) ? umParam(sp, "data") : hoje;
  const quem = UUID_ESC.test(umParam(sp, "quem")) ? umParam(sp, "quem") : "";
  const editar = UUID_ESC.test(umParam(sp, "editar")) ? umParam(sp, "editar") : null;

  // período da vista (grade do mês começa no domingo)
  let de: string, dias: number;
  if (vista === "mes") {
    const primeiro = base.slice(0, 8) + "01";
    de = somar(primeiro, -meio(primeiro).getUTCDay()); dias = 42;
  } else if (vista === "semana") {
    de = somar(base, -meio(base).getUTCDay()); dias = 7;
  } else { de = base; dias = 30; }
  const ate = somar(de, dias);
  const params = (extra: Record<string, string>) => new URLSearchParams({ vista, data: base, ...(quem ? { quem } : {}), ...extra }).toString();
  const volta = "/painel/escritorio/agenda?" + params({});
  const passo = vista === "mes" ? null : vista === "semana" ? 7 : 30;
  const anterior = passo ? somar(base, -passo) : (() => { const d = meio(base.slice(0, 8) + "01"); d.setUTCMonth(d.getUTCMonth() - 1); return diaSP(d); })();
  const proximo = passo ? somar(base, passo) : (() => { const d = meio(base.slice(0, 8) + "01"); d.setUTCMonth(d.getUTCMonth() + 1); return diaSP(d); })();

  let q = s.banco.from("crm_esc_agenda")
    .select("id,tipo,titulo,inicio,fim,dia_inteiro,local,pessoa_id,imovel_id,negocio_id,status,observacoes,responsavel,pessoa:crm_esc_pessoas(nome,telefone),imovel:crm_esc_imoveis(codigo)")
    .gte("inicio", meio(de).toISOString().slice(0, 10) + "T03:00:00Z").lt("inicio", meio(ate).toISOString().slice(0, 10) + "T03:00:00Z")
    .order("inicio").limit(1000);
  if (quem) q = q.eq("responsavel", quem);
  const [agenda, pessoas, imoveis, negocios, edicao] = await Promise.all([
    q,
    s.banco.from("crm_esc_pessoas").select("id,nome").order("nome").limit(1000),
    s.banco.from("crm_esc_imoveis").select("id,codigo,titulo,endereco,cidade").neq("status", "inativo").order("codigo").limit(1000),
    s.banco.from("crm_esc_negocios").select("id,titulo,pessoa_id,imovel_id").not("etapa", "in", "(fechado,perdido)").order("atualizado_em", { ascending: false }).limit(500),
    editar ? s.banco.from("crm_esc_agenda").select("*").eq("id", editar).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const itens = (agenda.data ?? []) as unknown as Compromisso[];
  const nome = new Map(s.membros.map((m) => [m.user_id, m.nome]));
  const emEdicao = (edicao.data ?? undefined) as Compromisso | undefined;

  // pré-preenchimento ao agendar a partir do funil, do imóvel ou do cadastro
  const negocioPre = (negocios.data ?? []).find((n) => n.id === umParam(sp, "negocio"));
  const imovelPre = umParam(sp, "imovel") || negocioPre?.imovel_id || "";
  const pessoaPre = umParam(sp, "pessoa") || negocioPre?.pessoa_id || "";
  const imovelDados = (imoveis.data ?? []).find((i) => i.id === imovelPre);
  const abrirForm = !!emEdicao || sp.novo === "1";

  const porDia = new Map<string, Compromisso[]>();
  for (const c of itens) { const d = diaSP(c.inicio); porDia.set(d, [...(porDia.get(d) ?? []), c]); }
  const grade = Array.from({ length: dias }, (_, i) => somar(de, i));
  const titulo = vista === "mes"
    ? new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" }).format(meio(base.slice(0, 8) + "01"))
    : `${grade[0].split("-").reverse().join("/")} a ${grade[grade.length - 1].split("-").reverse().join("/")}`;
  const atrasados = itens.filter((c) => c.status === "agendado" && c.inicio < new Date().toISOString()).length;

  const item = (c: Compromisso, curto = false) => (
    <Link key={c.id} href={`/painel/escritorio/agenda?${params({ editar: c.id })}`}
      className={`block rounded-md border border-linha border-l-4 ${COR[c.tipo]} bg-superficie px-2 py-1 text-xs hover:underline ${c.status !== "agendado" ? "opacity-60 line-through" : ""}`}>
      {!c.dia_inteiro && <span className="tabular-nums">{horaSP(c.inicio)} </span>}{c.titulo}
      {!curto && s.espaco.equipe && c.responsavel && <span className="block text-texto-2">{nome.get(c.responsavel)}</span>}
    </Link>);

  return <section>
    <CabecalhoEscritorio espaco={s.espaco} ativa="agenda" titulo="Agenda"
      subtitulo={s.espaco.equipe ? "Agenda compartilhada da equipe. Filtre por responsável para ver a de cada um." : "Visitas, reuniões, ligações e prazos."} />
    <Avisos sp={sp} />

    <details className="cartao mb-6 p-4" open={abrirForm}>
      <summary className="cursor-pointer font-semibold">{emEdicao ? `Editar: ${emEdicao.titulo}` : "Novo compromisso"}</summary>
      <form action={salvarCompromisso} className="mt-4 grid gap-3 md:grid-cols-4" key={emEdicao?.id ?? "novo"}>
        <input type="hidden" name="_volta" value={volta} />
        {emEdicao && <input type="hidden" name="id" value={emEdicao.id} />}
        <label className="grid gap-1 text-sm">Tipo<select name="tipo" defaultValue={emEdicao?.tipo ?? "visita"} className={CAMPO_P}>
          {Object.entries(TIPOS_COMPROMISSO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label className="grid gap-1 text-sm md:col-span-3">Título<input name="titulo" required className={CAMPO_P}
          defaultValue={emEdicao?.titulo ?? (negocioPre ? `Visita: ${negocioPre.titulo}` : imovelDados ? `Visita ${imovelDados.codigo}` : "")} /></label>
        <label className="grid gap-1 text-sm">Início<input type="datetime-local" name="inicio" required className={CAMPO_P}
          defaultValue={paraCampoDataHora(emEdicao?.inicio) || `${base}T09:00`} /></label>
        <label className="grid gap-1 text-sm">Fim<input type="datetime-local" name="fim" className={CAMPO_P} defaultValue={paraCampoDataHora(emEdicao?.fim)} /></label>
        <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" name="dia_inteiro" defaultChecked={emEdicao?.dia_inteiro} /> Dia inteiro</label>
        <label className="grid gap-1 text-sm">Status<select name="status" defaultValue={emEdicao?.status ?? "agendado"} className={CAMPO_P}>
          {Object.entries(STATUS_COMPROMISSO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label className="grid gap-1 text-sm md:col-span-2">Local<input name="local" className={CAMPO_P}
          defaultValue={emEdicao?.local ?? ([imovelDados?.endereco, imovelDados?.cidade].filter(Boolean).join(", ") || "")} /></label>
        <label className="grid gap-1 text-sm">Cliente<select name="pessoa_id" defaultValue={emEdicao?.pessoa_id ?? pessoaPre} className={CAMPO_P}>
          <option value="">—</option>{(pessoas.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}</select></label>
        <label className="grid gap-1 text-sm">Imóvel<select name="imovel_id" defaultValue={emEdicao?.imovel_id ?? imovelPre} className={CAMPO_P}>
          <option value="">—</option>{(imoveis.data ?? []).map((i) => <option key={i.id} value={i.id}>{i.codigo} · {i.titulo}</option>)}</select></label>
        <label className="grid gap-1 text-sm">Negócio<select name="negocio_id" defaultValue={emEdicao?.negocio_id ?? negocioPre?.id ?? ""} className={CAMPO_P}>
          <option value="">—</option>{(negocios.data ?? []).map((n) => <option key={n.id} value={n.id}>{n.titulo}</option>)}</select></label>
        <CampoResponsavel membros={s.membros} valor={emEdicao?.responsavel} equipe={s.espaco.equipe} />
        <label className="grid gap-1 text-sm md:col-span-4">Observações<textarea name="observacoes" rows={2} defaultValue={emEdicao?.observacoes ?? ""} className={CAMPO_P} /></label>
        <div className="flex flex-wrap gap-3 md:col-span-4">
          <button className={BOTAO_VERDE}>{emEdicao ? "Salvar alterações" : "Agendar"}</button>
          {abrirForm && <Link className={BOTAO} href={volta}>Cancelar</Link>}
        </div>
      </form>
      {emEdicao && <div className="mt-3"><BotaoExcluir tipo="compromisso" id={emEdicao.id} volta={volta} /></div>}
    </details>

    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Link className={BOTAO} href={`/painel/escritorio/agenda?${params({ data: anterior })}`} aria-label="Período anterior">←</Link>
        <Link className={BOTAO} href={`/painel/escritorio/agenda?${params({ data: hoje })}`}>Hoje</Link>
        <Link className={BOTAO} href={`/painel/escritorio/agenda?${params({ data: proximo })}`} aria-label="Próximo período">→</Link>
        <h2 className="ml-2 text-lg font-semibold capitalize">{titulo}</h2>
        {atrasados > 0 && <span className="text-sm text-critico">{atrasados} vencido(s) sem baixa</span>}
      </div>
      <div className="flex flex-wrap items-end gap-2">
        {(["mes", "semana", "lista"] as const).map((v) => <Link key={v} href={`/painel/escritorio/agenda?${new URLSearchParams({ vista: v, data: base, ...(quem ? { quem } : {}) })}`}
          className={`${BOTAO} ${vista === v ? "border-verde font-semibold" : ""}`}>{v === "mes" ? "Mês" : v === "semana" ? "Semana" : "Lista"}</Link>)}
        {s.espaco.equipe && <form className="flex items-end gap-2"><input type="hidden" name="vista" value={vista} /><input type="hidden" name="data" value={base} />
          <select name="quem" defaultValue={quem} className={CAMPO_P} aria-label="Agenda de"><option value="">Toda a equipe</option>
            {s.membros.map((m) => <option key={m.user_id} value={m.user_id}>{m.nome}</option>)}</select>
          <button className={BOTAO}>Ver</button></form>}
      </div>
    </div>
    {agenda.error && <p role="alert">Não foi possível carregar a agenda.</p>}

    {vista === "mes" && <div className="overflow-x-auto"><div className="grid min-w-[720px] grid-cols-7 gap-px overflow-hidden rounded-xl border border-linha bg-linha">
      {SEMANA.map((d) => <div key={d} className="bg-superficie-2 px-2 py-1 text-xs font-semibold text-texto-2">{d}</div>)}
      {grade.map((d) => {
        const doDia = porDia.get(d) ?? [];
        const fora = d.slice(0, 7) !== base.slice(0, 7);
        return <div key={d} className={`min-h-28 bg-superficie p-1 ${fora ? "opacity-50" : ""}`}>
          <Link href={`/painel/escritorio/agenda?${params({ novo: "1", data: d })}`} title="Agendar neste dia"
            className={`mb-1 inline-block rounded px-1 text-xs ${d === hoje ? "bg-verde font-bold text-white" : "text-texto-2 hover:underline"}`}>{Number(d.slice(8))}</Link>
          <div className="space-y-1">{doDia.slice(0, 4).map((c) => item(c, true))}
            {doDia.length > 4 && <Link className="text-xs underline" href={`/painel/escritorio/agenda?${new URLSearchParams({ vista: "lista", data: d, ...(quem ? { quem } : {}) })}`}>+{doDia.length - 4}</Link>}</div>
        </div>;
      })}
    </div></div>}

    {vista === "semana" && <div className="overflow-x-auto"><div className="grid min-w-[840px] grid-cols-7 gap-2">
      {grade.map((d) => <div key={d} className="rounded-xl border border-linha bg-superficie-2/40 p-2">
        <p className={`mb-2 text-sm font-semibold ${d === hoje ? "text-verde" : ""}`}>{SEMANA[meio(d).getUTCDay()]} {d.slice(8)}/{d.slice(5, 7)}</p>
        <div className="space-y-1">{(porDia.get(d) ?? []).map((c) => item(c))}</div>
        <Link className="mt-2 block text-xs underline" href={`/painel/escritorio/agenda?${params({ novo: "1", data: d })}`}>+ agendar</Link>
      </div>)}
    </div></div>}

    {vista === "lista" && (!itens.length
      ? <p className="rounded-xl border border-dashed border-linha px-4 py-10 text-center text-texto-2">Nenhum compromisso nos próximos 30 dias.</p>
      : <ul className="cartao divide-y divide-linha">{itens.map((c) => <li key={c.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
        <span className="w-32 shrink-0 tabular-nums text-texto-2">{c.dia_inteiro ? diaSP(c.inicio).split("-").reverse().join("/") : dataHoraSP(c.inicio)}</span>
        <Link className={`min-w-0 flex-1 font-medium hover:underline ${c.status !== "agendado" ? "line-through opacity-60" : ""}`} href={`/painel/escritorio/agenda?${params({ editar: c.id })}`}>
          {TIPOS_COMPROMISSO[c.tipo]}: {c.titulo}</Link>
        <span className="text-texto-2">{[c.pessoa?.nome, c.imovel?.codigo, c.local, s.espaco.equipe && c.responsavel ? nome.get(c.responsavel) : null].filter(Boolean).join(" · ")}</span>
        {c.status === "agendado" && <form action={statusCompromisso}><input type="hidden" name="id" value={c.id} /><input type="hidden" name="status" value="feito" />
          <input type="hidden" name="_volta" value={volta} /><button className={BOTAO}>Feito</button></form>}
      </li>)}</ul>)}
  </section>;
}
