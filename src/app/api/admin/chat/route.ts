import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ator, type Ator } from "@/lib/authz";
import { notificar } from "@/lib/notificacoes";
import { limitar, respostaLimite } from "@/lib/seguranca/limite";
import { setorPorId, type SetorId } from "@/lib/setores";

/**
 * Chat interno da equipe (migration 0159).
 *   GET  ?conversa=<id>  → conversas que a pessoa enxerga (com "não lida"),
 *                          equipe para conversa direta e, se pedida, as
 *                          últimas mensagens da conversa (marca como lida)
 *   POST { acao: "enviar", conversa, texto }
 *        { acao: "direta", com }          → { conversa }
 * Direta: só os dois. Canal de setor: quem atua no setor (diretoria, todos).
 */
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const falta0159 = (m?: string) => !!m && /chat_conversas|chat_mensagens|chat_participantes|fn_chat_direta|42P01|PGRST20/.test(m);

type ConversaChat = {
  id: string; tipo: "direta" | "setor"; setor: string | null; membro_a: string | null; membro_b: string | null;
  ultima_em: string; ultima_previa: string | null; ultima_autor: string | null;
};

const pode = (a: Ator, c: ConversaChat) =>
  c.tipo === "direta" ? c.membro_a === a.userId || c.membro_b === a.userId : !!c.setor && a.setores.includes(c.setor as SetorId);

async function conversasDe(a: Ator) {
  const db = supabaseAdmin();
  const [diretas, canais] = await Promise.all([
    db.from("chat_conversas").select("*").eq("tipo", "direta").or(`membro_a.eq.${a.userId},membro_b.eq.${a.userId}`),
    a.setores.length ? db.from("chat_conversas").select("*").eq("tipo", "setor").in("setor", a.setores) : Promise.resolve({ data: [], error: null }),
  ]);
  const erro = diretas.error ?? canais.error;
  if (erro) return { erro: erro.message, lista: [] as ConversaChat[] };
  return { erro: null, lista: [...(canais.data ?? []), ...(diretas.data ?? [])] as ConversaChat[] };
}

export async function GET(request: Request) {
  const a = await ator();
  if (!a?.ehArini) return NextResponse.json({ error: "Restrito à equipe." }, { status: 403 });
  const db = supabaseAdmin();
  const { erro, lista } = await conversasDe(a);
  if (erro) return NextResponse.json({ error: falta0159(erro) ? "Falta rodar a migration 0159 (Chat interno) no Supabase." : "Falha ao carregar o chat." }, { status: 503 });

  const [{ data: leituras }, { data: equipe }] = await Promise.all([
    db.from("chat_participantes").select("conversa_id, lido_em").eq("user_id", a.userId),
    db.from("profiles").select("user_id, nome, setores, role").in("role", ["admin_central", "analista_arini"]).eq("ativo", true).order("nome"),
  ]);
  const lido = new Map((leituras ?? []).map((l) => [l.conversa_id as string, l.lido_em as string | null]));
  const nomeDe = new Map((equipe ?? []).map((p) => [p.user_id as string, (p.nome as string) || "Sem nome"]));

  const conversas = lista.map((c) => {
    const outro = c.tipo === "direta" ? (c.membro_a === a.userId ? c.membro_b : c.membro_a) : null;
    const l = lido.get(c.id);
    return {
      id: c.id, tipo: c.tipo, setor: c.setor, outro,
      titulo: c.tipo === "setor" ? `# ${setorPorId(c.setor ?? "")?.nome ?? c.setor}` : nomeDe.get(outro ?? "") ?? "Pessoa removida",
      ultima_em: c.ultima_em, ultima_previa: c.ultima_previa,
      ultima_autor: c.ultima_autor ? (c.ultima_autor === a.userId ? "Você" : nomeDe.get(c.ultima_autor) ?? "") : null,
      nao_lida: !!c.ultima_previa && c.ultima_autor !== a.userId && (!l || l < c.ultima_em),
    };
  }).sort((x, y) => (x.ultima_previa ? 0 : 1) - (y.ultima_previa ? 0 : 1) || y.ultima_em.localeCompare(x.ultima_em));

  const pedida = new URL(request.url).searchParams.get("conversa");
  let mensagens: unknown[] = [];
  if (pedida && UUID.test(pedida)) {
    const c = lista.find((x) => x.id === pedida);
    if (!c) return NextResponse.json({ error: "Conversa não encontrada." }, { status: 404 });
    const { data } = await db.from("chat_mensagens").select("id, autor, texto, apagada_em, created_at")
      .eq("conversa_id", c.id).order("created_at", { ascending: false }).limit(200);
    mensagens = (data ?? []).reverse().map((m) => ({
      ...m, texto: m.apagada_em ? null : m.texto, minha: m.autor === a.userId, autor_nome: nomeDe.get(m.autor as string) ?? "Ex-membro",
    }));
    const lidoEm = lido.get(c.id);
    if (!lidoEm || lidoEm < c.ultima_em) {
      await db.from("chat_participantes").upsert({ conversa_id: c.id, user_id: a.userId, lido_em: new Date().toISOString() });
      const conv = conversas.find((x) => x.id === c.id);
      if (conv) conv.nao_lida = false;
    }
  }

  return NextResponse.json({
    eu: a.userId, conversas, mensagens,
    equipe: (equipe ?? []).filter((p) => p.user_id !== a.userId).map((p) => ({ user_id: p.user_id, nome: (p.nome as string) || "Sem nome" })),
  });
}

