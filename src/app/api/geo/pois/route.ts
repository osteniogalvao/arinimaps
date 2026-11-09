import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { limiteLeituraMapa } from "@/lib/geo/limiteMemoria";

/**
 * Pontos de interesse de um anúncio, com a distância em linha reta do centro do
 * imóvel (roadmap 2.12). `GET /api/geo/pois?codigo=AIB-000001`.
 *
 * Lê o mesmo payload da página pública (fn_property_tour), que só responde para
 * anúncio publicado, em negociação ou vendido — nada de rascunho por aqui.
 */
export async function GET(request: Request) {
  const bloqueio = await limiteLeituraMapa(request, "geo");
  if (bloqueio) return bloqueio;
  const codigo = new URL(request.url).searchParams.get("codigo") ?? "";
  if (!/^[A-Z0-9-]{3,40}$/i.test(codigo)) {
    return NextResponse.json({ error: "Código de imóvel inválido.", codigo: "codigo_invalido" }, { status: 400 });
  }
  const admin = supabaseAdmin();
  const [{ data, error }, { data: prop }] = await Promise.all([
    admin.rpc("fn_property_tour", { p_codigo: codigo }),
    admin.from("properties").select("pois_atualizados_em").eq("codigo", codigo).maybeSingle(),
  ]);
  if (error) return NextResponse.json({ error: error.message, codigo: "erro_banco" }, { status: 500 });
  const pois = ((data as { pois?: unknown[] } | null)?.pois ?? []) as {
    nome: string | null; categoria: string; distancia_m: number; destaque: boolean; lng: number; lat: number;
  }[];
  return NextResponse.json(
    { pois, atualizado_em: (prop?.pois_atualizados_em as string | null) ?? null },
    { headers: { "Cache-Control": "public, max-age=300, stale-while-revalidate=3600" } }
  );
}
