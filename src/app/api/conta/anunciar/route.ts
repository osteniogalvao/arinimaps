import { assinatura } from "@/lib/juridico/versoes";
import { exclusividadeVigente } from "@/lib/exclusividade-servidor";
import { NextResponse } from "next/server";
import { lerConfiguracoes } from "@/lib/settings";

export const dynamic = "force-dynamic";

/**
 * Regras do formulário de anúncio (/painel/novo) que dependem das
 * Configurações da Central. Hoje: se a selfie no aceite da exclusividade é
 * exigida (`juridico_selfie_exclusividade`, a mesma chave que POST
 * /api/imoveis confere). Retorna apenas regras públicas e identificadores das versões.
 */
export async function GET() {
  const cfg = await lerConfiguracoes();
  return NextResponse.json(
    { versoes: {
        cadastro:assinatura("termos-de-uso","privacidade"),
        exclusividade:assinatura("exclusividade","remuneracao"),
        parceiro:assinatura("parceiros","remuneracao"),
        outros:assinatura("termos-de-uso","remuneracao"),
      }, selfie_exclusividade: cfg.juridico_selfie_exclusividade === true, termos:{
      6:exclusividadeVigente(cfg,6).assinatura, 12:exclusividadeVigente(cfg,12).assinatura
    } },
    { headers: { "Cache-Control": "private, no-store" } }
  );
}
