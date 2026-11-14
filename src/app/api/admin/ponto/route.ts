import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ator } from "@/lib/authz";
import { logAudit } from "@/lib/audit";

/**
 * Bater o ponto (migration 0067). A hora é a do servidor; só a marcação feita
 * sem internet (modo de campo) traz a hora do aparelho, marcada como
 * "offline" e aceita até 12 h para trás. A marcação não muda depois: erro se
 * corrige com ajuste aprovado.
 */
export async function POST(request: Request) {
  const a = await ator();
  if (!a?.ehArini) return NextResponse.json({ error: "Restrito à equipe." }, { status: 403 });
  const b = await request.json().catch(() => ({}));
  if (b.user_id !== undefined && b.user_id !== a.userId) return NextResponse.json({ error: "Esta marcação pertence a outra conta." }, { status: 403 });
  if (b.registro_cliente != null && !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(b.registro_cliente)) {
    return NextResponse.json({ error: "Identificador da marcação inválido." }, { status: 400 });
  }
  const num = (v: unknown, min: number, max: number) => {
    if (v == null || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) && n >= min && n <= max ? n : null;
  };
  const offline = b.offline_em ? new Date(String(b.offline_em)) : null;
  if (offline && Number.isNaN(+offline)) return NextResponse.json({ error: "Horário de marcação inválido." }, { status: 400 });
  const { data, error } = await supabaseAdmin().rpc("fn_registrar_ponto", {
    p_user: a.userId, p_registro: b.registro_cliente ?? null, p_offline_em: offline?.toISOString() ?? null,
    p_ip: (request.headers.get("x-forwarded-for") ?? "").split(",")[0].trim().slice(0, 60) || null,
    p_agente: (request.headers.get("user-agent") ?? "").slice(0, 300) || null,
    p_lat: num(b.latitude, -90, 90), p_lng: num(b.longitude, -180, 180), p_precisao: num(b.precisao, 0, 100_000),
  });
  if (error || !data) return NextResponse.json({ error: "Não foi possível registrar o ponto agora." }, { status: 503 });
  if (data.erro === "fora_do_prazo") return NextResponse.json({ error: "Marcação offline fora do prazo. Peça um ajuste." }, { status: 400 });
  if (data.erro === "proxima") return NextResponse.json({ error: "Já há uma marcação a menos de um minuto desse horário. Confira o espelho." }, { status: 409 });
  if (data.novo) await logAudit({ user_id: a.userId, acao: "ponto_marcado", entidade: "ponto_marcacoes", entidade_id: data.comprovante.id,
    dados_depois: { nsr: data.comprovante.nsr, origem: offline ? "offline" : "web" } });
  return NextResponse.json({ ok: true, comprovante: data.comprovante });
}
