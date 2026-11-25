import { CAMPO_COMPACTO } from "@/components/admin/estilos";
import { setorPorId } from "@/lib/setores";
import { salvarReuniao } from "@/app/admin/agenda-setores/acoes";

export type Reuniao = { id: string; versao: number; setor: string; titulo: string; responsavel: string; inicio: string; fim: string; local: string; lembrete_minutos: number; tarefa_id: string | null; status: string };
const localSP = (v?: string) => v ? new Date(Date.parse(v) - 3 * 3600_000).toISOString().slice(0, 16) : "";
export default function FormReuniao({ setores, pessoas, reuniao, abrir = false, setorInicial }: { setores: string[]; pessoas: { user_id: string; nome: string; setores: string[]; role: string }[]; reuniao?: Reuniao; abrir?: boolean; setorInicial?: string }) {
  return <details open={!!reuniao || abrir} className="rounded-xl border border-linha p-4" id="reuniao">
    <summary className="cursor-pointer font-semibold">{reuniao ? "Editar reunião" : "Agendar reunião"}</summary>
    <form action={salvarReuniao} className="mt-4 grid gap-4 sm:grid-cols-2">
      <input type="hidden" name="id" value={reuniao?.id ?? ""} /><input type="hidden" name="versao" value={reuniao?.versao ?? 0} />
      <label className="grid gap-1 text-sm sm:col-span-2">Título<input required minLength={3} maxLength={180} name="titulo" defaultValue={reuniao?.titulo} className={CAMPO_COMPACTO} /></label>
      <label className="grid gap-1 text-sm">Setor<select name="setor" defaultValue={reuniao?.setor ?? (setorInicial && setores.includes(setorInicial) ? setorInicial : setores[0])} className={CAMPO_COMPACTO}>{setores.map(s => <option key={s} value={s}>{setorPorId(s)?.nome}</option>)}</select></label>
      <label className="grid gap-1 text-sm">Responsável do setor<select name="responsavel" required defaultValue={reuniao?.responsavel ?? ""} className={CAMPO_COMPACTO}><option value="">Selecione</option>{pessoas.map(p => <option key={p.user_id} value={p.user_id}>{p.nome} · {p.role === "admin_central" ? "Diretoria" : p.setores.filter(s => setores.includes(s)).map(s => setorPorId(s)?.nome).join(", ")}</option>)}</select></label>
      <label className="grid gap-1 text-sm">Início (Brasília)<input required type="datetime-local" name="inicio" defaultValue={localSP(reuniao?.inicio)} className={CAMPO_COMPACTO} /></label>
      <label className="grid gap-1 text-sm">Fim (Brasília)<input required type="datetime-local" name="fim" defaultValue={localSP(reuniao?.fim)} className={CAMPO_COMPACTO} /></label>
      <label className="grid gap-1 text-sm sm:col-span-2">Local ou link da reunião<input name="local" maxLength={500} defaultValue={reuniao?.local} className={CAMPO_COMPACTO} /></label>
      <label className="grid gap-1 text-sm">Lembrete no painel (minutos antes)<input type="number" min={0} max={10080} name="lembrete" defaultValue={reuniao?.lembrete_minutos ?? 60} required className={CAMPO_COMPACTO} /></label>
      <label className="grid gap-1 text-sm">Situação<select name="status" defaultValue={reuniao?.status ?? "agendada"} className={CAMPO_COMPACTO}><option value="agendada">Agendada</option><option value="concluida">Concluída</option><option value="cancelada">Cancelada</option></select></label>
      <label className="grid gap-1 text-sm sm:col-span-2">ID de tarefa vinculada (opcional, do mesmo setor)<input name="tarefa_id" defaultValue={reuniao?.tarefa_id ?? ""} className={CAMPO_COMPACTO} /></label>
      <p className="text-xs text-texto-2 sm:col-span-2">O responsável recebe aviso no painel. Os lembretes são verificados a cada dez minutos. Cancelamentos e alterações ficam no histórico.</p>
      <button className="btn-verde w-fit px-4 py-2">Salvar reunião</button>
    </form>
  </details>;
}
