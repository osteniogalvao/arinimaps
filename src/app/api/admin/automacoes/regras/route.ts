import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { ator } from "@/lib/authz";
import { supabaseServer } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const a = await ator();
  if (!a || a.role !== "admin_central") return NextResponse.json({ error: "Só a Diretoria pode editar regras." }, { status: 403 });
  const b: unknown = await request.json().catch(() => null);
  if (!b || typeof b !== "object" || Array.isArray(b)) return NextResponse.json({ error: "Regra inválida." }, { status: 400 });
  const r = b as Record<string, unknown>;
  const textos = ["nome", "gatilho", "setor", "titulo", "descricao", "prioridade"];
  if (textos.some(k => typeof r[k] !== "string") || typeof r.ativa !== "boolean" || !Number.isInteger(r.prazo_dias)
    || (r.id !== undefined && (typeof r.id !== "string" || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(r.id)))
    || (r.id !== undefined && !Number.isInteger(r.versao))
    || (r.gatilho === "evento" && (typeof r.evento !== "string" || typeof r.condicao_campo !== "string" || typeof r.condicao_valor !== "string"))
    || (r.gatilho === "recorrente" && (!Number.isInteger(r.intervalo_dias) || typeof r.proxima_data !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(r.proxima_data)))) {
    return NextResponse.json({ error: "Confira os campos da regra." }, { status: 400 });
  }
  const { data, error } = await (await supabaseServer()).rpc("fn_automacao_salvar", { p_dados: r });
  if (error) {
    const status = error.code === "42501" ? 403 : error.code === "40001" ? 409 : error.code === "P0002" ? 404
      : ["22023", "22007", "22008", "22P02", "23502", "23503", "23514"].includes(error.code) ? 400 : 503;
    return NextResponse.json({ error: status === 409 ? "A regra mudou. Atualize a página antes de salvar."
      : status === 400 ? "Confira o evento, a condição e os campos da regra." : "Não foi possível salvar a regra agora." }, { status });
  }
  revalidatePath("/admin/automacoes");
  return NextResponse.json({ ok: true, id: data });
}
