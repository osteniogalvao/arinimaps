import { NextResponse } from "next/server";
import { camadaNaJanela, JanelaGrande } from "@/lib/geo/camadasMapa";
import { camadaOficialPorId, type CamadaOficialId } from "@/lib/map/camadasOficiais";
import { limitarEmMemoria } from "@/lib/geo/limiteMemoria";
import { ipDoPedido, respostaLimite } from "@/lib/seguranca/limite";

/**
 * GET /api/camadas/{camada}?bbox=xmin,ymin,xmax,ymax — geometria de uma camada
 * oficial (SIGEF, embargos, ANM, FUNAI, UCs, quilombolas, PRODES) na janela do
 * mapa, para desenhar. Camadas públicas (D0) com atributos selecionados e limite por IP.
 */
export const maxDuration = 90;

export async function GET(request: Request, ctx: RouteContext<"/api/camadas/[camada]">) {
  const { camada } = await ctx.params;
  if (!camadaOficialPorId(camada)) return NextResponse.json({ error: "Camada desconhecida." }, { status: 404 });

  const l = limitarEmMemoria(`camadas:${ipDoPedido(request)}`, 300, 300);
  if (!l.permitido) return respostaLimite(l, "camadas do mapa");

  const [xmin, ymin, xmax, ymax] = (new URL(request.url).searchParams.get("bbox") ?? "").split(",").map(Number);
  const env = { xmin, ymin, xmax, ymax };
  if (![xmin, ymin, xmax, ymax].every(Number.isFinite) || xmin >= xmax || ymin >= ymax || xmin < -75 || xmax > -28 || ymin < -35 || ymax > 7) {
    return NextResponse.json({ error: "Janela inválida." }, { status: 400 });
  }

  try {
    const fc = await camadaNaJanela(camada as CamadaOficialId, env);
    if (fc.falhas === fc.celulas) return NextResponse.json({ error: "Fonte oficial indisponível para esta área. Tente novamente mais tarde." }, { status: 503 });
    return NextResponse.json(fc, { headers: { "Cache-Control": fc.falhas ? "no-store" : "public, max-age=300" } });
  } catch (e) {
    if (e instanceof JanelaGrande) return NextResponse.json({ error: "Aproxime o mapa para ver esta camada.", codigo: "aproxime" }, { status: 422 });
    console.error(`camada ${camada} falhou:`, e);
    return NextResponse.json({ error: "O órgão não respondeu agora. Tente de novo em instantes." }, { status: 502 });
  }
}
