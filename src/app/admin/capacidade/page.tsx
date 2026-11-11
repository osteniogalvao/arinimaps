import { Gauge } from "lucide-react";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { exigirSetor } from "@/lib/setores-servidor";
import { setoresDe, TAREFA_STATUS_ABERTOS } from "@/lib/setores";
import { CabecalhoPagina, Vazio } from "@/components/ui/Pagina";
import { TABELA, TABELA_CAIXA, TBODY, TD, TH, THEAD, TR } from "@/components/admin/estilos";
import CapacidadeCampo from "@/components/admin/CapacidadeCampo";

const FECHADAS = ["fechado", "pos_venda", "perdido"];

/**
 * Capacidade da equipe (Diretoria): quanto cada pessoa tem em aberto
 * (tarefas, leads e itens de CRM) contra a capacidade combinada. Serve para
 * distribuir trabalho antes que alguém afogue.
 */
export default async function Capacidade() {
  await exigirSetor("diretoria");
  const admin = supabaseAdmin();
  const [{ data: equipe, error }, { data: tarefas }, { data: opps }, { data: itens }] = await Promise.all([
    admin.from("profiles").select("user_id, nome, role, setores, capacidade_tarefas").in("role", ["admin_central", "analista_arini"]).eq("ativo", true).order("nome"),
    admin.from("tasks").select("responsavel, prazo").in("status", TAREFA_STATUS_ABERTOS).not("responsavel", "is", null),
    admin.from("opportunities").select("responsavel_user_id").not("responsavel_user_id", "is", null).not("etapa", "in", `(${FECHADAS.join(",")})`),
    admin.from("crm_itens").select("responsavel").eq("status", "aberto").not("responsavel", "is", null),
  ]);
  if (error) return <Vazio icone={Gauge} titulo="Falta atualizar o banco" texto="A capacidade precisa da migration 0067." />;
  const hoje = new Date().toISOString().slice(0, 10);
  const conta = (lista: Record<string, unknown>[] | null, col: string) => {
    const m = new Map<string, number>();
    for (const x of lista ?? []) m.set(String(x[col]), (m.get(String(x[col])) ?? 0) + 1);
    return m;
  };
  const t = conta(tarefas, "responsavel"), o = conta(opps, "responsavel_user_id"), c = conta(itens, "responsavel");
  const atrasadas = conta((tarefas ?? []).filter((x) => x.prazo && String(x.prazo).slice(0, 10) < hoje), "responsavel");

  return (
    <div className="max-w-5xl space-y-6">
      <CabecalhoPagina eyebrow="Diretoria" titulo="Capacidade da equipe" subtitulo="Carga em aberto de cada pessoa contra a capacidade combinada. Acima de 100%, redistribua antes de cobrar." />
      <div className={TABELA_CAIXA}>
        <table className={TABELA}>
          <thead className={THEAD}><tr>
            <th className={TH}>Pessoa</th><th className={TH}>Setores</th><th className={TH}>Tarefas</th><th className={TH}>Atrasadas</th>
            <th className={TH}>Leads</th><th className={TH}>CRM</th><th className={TH}>Carga</th><th className={TH}>Capacidade</th>
          </tr></thead>
          <tbody className={TBODY}>
            {(equipe ?? []).map((m) => {
              const carga = (t.get(m.user_id) ?? 0) + (o.get(m.user_id) ?? 0) + (c.get(m.user_id) ?? 0);
              const pct = Math.round((carga / Math.max(1, m.capacidade_tarefas)) * 100);
              return (
                <tr key={m.user_id} className={TR}>
                  <td className={TD + " font-medium text-texto"}>{m.nome || "—"}</td>
                  <td className={TD + " text-xs text-texto-2"}>{m.role === "admin_central" ? "Diretoria" : setoresDe(m.role, m.setores).join(", ")}</td>
                  <td className={TD + " tabular-nums"}>{t.get(m.user_id) ?? 0}</td>
                  <td className={TD + " tabular-nums " + (atrasadas.get(m.user_id) ? "text-critico" : "")}>{atrasadas.get(m.user_id) ?? 0}</td>
                  <td className={TD + " tabular-nums"}>{o.get(m.user_id) ?? 0}</td>
                  <td className={TD + " tabular-nums"}>{c.get(m.user_id) ?? 0}</td>
                  <td className={TD}>
                    <span className="flex items-center gap-2">
                      <span className="h-1.5 w-20 rounded-full bg-superficie-2"><span className={"block h-1.5 rounded-full " + (pct > 100 ? "bg-critico" : pct > 80 ? "bg-ouro" : "bg-verde")} style={{ width: `${Math.min(100, pct)}%` }} /></span>
                      <span className={"text-xs tabular-nums " + (pct > 100 ? "text-critico" : "text-texto-2")}>{pct}%</span>
                    </span>
                  </td>
                  <td className={TD}><CapacidadeCampo userId={m.user_id} valor={m.capacidade_tarefas} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
