import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { limiteLeituraMapa } from "@/lib/geo/limiteMemoria";
import { matriculasDoImovel } from "@/lib/rural/matricula";
import { pointOnFeature } from "@turf/turf";

export const maxDuration = 60;

/**
 * Matrícula de uma área do CAR pelo SIGEF (cartão do mapa e ficha da consulta).
 * Dado público e gratuito, sem login: é o que o Carlos quer ver ao clicar no
 * imóvel. Fica em cache por 12 h no servidor e 1 h no navegador/CDN.
 */
export async function GET(request: Request, ctx: RouteContext<"/api/geo/car/[cod]/matricula">) {
  const bloqueio = await limiteLeituraMapa(request, "geo");
  if (bloqueio) return bloqueio;
  const cod = decodeURIComponent((await ctx.params).cod);
  const { data } = await supabaseAdmin().rpc("fn_car_imovel", { p_cod: cod });
  const geom = (data as { geometry?: GeoJSON.Geometry } | null)?.geometry;
  if (!geom || (geom.type !== "Polygon" && geom.type !== "MultiPolygon")) {
    return NextResponse.json({ error: "Área não encontrada no CAR importado." }, { status: 404 });
  }
  try {
    const matriculas = await matriculasDoImovel(`car:${cod}`, geom);
    // ponto DENTRO da área (o centroide pode cair fora em área em L): vai para o atalho do mapa do ONR
    const [lng, lat] = pointOnFeature(geom).geometry.coordinates;
    return NextResponse.json(
      { matriculas, ponto: { lat, lng }, fonte: "INCRA / SIGEF", consultado_em: new Date().toISOString() },
      { headers: { "Cache-Control": "public, max-age=3600, s-maxage=3600" } },
    );
  } catch (e) {
    console.error("matrícula SIGEF falhou:", e);
    return NextResponse.json(
      { error: "O SIGEF do INCRA não respondeu agora. Tente de novo em instantes.", codigo: "sigef_indisponivel" },
      { status: 502 },
    );
  }
}
