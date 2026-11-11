import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ator, temSetor } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import { notificar } from "@/lib/notificacoes";
import { concluirTarefaDoEvento } from "@/lib/central";

/**
 * Ajustes de ponto: o colaborador pede (incluir marcação esquecida,
 * desconsiderar marcação errada ou abonar o dia) e a Diretoria decide.
 * Quem pede não decide o próprio ajuste.
 */
export async function POST(request: Request) {
  const a = await ator();
  if (!a?.ehArini) return NextResponse.json({ error: "Restrito à equipe." }, { status: 403 });
  const b = await request.json().catch(() => ({}));
  const tipo = String(b.tipo ?? "");
  const motivo = String(b.motivo ?? "").trim().slice(0, 1000);
  const data = String(b.data ?? "");
  if (!["incluir", "desconsiderar", "abono"].includes(tipo)) return NextResponse.json({ error: "Tipo de ajuste inválido." }, { status: 400 });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return NextResponse.json({ error: "Informe o dia." }, { status: 400 });
  if (motivo.length < 5) return NextResponse.json({ error: "Explique o motivo." }, { status: 400 });
  const linha: Record<string, unknown> = { user_id: a.userId, tipo, data, motivo };
  if (tipo === "incluir") {
    const h = String(b.hora ?? "");
    if (!/^\d{2}:\d{2}$/.test(h)) return NextResponse.json({ error: "Informe a hora da marcação." }, { status: 400 });
    linha.horario = new Date(`${data}T${h}:00-03:00`).toISOString();
  }
  if (tipo === "desconsiderar") {
    if (typeof b.marcacao_id !== "string") return NextResponse.json({ error: "Escolha a marcação." }, { status: 400 });
    linha.marcacao_id = b.marcacao_id;
  }
  const admin = supabaseAdmin();
  const { data: novo, error } = await admin.from("ponto_ajustes").insert(linha).select("id").single();
  if (error) return NextResponse.json({ error: "Não foi possível pedir o ajuste." }, { status: 400 });
  await logAudit({ user_id: a.userId, acao: "ponto_ajuste_pedido", entidade: "ponto_ajustes", entidade_id: novo.id, dados_depois: linha });
  const { data: dir } = await admin.from("profiles").select("user_id").eq("role", "admin_central").eq("ativo", true);
  for (const d of dir ?? []) {
    if (d.user_id !== a.userId) await notificar(d.user_id, "info", "Ajuste de ponto para decidir", motivo, "/admin/ponto/equipe", `ponto_ajuste:${novo.id}`);
  }
  return NextResponse.json({ ok: true });
}

export async function PATCH(request: Request) {
  const a = await ator();
  if (!temSetor(a, "diretoria")) return NextResponse.json({ error: "Só a Diretoria decide ajustes de ponto." }, { status: 403 });
  const b = await request.json().catch(() => ({}));
  const aprovar = b.decisao === "aprovar";
  const resposta = String(b.resposta ?? "").trim().slice(0, 1000);
  if (!aprovar && resposta.length < 5) return NextResponse.json({ error: "Explique por que o ajuste foi recusado." }, { status: 400 });
  const admin = supabaseAdmin();
  const { data: aj } = await admin.from("ponto_ajustes").select("*").eq("id", b.id).eq("status", "pendente").maybeSingle();
  if (!aj) return NextResponse.json({ error: "Ajuste não encontrado ou já decidido." }, { status: 404 });
  if (aj.user_id === a!.userId) return NextResponse.json({ error: "Ninguém decide o próprio ajuste." }, { status: 403 });
  if (aprovar && aj.tipo === "incluir") {
    const { error } = await admin.from("ponto_marcacoes").insert({ user_id: aj.user_id, marcado_em: aj.horario, origem: "ajuste", ajuste_id: aj.id });
    if (error) return NextResponse.json({ error: "Não foi possível incluir a marcação." }, { status: 400 });
  }
  await admin.from("ponto_ajustes").update({
    status: aprovar ? "aprovado" : "reprovado", decidido_por: a!.userId, decidido_em: new Date().toISOString(), resposta: resposta || null,
  }).eq("id", aj.id);
  await concluirTarefaDoEvento(`ponto_ajuste:${aj.id}`, a!.userId, aprovar ? "Ajuste aprovado" : "Ajuste recusado");
  await logAudit({ user_id: a!.userId, acao: aprovar ? "ponto_ajuste_aprovado" : "ponto_ajuste_recusado", entidade: "ponto_ajustes", entidade_id: aj.id, dados_antes: aj });
  await notificar(aj.user_id, aprovar ? "info" : "atencao", aprovar ? "Seu ajuste de ponto foi aprovado" : "Seu ajuste de ponto foi recusado",
    resposta || null, "/admin/ponto");
  return NextResponse.json({ ok: true });
}
