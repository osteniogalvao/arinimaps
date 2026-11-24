import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { ator, temSetor } from "@/lib/authz";

/** Roda as regras da Central agora (o worker roda sozinho a cada 10 min). */
export async function POST() {
  const a = await ator();
  if (!temSetor(a, "diretoria")) return NextResponse.json({ error: "Só a Diretoria roda as automações." }, { status: 403 });
  const { data, error } = await supabaseAdmin().rpc("fn_central_automacoes");
  if (error) return NextResponse.json({ error: "A Central ainda não foi atualizada (migration 0065)." }, { status: 400 });
  // regras dos módulos novos (0066 em diante); sem a migration, segue só com as da 0065
  const modulos = await supabaseAdmin().rpc("fn_central_modulos");
  // cobrança por níveis e resumo da Ari (0162); sem a migration, ficam de fora
  const cobranca = await supabaseAdmin().rpc("fn_matriz_cobranca");
  const resumo = await supabaseAdmin().rpc("fn_matriz_resumo", { p_forcar: true });
  const resultado = {
    ...(data as Record<string, number>), ...((modulos.data as Record<string, number> | null) ?? {}),
    ...((cobranca.data as Record<string, number> | null) ?? {}),
    ...(resumo.error ? {} : { resumo_ari: 1 }),
  };
  await logAudit({ user_id: a!.userId, acao: "automacoes_rodadas", entidade: "tasks", dados_depois: resultado });
  return NextResponse.json({ ok: true, resultado });
}
