import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { entradaAtendimento } from "@/lib/atendimento";
import { lerConfiguracoes } from "@/lib/settings";
import { conferirOrigem, respostaOrigemNegada } from "@/lib/seguranca/origem";
import { ipDoPedido, limitar, respostaLimite } from "@/lib/seguranca/limite";

/**
 * Chat do site (0171). O navegador guarda um código aleatório; a conversa no
 * Atendimento é "site:<hash do código>", então só quem tem o código lê as
 * mensagens. Liga/desliga em Configurar atendimento (atendimento_chat_site).
 *   GET  ?codigo=…            → mensagens da conversa (últimas 100)
 *   POST { codigo, nome?, texto } → mensagem do visitante
 */
const CODIGO = /^[A-Za-z0-9_-]{32,64}$/;
const contato = (codigo: string) => "site:" + createHash("sha256").update(codigo).digest("hex").slice(0, 32);

async function ativo() {
  const cfg = await lerConfiguracoes();
  return cfg.atendimento_chat_site === true;
}

export async function GET(request: Request) {
  if (!(await ativo())) return NextResponse.json({ ativo: false, mensagens: [] });
  const codigo = new URL(request.url).searchParams.get("codigo") ?? "";
  if (!CODIGO.test(codigo)) return NextResponse.json({ ativo: true, mensagens: [] });
  const limite = await limitar("chat-site:ler:" + ipDoPedido(request), 120, 60);
  if (!limite.permitido) return respostaLimite(limite, "atualizações do chat");
  const { data } = await supabaseAdmin().from("whatsapp_mensagens")
    .select("id, direcao, texto, created_at").eq("telefone", contato(codigo))
    .order("created_at", { ascending: false }).limit(100);
  return NextResponse.json({
    ativo: true,
    mensagens: (data ?? []).reverse().map((m) => ({ id: m.id, de: m.direcao === "entrada" ? "voce" : "arini", texto: m.texto ?? "", em: m.created_at })),
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const origem = conferirOrigem(request);
  if (!origem.ok) return respostaOrigemNegada(origem.motivo);
  if (!(await ativo())) return NextResponse.json({ error: "O chat está desligado no momento." }, { status: 503 });
  if (Number(request.headers.get("content-length")) > 8_000) return NextResponse.json({ error: "Mensagem grande demais." }, { status: 413 });
  const b = (await request.json().catch(() => null)) as { codigo?: unknown; nome?: unknown; texto?: unknown } | null;
  const codigo = typeof b?.codigo === "string" ? b.codigo : "";
  const texto = typeof b?.texto === "string" ? b.texto.trim() : "";
  const nome = typeof b?.nome === "string" ? b.nome.trim().slice(0, 80) : "";
  if (!CODIGO.test(codigo) || !texto || texto.length > 2000) {
    return NextResponse.json({ error: "Escreva uma mensagem de até 2.000 caracteres." }, { status: 400 });
  }
  const [porIp, porConversa] = await Promise.all([
    limitar("chat-site:ip:" + ipDoPedido(request), 30, 600),
    limitar("chat-site:conversa:" + codigo, 15, 300),
  ]);
  if (!porIp.permitido) return respostaLimite(porIp, "mensagens");
  if (!porConversa.permitido) return respostaLimite(porConversa, "mensagens");
  const telefone = contato(codigo);
  const { data: gravada, error } = await supabaseAdmin().from("whatsapp_mensagens").insert({
    telefone, direcao: "entrada", tipo: "text", texto, canal: "site", recebida_em: new Date().toISOString(),
  }).select("id").single();
  if (error || !gravada) return NextResponse.json({ error: "Não foi possível enviar agora. Tente de novo." }, { status: 503 });
  const ok = await entradaAtendimento({ telefone, nome, texto, mensagemId: gravada.id, opp: null });
  if (!ok) return NextResponse.json({ error: "O atendimento está em atualização. Tente de novo em instantes." }, { status: 503 });
  return NextResponse.json({ ok: true });
}
