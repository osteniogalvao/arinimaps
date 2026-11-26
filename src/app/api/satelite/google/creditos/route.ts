import { NextResponse } from "next/server";
import { limiteLeituraMapa } from "@/lib/geo/limiteMemoria";
import { creditosGoogle, googleConfigurado } from "@/lib/map/googleTiles";

/**
 * Crédito das imagens do Google na área da tela ("Imagens ©2026 Airbus, Maxar
 * Technologies"). Os termos exigem mostrar este texto junto do logo do Google;
 * o mapa pede de novo a cada movimento (src/lib/map/creditosGoogle.ts).
 */
export async function GET(request: Request) {
  if (!googleConfigurado()) return NextResponse.json({ copyright: "" }, { status: 404 });
  const bloqueio = await limiteLeituraMapa(request, "geo");
  if (bloqueio) return bloqueio;

  const p = new URL(request.url).searchParams;
  const [zoom, norte, sul, leste, oeste] = ["z", "n", "s", "e", "w"].map((k) => Number(p.get(k)));
  const valido = Number.isInteger(zoom) && zoom >= 0 && zoom <= 22 &&
    [norte, sul, leste, oeste].every(Number.isFinite) &&
    norte <= 90 && sul >= -90 && norte > sul && leste <= 180 && oeste >= -180;
  if (!valido) return NextResponse.json({ error: "Área inválida." }, { status: 400 });

  try {
    const copyright = await creditosGoogle(zoom, norte, sul, leste, oeste);
    return NextResponse.json({ copyright }, { headers: { "Cache-Control": "private, max-age=600" } });
  } catch (e) {
    const motivo = e instanceof Error ? e.message.replace(/key=[^&\s]+/g, "key=***") : "";
    console.error("[satelite-google]", motivo);
    return NextResponse.json({ copyright: "", motivo }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
