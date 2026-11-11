import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { publicarAgora } from "@/lib/modulos/marketing";

/**
 * Publicações agendadas que chegaram na hora (chamado pelo worker a cada
 * 10 min, com o SAUDE_TOKEN no cabeçalho x-saude-token).
 */
export async function POST(request: Request) {
  const esperado = process.env.SAUDE_TOKEN ?? "";
  const recebido = request.headers.get("x-saude-token") ?? "";
  if (!esperado || esperado.length !== recebido.length || !timingSafeEqual(Buffer.from(esperado), Buffer.from(recebido))) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }
  const admin = supabaseAdmin();
  const { data, error } = await admin.from("publicacoes").select("*").eq("status", "agendada")
    .lte("agendada_para", new Date().toISOString()).order("agendada_para").limit(10);
  if (error) return NextResponse.json({ ok: true, publicadas: 0 });
  let publicadas = 0;
  for (const p of data ?? []) {
    const mudanca = await publicarAgora(p);
    await admin.from("publicacoes").update(mudanca).eq("id", p.id).eq("status", "agendada");
    await logAudit({ acao: `publicacoes_${mudanca.status === "publicada" ? "publicada" : "erro"}_agendada`, entidade: "publicacoes", entidade_id: p.id, dados_depois: mudanca });
    if (mudanca.status === "publicada") publicadas++;
  }
  return NextResponse.json({ ok: true, publicadas });
}
