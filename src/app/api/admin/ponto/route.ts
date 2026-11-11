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
  const num = (v: unknown, min: number, max: number) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= min && n <= max ? n : null;
  };
  const linha: Record<string, unknown> = {
    user_id: a.userId, origem: "web",
    ip: (request.headers.get("x-forwarded-for") ?? "").split(",")[0].trim().slice(0, 60) || null,
    user_agent: (request.headers.get("user-agent") ?? "").slice(0, 300) || null,
    latitude: num(b.latitude, -90, 90), longitude: num(b.longitude, -180, 180), precisao_m: num(b.precisao, 0, 100_000),
  };
  if (b.offline_em) {
    const t = new Date(String(b.offline_em));
    if (Number.isNaN(+t) || +t > Date.now() + 60_000 || +t < Date.now() - 12 * 3_600_000) {
      return NextResponse.json({ error: "Marcação offline fora do prazo. Peça um ajuste." }, { status: 400 });
    }
    linha.origem = "offline";
    linha.marcado_em = t.toISOString();
  }
  const admin = supabaseAdmin();
  // duas marcações no mesmo minuto quase sempre são clique duplo
  const { data: ultima } = await admin.from("ponto_marcacoes").select("marcado_em").eq("user_id", a.userId)
    .order("marcado_em", { ascending: false }).limit(1).maybeSingle();
  if (ultima && Math.abs(+new Date(String(linha.marcado_em ?? new Date().toISOString())) - +new Date(ultima.marcado_em)) < 60_000) {
    return NextResponse.json({ error: "Você acabou de bater o ponto." }, { status: 409 });
  }
  const { data, error } = await admin.from("ponto_marcacoes").insert(linha).select("id, nsr, marcado_em, hash").single();
  if (error) return NextResponse.json({ error: "O ponto ainda não foi ativado (migration 0067)." }, { status: 503 });
  await logAudit({ user_id: a.userId, acao: "ponto_marcado", entidade: "ponto_marcacoes", entidade_id: data.id, dados_depois: { nsr: data.nsr, origem: linha.origem } });
  return NextResponse.json({ ok: true, comprovante: data });
}
