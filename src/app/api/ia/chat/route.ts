import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { consentimentoDaConta } from "@/lib/privacidade/consentimento";
import { ator } from "@/lib/authz";
import { falha } from "@/lib/erros";
import { logAudit } from "@/lib/audit";
import { lerConfiguracoes } from "@/lib/settings";
import { conferirRecurso, respostaNegacao } from "@/lib/planos-servidor";
import { limitar, respostaLimite } from "@/lib/seguranca/limite";
import { iaConfigurada, LIMITES_IA, maxIaSimultaneas } from "@/lib/ia/config";
import { fila, type Liberar } from "@/lib/seguranca/fila";
import { reservarAri } from "@/lib/ia/creditos";
import { mensagemDeErro, responder, type EventoAssistente, type RespostaAssistente, type Turno } from "@/lib/ia/assistente";

export const maxDuration = 120;
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Assistente de IA (PENDÊNCIA 5.1).
 *
 * POST { mensagem, conversaId? } → Server-Sent Events:
 *   data: {"tipo":"inicio","conversaId":"…"}
 *   data: {"tipo":"texto","texto":"…"}            (pedaços da resposta)
 *   data: {"tipo":"ferramenta","nome":"…","rotulo":"…"}
 *   data: {"tipo":"fim","fontes":[…],"restante":n|null}
 *   data: {"tipo":"erro","codigo":"…","mensagem":"…"}
 * Com ?stream=0 responde um JSON só, no fim (alternativa para quem não lê SSE).
 *
 * Travas, nesta ordem: chave instalada (503 ia_desligada) → função ligada →
 * sessão + recurso `chat_ia` no plano → cota mensal → limite por minuto/hora →
 * vaga entre as conversas simultâneas do servidor (503 ia_ocupada).
 * Tudo fica em ia_conversas/ia_mensagens; o audit_log recebe só metadados.
 */
