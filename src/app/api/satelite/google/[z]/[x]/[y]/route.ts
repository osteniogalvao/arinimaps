import { NextResponse } from "next/server";
import { limiteLeituraMapa } from "@/lib/geo/limiteMemoria";
import { cabeNoLimiteDoDia, googleConfigurado, urlTileGoogle } from "@/lib/map/googleTiles";

/**
 * Tile de satélite do Google: responde 302 para o tile no Google (com a sessão
 * e a chave). O servidor não baixa nem guarda a imagem. Detalhes e motivo em
 * src/lib/map/googleTiles.ts.
 */
export async function GET(request: Request, ctx: RouteContext<"/api/satelite/google/[z]/[x]/[y]">) {
  if (!googleConfigurado()) return NextResponse.json({ error: "Satélite do Google desligado." }, { status: 404 });
  const bloqueio = await limiteLeituraMapa(request, "tiles");
  if (bloqueio) return bloqueio;

  const { z: zs, x: xs, y: ys } = await ctx.params;
  const z = Number(zs), x = Number(xs), y = Number(ys);
  const max = 2 ** z;
  if (![z, x, y].every(Number.isInteger) || z < 0 || z > 22 || x < 0 || y < 0 || x >= max || y >= max) {
    return NextResponse.json({ error: "Tile inválido." }, { status: 400 });
  }
  if (!cabeNoLimiteDoDia()) {
    return NextResponse.json({ error: "Limite diário do satélite atingido." }, { status: 429, headers: { "Cache-Control": "no-store" } });
  }
  try {
    const destino = await urlTileGoogle(z, x, y);
    // a sessão dura ~2 semanas; o redirecionamento pode ficar 1 h no navegador
    return NextResponse.redirect(destino, { status: 302, headers: { "Cache-Control": "private, max-age=3600" } });
  } catch (e) {
    // o motivo (código do Google, sem a chave) ajuda a achar erro de configuração
    const motivo = e instanceof Error ? e.message.replace(/key=[^&\s]+/g, "key=***") : "";
    console.error("[satelite-google]", motivo);
    return NextResponse.json({ error: "Satélite indisponível.", motivo }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
