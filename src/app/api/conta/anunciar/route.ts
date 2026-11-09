import { NextResponse } from "next/server";
import { lerConfiguracoes } from "@/lib/settings";

export const dynamic = "force-dynamic";

/**
 * Regras do formulário de anúncio (/painel/novo) que dependem das
 * Configurações da Central. Hoje: se a selfie no aceite da exclusividade é
 * exigida (`juridico_selfie_exclusividade`, a mesma chave que POST
 * /api/imoveis confere). Só booleanos públicos: nada de dado de conta.
 */
export async function GET() {
  const cfg = await lerConfiguracoes().catch(() => ({} as Record<string, unknown>));
  return NextResponse.json(
    { selfie_exclusividade: cfg.juridico_selfie_exclusividade !== false },
    { headers: { "Cache-Control": "private, max-age=60" } }
  );
}
