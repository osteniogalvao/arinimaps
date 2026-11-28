import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ator, temSetor } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import { SETORES_ATENDIMENTO } from "@/lib/atendimento";
import { limparPassos } from "@/lib/atendimento-macros";

/**
 * Macros do atendimento (0179).
 *   GET  → macros que a pessoa vê (públicas e as suas)
 *   POST { acao: "salvar", id?, nome, passos, publica, ativo } · { acao: "remover", id }
 * Cada um cuida das suas; macro pública de outra pessoa, só a Diretoria muda.
 */
const UUID = /^[0-9a-f-]{36}$/i;
const falta0179 = (m?: string) => !!m && /atendimento_macros|42P01|does not exist/.test(m);

export async function GET() {
  const a = await ator();
  if (!a?.ehArini) return NextResponse.json({ error: "Restrito à equipe." }, { status: 403 });
  const { data, error } = await supabaseAdmin().from("atendimento_macros").select("id, nome, passos, publica, criado_por, ativo")
    .or(`publica.eq.true,criado_por.eq.${a.userId}`).order("nome");
  if (error) return NextResponse.json({ error: falta0179(error.message) ? "Falta rodar a migration 0179 (Macros)." : "Falha ao carregar as macros.", macros: [] }, { status: falta0179(error.message) ? 200 : 500 });
  return NextResponse.json({ macros: data ?? [], eu: a.userId, diretoria: temSetor(a, "diretoria") });
}

export async function POST(request: Request) {
  const a = await ator();
  if (!a?.ehArini) return NextResponse.json({ error: "Restrito à equipe." }, { status: 403 });
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const db = supabaseAdmin();
  const id = typeof b.id === "string" && UUID.test(b.id) ? b.id : null;

  if (id) {
    const { data: atual } = await db.from("atendimento_macros").select("criado_por").eq("id", id).maybeSingle();
    if (!atual) return NextResponse.json({ error: "Macro não encontrada." }, { status: 404 });
    if (atual.criado_por !== a.userId && !temSetor(a, "diretoria")) return NextResponse.json({ error: "Só quem criou (ou a Diretoria) muda esta macro." }, { status: 403 });
  }

  if (b.acao === "remover") {
    if (!id) return NextResponse.json({ error: "Macro inválida." }, { status: 400 });
    const { error } = await db.from("atendimento_macros").delete().eq("id", id);
    if (error) return NextResponse.json({ error: "Falha ao remover." }, { status: 500 });
    await logAudit({ acao: "macro_removida", entidade: "atendimento_macros", entidade_id: id, user_id: a.userId });
    return NextResponse.json({ ok: true });
  }

  if (b.acao !== "salvar") return NextResponse.json({ error: "Ação inválida." }, { status: 400 });
  const nome = String(b.nome ?? "").trim().slice(0, 80);
  const passos = limparPassos(b.passos, SETORES_ATENDIMENTO);
  if (nome.length < 2) return NextResponse.json({ error: "Dê um nome à macro." }, { status: 400 });
  if (!passos.length) return NextResponse.json({ error: "Adicione pelo menos um passo." }, { status: 400 });
  const linha = { nome, passos, publica: b.publica !== false, ativo: b.ativo !== false, updated_at: new Date().toISOString() };
  const r = id
    ? await db.from("atendimento_macros").update(linha).eq("id", id).select("id").single()
    : await db.from("atendimento_macros").insert({ ...linha, criado_por: a.userId }).select("id").single();
  if (r.error) return NextResponse.json({ error: falta0179(r.error.message) ? "Falta rodar a migration 0179 (Macros)." : "Falha ao salvar." }, { status: 500 });
  await logAudit({ acao: id ? "macro_editada" : "macro_criada", entidade: "atendimento_macros", entidade_id: r.data.id, user_id: a.userId });
  return NextResponse.json({ ok: true, id: r.data.id });
}
