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
  const esperado = Buffer.from(process.env.SAUDE_TOKEN ?? "");
  const recebido = Buffer.from(request.headers.get("x-saude-token") ?? "");
  if (!esperado.length || esperado.length !== recebido.length || !timingSafeEqual(esperado, recebido)) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }
  const admin = supabaseAdmin();
  // Se o processo caiu depois de enviar ao provedor, só o canal confirma a entrega.
  const { error: falhaReservas } = await admin.from("publicacoes")
    .update({ status: "conferir", erro: "Envio interrompido. Confira no canal se o conteúdo foi publicado." })
    .eq("status", "enviando").lt("updated_at", new Date(Date.now() - 30 * 60_000).toISOString());
  if (falhaReservas) return NextResponse.json({ ok: false, error: "Falha ao verificar envios interrompidos." }, { status: 503 });
  const { data, error } = await admin.from("publicacoes").select("*").eq("status", "agendada")
    .lte("agendada_para", new Date().toISOString()).order("agendada_para").limit(10);
  if (error) return NextResponse.json({ ok: false, error: "Falha ao consultar publicações." }, { status: 503 });
  let publicadas = 0;
  let falhas = 0;
  for (const p of data ?? []) {
    try {
      const mudanca = await publicarAgora(p);
      if (!mudanca) continue;
      await logAudit({ acao: `publicacoes_${mudanca.status}_agendada`, entidade: "publicacoes", entidade_id: p.id, dados_depois: mudanca });
      if (mudanca.status === "publicada") publicadas++;
      else falhas++;
    } catch {
      falhas++;
    }
  }
  return NextResponse.json({ ok: !falhas, publicadas, falhas }, { status: falhas ? 503 : 200 });
}