export async function POST(request: Request) {
  const a = await ator();
  if (!a?.ehArini) return NextResponse.json({ error: "Restrito à equipe." }, { status: 403 });
  const lim = await limitar(`chat:${a.userId}`, 60, 60);
  if (!lim.permitido) return respostaLimite(lim, "mensagens");
  const corpo = await request.json().catch(() => null) as { acao?: unknown; conversa?: unknown; texto?: unknown; com?: unknown } | null;
  if (!corpo || typeof corpo !== "object" || Array.isArray(corpo)) return NextResponse.json({ error: "Envie uma ação válida para o chat." }, { status: 400 });
  const db = supabaseAdmin();

  if (corpo.acao === "direta") {
    if (typeof corpo.com !== "string" || !UUID.test(corpo.com) || corpo.com === a.userId) return NextResponse.json({ error: "Escolha uma pessoa da equipe." }, { status: 400 });
    const { data: p } = await db.from("profiles").select("role, ativo").eq("user_id", corpo.com).maybeSingle();
    if (!p || p.ativo === false || !["admin_central", "analista_arini"].includes(p.role)) return NextResponse.json({ error: "Essa pessoa não está na equipe." }, { status: 400 });
    const { data, error } = await db.rpc("fn_chat_direta", { p_eu: a.userId, p_outro: corpo.com });
    if (error) return NextResponse.json({ error: falta0159(error.message) ? "Falta rodar a migration 0159 (Chat interno) no Supabase." : "Falha ao abrir a conversa." }, { status: 503 });
    return NextResponse.json({ conversa: data });
  }

  if (corpo.acao === "enviar") {
    if (typeof corpo.texto !== "string") return NextResponse.json({ error: "Escreva uma mensagem de texto." }, { status: 400 });
    const texto = corpo.texto.trim();
    if (!texto) return NextResponse.json({ error: "Escreva a mensagem." }, { status: 400 });
    if (texto.length > 4000) return NextResponse.json({ error: "A mensagem pode ter até 4.000 caracteres." }, { status: 400 });
    if (typeof corpo.conversa !== "string" || !UUID.test(corpo.conversa)) return NextResponse.json({ error: "Conversa inválida." }, { status: 400 });
    const { data: c, error: e1 } = await db.from("chat_conversas").select("*").eq("id", corpo.conversa).maybeSingle();
    if (e1) return NextResponse.json({ error: falta0159(e1.message) ? "Falta rodar a migration 0159 (Chat interno) no Supabase." : "Falha ao enviar." }, { status: 503 });
    if (!c || !pode(a, c as ConversaChat)) return NextResponse.json({ error: "Conversa não encontrada." }, { status: 404 });
    const conv = c as ConversaChat;
    const { data: m, error } = await db.from("chat_mensagens").insert({ conversa_id: conv.id, autor: a.userId, texto }).select("id, created_at").single();
    if (error) return NextResponse.json({ error: "Falha ao enviar." }, { status: 500 });
    await db.from("chat_participantes").upsert({ conversa_id: conv.id, user_id: a.userId, lido_em: m.created_at });

    // Avisa no sino quem recebe uma conversa direta, só na primeira mensagem não lida.
    if (conv.tipo === "direta") {
      const outro = conv.membro_a === a.userId ? conv.membro_b! : conv.membro_a!;
      const { data: l } = await db.from("chat_participantes").select("lido_em").eq("conversa_id", conv.id).eq("user_id", outro).maybeSingle();
      const jaAvisado = conv.ultima_autor === a.userId && (!l?.lido_em || l.lido_em < conv.ultima_em);
      if (!jaAvisado) {
        const { data: eu } = await db.from("profiles").select("nome").eq("user_id", a.userId).maybeSingle();
        await notificar(outro, "info", `Mensagem de ${(eu?.nome as string) || "alguém da equipe"}`, texto.slice(0, 140), `/admin/chat?c=${conv.id}`);
      }
    }
    return NextResponse.json({ ok: true, id: m.id });
  }

  return NextResponse.json({ error: "Ação desconhecida." }, { status: 400 });
}
