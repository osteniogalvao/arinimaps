import { NextResponse } from "next/server";
import { consultarCar } from "@/lib/geo/car";
import { limiteLeituraMapa } from "@/lib/geo/limiteMemoria";
import { matriculasDoImovel } from "@/lib/rural/matricula";
import { pointOnFeature } from "@turf/turf";
import { podeVerArea, respostaTerceiro } from "@/lib/dados-terceiros";

export const maxDuration = 60;

/**
 * Matrícula de uma área do CAR pelo SIGEF (cartão do mapa e ficha da consulta).
 * Dado público do SIGEF, mas desde 18/11/2026 só aparece para área à venda,
 * área da própria conta ou plano com `dados_terceiros` (src/lib/dados-terceiros.ts).
 * Fica em cache por 12 h no servidor; no navegador, cache privado de 1 h.
 */
export async function GET(request: Request, ctx: RouteContext<"/api/geo/car/[cod]/matricula">) {
  const bloqueio = await limiteLeituraMapa(request, "geo");
  if (bloqueio) return bloqueio;
  const cod = decodeURIComponent((await ctx.params).cod);
  const acesso = await podeVerArea({ car: cod });
  if (!acesso.pode) return respostaTerceiro(!!acesso.userId);
  const { data, error } = await consultarCar(cod);
  if (error) return NextResponse.json({ error: "O cadastro rural está indisponível." }, { status: 503 });
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
      { headers: { "Cache-Control": "private, max-age=3600" } },
    );
  } catch (e) {
    console.error("matrícula SIGEF falhou:", e);
    return NextResponse.json(
      { error: "O SIGEF do INCRA não respondeu agora. Tente de novo em instantes.", codigo: "sigef_indisponivel" },
      { status: 502 },
    );
  }
}
