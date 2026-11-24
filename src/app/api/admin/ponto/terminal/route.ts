import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ator } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import { limitar, respostaLimite } from "@/lib/seguranca/limite";
import { podeOperarTerminal } from "@/lib/ponto-terminal";

/**
 * Terminal de ponto (migration 0160). O computador da recepção fica logado
 * na conta do operador (diretoria ou recepção); a pessoa escolhe o nome e
 * digita o PIN dela, e a marcação fica no nome DELA, com origem "terminal".
 * Cinco tentativas por pessoa a cada 10 minutos, para o PIN não ser chutado.
 */
export async function POST(request: Request) {
  const a = await ator();
  if (!a?.ehArini || !(await podeOperarTerminal(a))) return NextResponse.json({ error: "Este computador não está liberado como terminal de ponto." }, { status: 403 });
  const corpo = await request.json().catch(() => null);
  if (!corpo || typeof corpo !== "object" || Array.isArray(corpo)) return NextResponse.json({ error: "Informe a pessoa e o PIN." }, { status: 400 });
  const { user_id, pin } = corpo;
  if (typeof user_id !== "string" || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(user_id)) return NextResponse.json({ error: "Escolha o seu nome na lista." }, { status: 400 });
  if (typeof pin !== "string" || !/^\d{4,6}$/.test(pin)) return NextResponse.json({ error: "Digite o seu PIN (4 a 6 números)." }, { status: 400 });
  const lim = await limitar(`ponto-terminal:${user_id}`, 5, 600);
  if (!lim.permitido) return respostaLimite(lim, "PIN");

  const { data, error } = await supabaseAdmin().rpc("fn_registrar_ponto_terminal", {
    p_user: user_id, p_pin: pin, p_operador: a.userId,
    p_ip: (request.headers.get("x-forwarded-for") ?? "").split(",")[0].trim().slice(0, 60) || null,
    p_agente: (request.headers.get("user-agent") ?? "").slice(0, 300) || null,
  });
  if (error || !data) {
    return NextResponse.json({ error: error && /fn_registrar_ponto_terminal|PGRST202/.test(error.message) ? "Falta rodar a migration 0160 (Terminal de ponto) no Supabase." : "Não foi possível registrar o ponto agora." }, { status: 503 });
  }
  if (data.erro === "sem_pin") return NextResponse.json({ error: "Você ainda não criou o seu PIN. Crie em Meu ponto, no seu login." }, { status: 400 });
  if (data.erro === "pin") return NextResponse.json({ error: "PIN incorreto." }, { status: 400 });
  if (data.erro === "proxima") return NextResponse.json({ error: "Você já marcou o ponto há menos de um minuto." }, { status: 409 });
  await logAudit({ user_id: a.userId, acao: "ponto_marcado", entidade: "ponto_marcacoes", entidade_id: data.comprovante.id,
    dados_depois: { nsr: data.comprovante.nsr, origem: "terminal", titular: user_id } });
  return NextResponse.json({ ok: true, comprovante: data.comprovante });
}
