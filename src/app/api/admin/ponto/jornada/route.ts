import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ator, temSetor } from "@/lib/authz";
import { logAudit } from "@/lib/audit";

/** Jornada de trabalho de um colaborador (Diretoria). */
export async function PUT(request: Request) {
  const a = await ator();
  if (!temSetor(a, "diretoria")) return NextResponse.json({ error: "Só a Diretoria define jornadas." }, { status: 403 });
  const b = await request.json().catch(() => ({}));
  const int = (v: unknown, min: number, max: number, alt: number) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : alt;
  };
  const dias = Array.isArray(b.dias_semana) ? b.dias_semana.map(Number).filter((d: number) => d >= 1 && d <= 7) : [1, 2, 3, 4, 5];
  const linha = {
    user_id: String(b.user_id ?? ""),
    carga_diaria_min: int(b.carga_horas, 1, 12, 8) * 60,
    intervalo_min: int(b.intervalo_min, 0, 240, 60),
    dias_semana: dias,
    entrada_prevista: /^\d{2}:\d{2}$/.test(String(b.entrada_prevista)) ? b.entrada_prevista : "08:00",
    tolerancia_min: int(b.tolerancia_min, 0, 60, 10),
    ativo: b.ativo !== false,
    updated_at: new Date().toISOString(),
  };
  const { error } = await supabaseAdmin().from("ponto_jornadas").upsert(linha);
  if (error) return NextResponse.json({ error: "Não foi possível salvar a jornada." }, { status: 400 });
  await logAudit({ user_id: a!.userId, acao: "ponto_jornada_definida", entidade: "ponto_jornadas", entidade_id: linha.user_id, dados_depois: linha });
  return NextResponse.json({ ok: true });
}
