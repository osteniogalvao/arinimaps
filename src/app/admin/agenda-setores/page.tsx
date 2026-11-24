import Link from "next/link";
import { exigirEquipe } from "@/lib/setores-servidor";
import { periodoAgenda } from "@/lib/agenda-setores";
import { lerAgendaSetores } from "@/lib/agenda-setores-servidor";
import { setorPorId } from "@/lib/setores";
import { CabecalhoPagina } from "@/components/ui/Pagina";
import { CAMPO_COMPACTO } from "@/components/admin/estilos";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { somenteLeituraEquipe } from "@/lib/seguranca/equipe";
import FormReuniao, { type Reuniao } from "@/components/admin/FormReuniao";

export default async function AgendaSetores({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await exigirEquipe(), sp = await searchParams;
  const hoje = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  const { de, ate } = periodoAgenda(sp.de, sp.ate, hoje);
  const setores = typeof sp.setor === "string" && user.setores.includes(sp.setor as typeof user.setores[number]) ? [sp.setor] : user.setores;
  const { itens, falhas, limitado } = await lerAgendaSetores(setores, de, ate);
  const leitura = somenteLeituraEquipe(user);
  const editar = typeof sp.reuniao === "string" && /^[0-9a-f-]{36}$/i.test(sp.reuniao) ? sp.reuniao : null;
  const [r, equipe] = await Promise.all([
    editar ? (await supabaseServer()).from("agenda_reunioes").select("*").eq("id", editar).maybeSingle() : Promise.resolve({ data: null, error: null }),
    !leitura ? supabaseAdmin().from("profiles").select("user_id,nome,setores,role").eq("ativo", true).neq("equipe_acesso", "leitura")
      .in("role", ["admin_central", "analista_arini"]).or(`role.eq.admin_central,setores.ov.{${user.setores.join(",")}}`).order("nome").limit(500) : Promise.resolve({ data: [], error: null }),
  ]);
  return <div className="max-w-5xl space-y-6">
    <CabecalhoPagina eyebrow="Central" titulo="Agenda dos setores" subtitulo="Reuniões e prazos de tarefas, CRMs, autorizações, pedidos de titulares, faturas, despesas e aluguéis." />
    {sp.aviso === "salvo" && <p role="status" className="text-verde">Reunião salva e responsável avisado.</p>}
    {sp.aviso === "invalido" && <p role="alert" className="text-critico">Não foi possível salvar. Confira as datas, o responsável ativo e a tarefa do mesmo setor.</p>}
    {sp.aviso === "conflito" && <p role="alert" className="text-critico">Outra pessoa alterou a reunião. Abra a versão atual antes de salvar.</p>}
    {editar && !r.data && <p role="alert">Reunião indisponível ou fora do seu setor.</p>}
    {!leitura && !equipe.error && <FormReuniao setores={user.setores} pessoas={equipe.data ?? []} reuniao={r.data as Reuniao | undefined} />}
    {equipe.error && <p role="alert">Equipe indisponível para agendamento. Tente novamente.</p>}
    <form className="flex flex-wrap items-end gap-3">
      <label className="grid gap-1 text-sm">De<input type="date" name="de" defaultValue={de} className={CAMPO_COMPACTO} /></label>
      <label className="grid gap-1 text-sm">Até<input type="date" name="ate" defaultValue={ate} className={CAMPO_COMPACTO} /></label>
      <label className="grid gap-1 text-sm">Setor<select name="setor" defaultValue={setores.length === 1 ? setores[0] : ""} className={CAMPO_COMPACTO}>
        <option value="">Todos os meus setores</option>{user.setores.map(s => <option key={s} value={s}>{setorPorId(s)?.nome ?? s}</option>)}
      </select></label><button className="btn-verde px-4 py-2">Filtrar</button>
    </form>
    {user.setores.includes("comercial") && <Link className="text-sm underline" href="/admin/agenda">Abrir agenda comercial de visitas e próximos contatos</Link>}
    {!!falhas.length && <p role="alert" className="text-alerta">Não foi possível consultar: {falhas.join(", ")}. Os demais compromissos estão abaixo.</p>}
    {limitado && <p role="status">Há mais de 500 compromissos em uma das fontes. Reduza o período para consultar todos.</p>}
    <p className="text-sm text-texto-2">{itens.length} compromisso(s) no período. As alterações são feitas na ficha de origem.</p>
    <ul className="divide-y divide-linha rounded-xl border border-linha">
      {itens.map(i => <li key={`${i.tipo}:${i.id}`}><Link href={i.href} className="flex flex-wrap items-center gap-3 px-4 py-3 hover:bg-superficie-2">
        <time className={i.data.slice(0, 10) < hoje ? "font-semibold text-critico" : "text-texto-2"} dateTime={i.data}>{i.data.slice(0, 10).split("-").reverse().join("/")}</time>
        <span className="flex-1 font-medium">{i.titulo}</span><span className="text-sm text-texto-2">{setorPorId(i.setor)?.nome ?? i.setor} · {i.tipo}</span>
      </Link></li>)}
      {!itens.length && <li className="px-4 py-8 text-texto-2">Nenhum compromisso encontrado para este período e setor.</li>}
    </ul>
  </div>;
}
