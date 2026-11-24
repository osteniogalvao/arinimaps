import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ator } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import { limitar, respostaLimite } from "@/lib/seguranca/limite";

/** Define ou troca o PIN do terminal de ponto da própria pessoa (migration 0160). */
export async function POST(request: Request) {
  const a = await ator();
  if (!a?.ehArini) return NextResponse.json({ error: "Restrito à equipe." }, { status: 403 });
  const lim = await limitar(`ponto-pin-definir:${a.userId}`, 10, 3600);
  if (!lim.permitido) return respostaLimite(lim, "troca de PIN");
  const corpo = await request.json().catch(() => null);
  const pin = corpo && typeof corpo === "object" && !Array.isArray(corpo) ? corpo.pin : null;
  if (typeof pin !== "string" || !/^\d{4,6}$/.test(pin)) return NextResponse.json({ error: "O PIN tem de 4 a 6 números." }, { status: 400 });
  if (/^(\d)\1+$/.test(pin) || "0123456789".includes(pin) || "9876543210".includes(pin)) {
    return NextResponse.json({ error: "Escolha um PIN menos óbvio (sem sequência nem números repetidos)." }, { status: 400 });
  }
  const { data, error } = await supabaseAdmin().rpc("fn_ponto_definir_pin", { p_user: a.userId, p_pin: pin });
  if (error) return NextResponse.json({ error: /fn_ponto_definir_pin|PGRST202/.test(error.message) ? "Falta rodar a migration 0160 (Terminal de ponto) no Supabase." : "Não foi possível salvar o PIN." }, { status: 503 });
  if (!data) return NextResponse.json({ error: "O PIN tem de 4 a 6 números." }, { status: 400 });
  await logAudit({ user_id: a.userId, acao: "ponto_pin_definido", entidade: "ponto_pins", entidade_id: a.userId });
  return NextResponse.json({ ok: true });
}
