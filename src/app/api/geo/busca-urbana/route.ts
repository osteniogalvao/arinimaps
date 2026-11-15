import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { limiteLeituraMapa } from "@/lib/geo/limiteMemoria";

export async function GET(request: Request) {
  const bloqueio = await limiteLeituraMapa(request, "geo");
  if (bloqueio) return bloqueio;
  const params = new URL(request.url).searchParams;
  const termo = (params.get("q") ?? "").normalize("NFD").replace(/\p{M}/gu, "").trim();
  const lng = Number(params.get("lng")),
    lat = Number(params.get("lat"));
  if (
    termo.length < 3 ||
    termo.length > 100 ||
    !params.has("lng") ||
    !params.has("lat") ||
    !Number.isFinite(lng) ||
    !Number.isFinite(lat) ||
    Math.abs(lng) > 180 ||
    Math.abs(lat) > 90
  ) {
    return NextResponse.json(
      { error: "Informe o nome do lugar ou o identificador do lote." },
      { status: 400 },
    );
  }
  const { data, error } = await supabaseAdmin().rpc("buscar_referencia_urbana", {
    p_busca: termo,
    p_lng: lng,
    p_lat: lat,
  });
  if (error)
    return NextResponse.json(
      { error: "A busca urbana está indisponível. Tente novamente." },
      { status: 503 },
    );
  return NextResponse.json({ resultados: data }, { headers: { "Cache-Control": "public, max-age=300" } });
}
