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
  const origens = await supabaseAdmin().rpc("fn_matriz_pendencias_origem");
  // cobrança por níveis e resumo da Ari (0162); sem a migration, ficam de fora
  const cobranca = await supabaseAdmin().rpc("fn_matriz_cobranca");
  const resumo = await supabaseAdmin().rpc("fn_matriz_resumo", { p_forcar: true });
  // regras da Diretoria (0168) e lembretes de reunião (0169); sem as migrations, ficam de fora
  const configuradas = await supabaseAdmin().rpc("fn_automacoes_configuradas");
  const lembretes = await supabaseAdmin().rpc("fn_agenda_lembretes");
  const resultado = {
    ...(data as Record<string, number>), ...((modulos.data as Record<string, number> | null) ?? {}),
    ...((cobranca.data as Record<string, number> | null) ?? {}),
    ...((origens.data as Record<string, number> | null) ?? {}),
    ...((configuradas.data as Record<string, number> | null) ?? {}),
    ...((lembretes.data as Record<string, number> | null) ?? {}),
    ...(resumo.error ? {} : { resumo_ari: Number(resumo.data ?? 0) }),
  };
  if (modulos.error || origens.error || cobranca.error || resumo.error) {
    await logAudit({ user_id: a!.userId, acao: "automacoes_parciais", entidade: "tasks", dados_depois: resultado });
    return NextResponse.json({ ok: false, parcial: true, resultado,
      error: "Parte das automações não pôde ser concluída. As operações confirmadas foram preservadas. Tente novamente para processar as pendências." }, { status: 503 });
  }
  await logAudit({ user_id: a!.userId, acao: "automacoes_rodadas", entidade: "tasks", dados_depois: resultado });
  return NextResponse.json({ ok: true, resultado });
}
