import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ator, temSetor } from "@/lib/authz";
import { notificar } from "@/lib/notificacoes";
import type { SetorId } from "@/lib/setores";

/**
 * Conversa dentro do registro (migration 0067): a equipe comenta numa
 * oportunidade, imóvel, tarefa, despesa ou item de CRM, sem sair dele.
 * "@Nome" avisa a pessoa citada.
 */
const ENTIDADES: Record<string, { setores: SetorId[]; link: (id: string) => string; dono?: { tabela: string; coluna: string } }> = {
  opportunities: { setores: ["comercial", "diretoria", "juridico", "financeiro"], link: (id) => `/admin/oportunidades/${id}`, dono: { tabela: "opportunities", coluna: "responsavel_user_id" } },
  properties: { setores: ["operacoes", "comercial", "marketing", "cartografia", "juridico", "diretoria"], link: (id) => `/admin/imoveis/${id}` },
  tasks: { setores: ["operacoes", "comercial", "financeiro", "juridico", "marketing", "cartografia", "suporte", "seguranca", "diretoria"], link: (id) => `/admin/tarefas/${id}`, dono: { tabela: "tasks", coluna: "responsavel" } },
  despesas: { setores: ["financeiro", "diretoria"], link: () => "/admin/registros/despesas", dono: { tabela: "despesas", coluna: "solicitante" } },
  crm_itens: { setores: ["operacoes", "comercial", "financeiro", "juridico", "marketing", "cartografia", "suporte", "seguranca", "diretoria"], link: (id) => `/admin/crm/item/${id}`, dono: { tabela: "crm_itens", coluna: "responsavel" } },
};
const UUID = /^[0-9a-f-]{36}$/i;

export async function GET(request: Request) {
  const a = await ator();
  const u = new URL(request.url);
  const ent = ENTIDADES[u.searchParams.get("entidade") ?? ""];
  const id = u.searchParams.get("id") ?? "";
  if (!ent || !UUID.test(id) || !temSetor(a, ...ent.setores)) return NextResponse.json({ error: "Sem acesso." }, { status: 403 });
  const admin = supabaseAdmin();
  const { data, error } = await admin.from("registro_mensagens").select("id, autor, texto, created_at")
    .eq("entidade", u.searchParams.get("entidade")!).eq("entidade_id", id).order("created_at").limit(200);
  if (error) return NextResponse.json({ mensagens: [], indisponivel: true });
  const autores = [...new Set((data ?? []).map((m) => m.autor))];
  const { data: perfis } = autores.length ? await admin.from("profiles").select("user_id, nome").in("user_id", autores) : { data: [] };
  const nome = new Map((perfis ?? []).map((p) => [p.user_id, p.nome]));
  return NextResponse.json({ mensagens: (data ?? []).map((m) => ({ ...m, autor_nome: nome.get(m.autor) ?? "—", minha: m.autor === a!.userId })) });
}

export async function POST(request: Request) {
  const a = await ator();
  const b = await request.json().catch(() => ({}));
  const entidade = String(b.entidade ?? "");
  const ent = ENTIDADES[entidade];
  const id = String(b.id ?? "");
  const texto = String(b.texto ?? "").trim().slice(0, 4000);
  if (!ent || !UUID.test(id) || !temSetor(a, ...ent.setores)) return NextResponse.json({ error: "Sem acesso." }, { status: 403 });
  if (!texto) return NextResponse.json({ error: "Escreva a mensagem." }, { status: 400 });
  const admin = supabaseAdmin();
  const { data: equipe } = await admin.from("profiles").select("user_id, nome").in("role", ["admin_central", "analista_arini"]).eq("ativo", true);
  // @Nome ou @Nome Sobrenome: casa pelo nome cadastrado, sem acento e sem caixa
  const norm = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  const t = norm(texto);
  const mencoes = (equipe ?? []).filter((m) => m.nome && m.user_id !== a!.userId &&
    (t.includes("@" + norm(m.nome)) || t.includes("@" + norm(m.nome.split(" ")[0])))).map((m) => m.user_id);
  const { error } = await admin.from("registro_mensagens").insert({ entidade, entidade_id: id, autor: a!.userId, texto, mencoes });
  if (error) return NextResponse.json({ error: "A conversa ainda não foi ativada (migration 0067)." }, { status: 503 });
  const quem = (equipe ?? []).find((m) => m.user_id === a!.userId)?.nome ?? "Alguém da equipe";
  const avisar = new Set(mencoes);
  if (ent.dono) {
    const { data: dono } = await admin.from(ent.dono.tabela).select(ent.dono.coluna).eq("id", id).maybeSingle();
    const d = (dono as Record<string, string> | null)?.[ent.dono.coluna];
    if (d && d !== a!.userId) avisar.add(d);
  }
  for (const u of avisar) {
    await notificar(u, mencoes.includes(u) ? "atencao" : "info", `${quem} ${mencoes.includes(u) ? "citou você" : "comentou"}`, texto.slice(0, 200), ent.link(id));
  }
  return NextResponse.json({ ok: true });
}
