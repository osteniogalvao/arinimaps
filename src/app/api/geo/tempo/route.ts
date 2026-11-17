import { NextResponse } from "next/server";
import { limiteLeituraMapa } from "@/lib/geo/limiteMemoria";
import { avisosInmet, previsaoGfs } from "@/lib/clima/tempo";

export const maxDuration = 30;

/**
 * Previsão (NOAA GFS) e avisos (INMET) de uma área rural: `lat`/`lng` do
 * centro da área e `ibge` do município (item 19 do PDF do Carlos, 17/11/2026).
 * Cada fonte responde em separado: uma fora do ar não apaga a outra, e a falha
 * aparece como falha, nunca como "sem avisos".
 */
export async function GET(request: Request) {
  const bloqueio = await limiteLeituraMapa(request, "geo");
  if (bloqueio) return bloqueio;
  const q = new URL(request.url).searchParams;
  const lat = Number(q.get("lat")), lng = Number(q.get("lng")), ibge = Number(q.get("ibge"));
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -34.5 || lat > 6 || lng < -74.5 || lng > -28.5) {
    return NextResponse.json({ error: "Ponto fora do Brasil.", codigo: "ponto_invalido" }, { status: 400 });
  }
  const [previsao, avisos] = await Promise.allSettled([
    previsaoGfs(lat, lng),
    Number.isInteger(ibge) && ibge >= 1_000_000 && ibge <= 9_999_999 ? avisosInmet(ibge) : Promise.resolve(null),
  ]);
  if (previsao.status === "rejected") console.error("previsão GFS falhou:", previsao.reason);
  if (avisos.status === "rejected") console.error("avisos INMET falharam:", avisos.reason);
  return NextResponse.json({
    previsao: previsao.status === "fulfilled" ? previsao.value : null,
    previsao_erro: previsao.status === "rejected" ? "A previsão da NOAA não respondeu agora." : null,
    avisos: avisos.status === "fulfilled" ? avisos.value : null,
    avisos_erro: avisos.status === "rejected" ? "O serviço de avisos do INMET não respondeu agora." : null,
  }, { headers: { "Cache-Control": "public, max-age=900, s-maxage=900" } });
}