export async function POST(request: Request) {
  if (!iaConfigurada()) {
    return falha(503, "ia_desligada", "Assistente em configuração.", {
      motivo: "A chave do provedor de IA (ANTHROPIC_API_KEY) ainda não foi instalada no servidor.",
      solucao: "Enquanto isso, use a busca de imóveis e o mapa.",
    });
  }
  const cfg = await lerConfiguracoes();
  if (cfg.ia_chat_ativo === false) {
    return falha(503, "ia_desligada", "O assistente está desligado no momento.", { motivo: "Desligado pela Arini em Configurações." });
  }

  const a = await ator();
  const { acesso, negacao } = await conferirRecurso(request, a ? { id: a.userId, role: a.role } : null, "chat_ia");
  if (negacao) return respostaNegacao(negacao);
  const userId = a!.userId;
  const guardar = await consentimentoDaConta(userId,"historico_ari");
  const nichoAtivo = a!.nicho;

  for (const [chave, max, janela] of [[`ia:min:${userId}`, LIMITES_IA.porMinuto, 60], [`ia:hora:${userId}`, LIMITES_IA.porHora, 3600]] as const) {
    const l = await limitar(chave, max, janela);
    if (!l.permitido) return respostaLimite(l, "perguntas ao assistente");
  }

  const corpo = await request.json().catch(() => null) as { mensagem?: unknown; conversaId?: unknown } | null;
  const pergunta = typeof corpo?.mensagem === "string" ? corpo.mensagem.trim() : "";
  if (!pergunta) return falha(400, "sem_mensagem", "Escreva a sua pergunta.");
  if (pergunta.length > LIMITES_IA.tamanhoPergunta) {
    return falha(400, "mensagem_longa", `A pergunta passou de ${LIMITES_IA.tamanhoPergunta} caracteres.`, { solucao: "Resuma e envie de novo." });
  }

  let liberarVaga: Liberar;
  try {
    liberarVaga = await fila("ia_conversas", maxIaSimultaneas()).entrar({ esperaMs: 0, maxFila: 0 });
  } catch {
    return falha(503, "ia_ocupada", "O assistente está atendendo muita gente agora. Tente de novo em instantes.", {
      motivo: `Limite de ${maxIaSimultaneas()} conversas ao mesmo tempo no servidor.`,
    });
  }
  // A partir daqui toda saída devolve a vaga: o `finally` do fluxo SSE (fim,
  // erro ou aborto do navegador, que chega a `responder` por request.signal),
  // o `finally` da resposta sem streaming ou a saída antecipada abaixo.

  const reserva = await reservarAri(a!, request, "chat");
  if (reserva.erro) { liberarVaga(); return reserva.erro; }
  const { modelo, restante } = reserva;
  const consultaTerritorial = acesso.recursos.has("consulta_area");

  // conversa: só a própria conta continua a sua
  const admin = supabaseAdmin();
  let conversaId = guardar && typeof corpo?.conversaId === "string" && UUID.test(corpo.conversaId) ? corpo.conversaId : null;
  let historico: Turno[] = [];
  if (conversaId) {
    const consulta = admin.from("ia_conversas").select("id").eq("historico_visivel",true).eq("id", conversaId).eq("user_id", userId);
    const { data: conv } = await (nichoAtivo ? consulta.eq("nicho", nichoAtivo) : consulta.is("nicho", null)).maybeSingle();
    if (!conv) conversaId = null;
    else {
      const { data: msgs } = await admin.from("ia_mensagens").select("papel, conteudo")
        .eq("conversa_id", conversaId).is("erro", null)
        .order("created_at", { ascending: false }).limit(LIMITES_IA.historico);
      historico = ((msgs ?? []) as Turno[]).reverse();
    }
  }
  if (!conversaId) {
    const { data: nova, error } = await admin.from("ia_conversas")
      .insert({ user_id: userId, nicho: nichoAtivo, historico_visivel:guardar, titulo: guardar ? pergunta.slice(0, 80) : "Uso sem histórico" }).select("id").single();
    if (error) {
      await reserva.estornar();
      liberarVaga();
      return falha(500, "conversa_falhou", "Não foi possível iniciar a conversa.", { motivo: error.message });
    }
    conversaId = nova.id as string;
  }
  await admin.from("ia_mensagens").insert({ conversa_id: conversaId, user_id: userId, papel: "user", conteudo: guardar ? pergunta : "" });


  const gravar = async (r: RespostaAssistente | null, erro: { codigo: string; mensagem: string } | null) => {
    if (erro) await reserva.estornar();
    else await reserva.concluir();
    const uso = r?.uso ?? { entrada: 0, saida: 0, cacheLeitura: 0, cacheEscrita: 0 };
    await admin.from("ia_mensagens").insert({
      conversa_id: conversaId, user_id: userId, papel: "assistant",
      conteudo: guardar ? r?.texto ?? "" : "", modelo: r?.modelo ?? null,
      ferramentas: guardar ? r?.ferramentas ?? [] : [],
      tokens_entrada: uso.entrada, tokens_saida: uso.saida,
      tokens_cache_leitura: uso.cacheLeitura, tokens_cache_escrita: uso.cacheEscrita,
      erro: erro?.codigo ?? null,
    });
    const { data: atual } = await admin.from("ia_conversas")
      .select("mensagens, tokens_entrada, tokens_saida, tokens_cache_leitura, tokens_cache_escrita").eq("id", conversaId).single();
    await admin.from("ia_conversas").update({
      modelo: r?.modelo ?? undefined,
      mensagens: Number(atual?.mensagens ?? 0) + 2,
      tokens_entrada: Number(atual?.tokens_entrada ?? 0) + uso.entrada,
      tokens_saida: Number(atual?.tokens_saida ?? 0) + uso.saida,
      tokens_cache_leitura: Number(atual?.tokens_cache_leitura ?? 0) + uso.cacheLeitura,
      tokens_cache_escrita: Number(atual?.tokens_cache_escrita ?? 0) + uso.cacheEscrita,
      updated_at: new Date().toISOString(),
    }).eq("id", conversaId);
    // auditoria: só metadados — nunca a pergunta nem a resposta
    await logAudit({
      user_id: userId, acao: "ia_mensagem", entidade: "ia_conversas", entidade_id: conversaId,
      dados_depois: {
        modelo: r?.modelo ?? null, tokens_entrada: uso.entrada, tokens_saida: uso.saida,
        ferramentas: (r?.ferramentas ?? []).map((f) => f.nome), parada: r?.parada ?? null, erro: erro?.codigo ?? null,
      },
    });
  };

  // ---------- sem streaming
  if (new URL(request.url).searchParams.get("stream") === "0") {
    try {
      const r = await responder({ historico, pergunta, modelo, consultaTerritorial, podeRegistrarLacuna: guardar, signal: request.signal });
      await gravar(r, null);
      return NextResponse.json({ conversaId, texto: r.texto, fontes: r.fontes, restante });
    } catch (e) {
      const erro = mensagemDeErro(e);
      console.error("assistente de IA falhou:", e);
      await gravar(null, erro);
      return falha(502, erro.codigo, erro.mensagem, { detalhes: { conversaId } });
    } finally {
      liberarVaga();
    }
  }

  // ---------- streaming (SSE)
  const codificador = new TextEncoder();
  const corpoSse = new ReadableStream<Uint8Array>({
    async start(controller) {
      let aberto = true;
      const enviar = (ev: Record<string, unknown>) => {
        if (!aberto) return;
        try { controller.enqueue(codificador.encode(`data: ${JSON.stringify(ev)}\n\n`)); } catch { aberto = false; }
      };
      enviar({ tipo: "inicio", conversaId, restante });
      try {
        const r = await responder({
          historico, pergunta, modelo, consultaTerritorial, podeRegistrarLacuna: guardar, signal: request.signal,
          aoEvento: (e: EventoAssistente) => enviar(e),
        });
        await gravar(r, null);
        enviar({ tipo: "fim", fontes: r.fontes, restante });
      } catch (e) {
        const erro = mensagemDeErro(e);
        console.error("assistente de IA falhou:", e);
        await gravar(null, erro);
        enviar({ tipo: "erro", ...erro });
      } finally {
        aberto = false;
        liberarVaga();
        try { controller.close(); } catch { /* já fechado pelo cliente */ }
      }
    },
  });
  return new Response(corpoSse, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
      Connection: "keep-alive",
    },
  });
}
