import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { limiteLeituraMapa } from "@/lib/geo/limiteMemoria";
import { lerUnidade } from "@/lib/imovel/unidade";

type Colecao = { type: "FeatureCollection"; features: { properties: Record<string, unknown> }[] };

export async function GET(request: Request) {
  const bloqueio = await limiteLeituraMapa(request, "geo");
  if (bloqueio) return bloqueio;
  const admin = supabaseAdmin();
  const { data, error } = await admin.rpc("fn_properties_geojson");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // 18/11/2026 (Carlos, 16h57): clique no prédio abre as unidades por andar.
  // O mapa precisa saber, de cada anúncio, o prédio (imóvel pai), o andar e o
  // número da unidade. Vem numa leitura à parte (sem migration); se ela falhar,
  // o mapa segue como antes, só sem o agrupamento.
  const colecao = data as Colecao | null;
  const ids = (colecao?.features ?? []).map((f) => String(f.properties.id));
  if (ids.length) {
    const { data: extras } = await admin
      .from("properties")
      .select("id, parent_property_id, lote_id, lote_quadra, lote_numero, subtipo:caracteristicas->>subtipo, andar:caracteristicas->andar, unidade:caracteristicas->>unidade")
      // mesmo filtro da fn_properties_geojson (lista de ids estouraria a URL)
      .in("status", ["publicado", "em_negociacao"]);
    const paiIds = [...new Set((extras ?? []).map((e) => e.parent_property_id).filter(Boolean))] as string[];
    const { data: pais } = paiIds.length
      ? await admin.from("properties").select("id, codigo, titulo").in("id", paiIds)
      : { data: [] as { id: string; codigo: string; titulo: string }[] };
    const porId = new Map((extras ?? []).map((e) => [e.id as string, e]));
    const paiPorId = new Map((pais ?? []).map((p) => [p.id as string, p]));
    for (const f of colecao!.features) {
      const e = porId.get(String(f.properties.id));
      if (!e) continue;
      const u = lerUnidade(e as unknown as Record<string, unknown>);
      const pai = e.parent_property_id ? paiPorId.get(e.parent_property_id as string) : undefined;
      if (e.parent_property_id) f.properties.pai = e.parent_property_id;
      if (pai) { f.properties.pai_codigo = pai.codigo; f.properties.pai_titulo = pai.titulo; }
      if (u.subtipo) f.properties.subtipo = u.subtipo;
      if (u.andar != null) f.properties.andar = u.andar;
      if (u.unidade) f.properties.unidade = u.unidade;
      // 25/11/2026 (Stenio): o lote da planta urbana à venda acende no mapa, com quadra e número
      if (e.lote_id) f.properties.lote_id = e.lote_id;
      if (e.lote_quadra) f.properties.lote_quadra = e.lote_quadra;
      if (e.lote_numero) f.properties.lote_numero = e.lote_numero;
    }
  }

  return NextResponse.json(colecao, {
    headers: { "Cache-Control": "public, no-cache" },
  });
}
