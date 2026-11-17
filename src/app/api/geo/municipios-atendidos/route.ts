import { NextResponse } from "next/server";
import { limiteLeituraMapa } from "@/lib/geo/limiteMemoria";
import { listarMunicipiosAtendidos } from "@/lib/geo/municipiosAtendidos";

/** Municípios onde a Arini anuncia (o cartão do CAR no mapa confere antes do "anunciar"). */
export async function GET(request: Request) {
  const bloqueio = await limiteLeituraMapa(request, "geo");
  if (bloqueio) return bloqueio;
  try {
    const municipios = await listarMunicipiosAtendidos();
    return NextResponse.json({ municipios }, {
      headers: { "Cache-Control": "public, max-age=300, stale-while-revalidate=3600" },
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
