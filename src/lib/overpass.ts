import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";

const CATEGORIAS: { categoria: string; seletor: string; extra?: boolean }[] = [
  { categoria: "combustivel", seletor: '"amenity"="fuel"' },
  { categoria: "farmacia", seletor: '"amenity"="pharmacy"' },
  { categoria: "supermercado", seletor: '"shop"="supermarket"' },
  { categoria: "hospital", seletor: '"amenity"~"hospital|clinic"' },
  { categoria: "escola", seletor: '"amenity"="school"' },
  { categoria: "acesso_rodovia", seletor: '"highway"~"motorway|trunk|primary"' },
  // 17/11/2026 (Stenio): mais do que existe em volta do lote, cada um com o seu ícone
  { categoria: "banco", seletor: '"amenity"="bank"', extra: true },
  { categoria: "igreja", seletor: '"amenity"="place_of_worship"', extra: true },
  { categoria: "restaurante", seletor: '"amenity"~"^(restaurant|cafe|fast_food)$"', extra: true },
  { categoria: "padaria", seletor: '"shop"="bakery"', extra: true },
  { categoria: "policia", seletor: '"amenity"="police"', extra: true },
  { categoria: "parque", seletor: '"leisure"~"^(park|playground)$"', extra: true },
];

type OsmEl = {
  type: string; id: number;
  lat?: number; lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
};

/**
 * Busca no Overpass os pontos de interesse ao redor de um ponto e grava no
 * cache (`pois`). Devolve quantos vieram. LANÇA em caso de falha — quem chama
 * decide se vira job do worker (imóvel) ou se segue sem (consulta do lote).
 * GOTCHA: o Overpass exige User-Agent (406 sem ele).
 */
export async function buscarPoisAoRedor(lng: number, lat: number, raio: number, municipalityId?: string | null): Promise<number> {
  const admin = supabaseAdmin();
  // dois grupos com limite próprio: o comércio do dia a dia (restaurantes,
  // igrejas...) é numeroso e não pode empurrar escolas e hospitais para fora
  const blocos = (extra: boolean) => CATEGORIAS
    .filter((c) => !!c.extra === extra)
    .map((c) => `nwr[${c.seletor}](around:${raio},${lat},${lng});`)
    .join("\n");
  const query = `[out:json][timeout:20];(${blocos(false)});out center 150;(${blocos(true)});out center 150;`;

  const res = await fetch("https://overpass-api.de/api/interpreter", {
    method: "POST",
    body: "data=" + encodeURIComponent(query),
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "AriniImoveisBrasil/1.0 (contato@arinibrasil.com.br)",
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(22_000),
  });
  if (!res.ok) throw new Error(`Overpass ${res.status}`);
  const json = (await res.json()) as { elements: OsmEl[] };

  const rows = [];
  for (const el of json.elements ?? []) {
    const plat = el.lat ?? el.center?.lat;
    const plng = el.lon ?? el.center?.lon;
    if (plat == null || plng == null) continue;
    const tags = el.tags ?? {};
    const categoria =
      tags.amenity === "fuel" ? "combustivel" :
      tags.amenity === "pharmacy" ? "farmacia" :
      tags.shop === "supermarket" ? "supermercado" :
      tags.amenity === "hospital" || tags.amenity === "clinic" ? "hospital" :
      tags.amenity === "school" ? "escola" :
      tags.amenity === "bank" ? "banco" :
      tags.amenity === "place_of_worship" ? "igreja" :
      ["restaurant", "cafe", "fast_food"].includes(tags.amenity ?? "") ? "restaurante" :
      tags.shop === "bakery" ? "padaria" :
      tags.amenity === "police" ? "policia" :
      tags.leisure === "park" || tags.leisure === "playground" ? "parque" :
      tags.highway ? "acesso_rodovia" : null;
    if (!categoria) continue;
    rows.push({
      categoria,
      nome: tags.name ?? (categoria === "acesso_rodovia" ? `Rodovia ${tags.ref ?? ""}`.trim() : null),
      geom: `SRID=4326;POINT(${plng} ${plat})`,
      ...(municipalityId ? { municipality_id: municipalityId } : {}),
      fonte: "osm",
      osm_id: `${el.type}/${el.id}`,
      fetched_at: new Date().toISOString(),
    });
  }
  if (rows.length) {
    // atualiza nome e data do que já existia: é assim que a fonte "envelhece" e renova
    await admin.from("pois").upsert(rows, { onConflict: "fonte,osm_id" });
  }
  const { error } = await admin.rpc("fn_semear_pois_centro");
  if (error) console.error("fn_semear_pois_centro:", error.message);
  return rows.length;
}

/**
 * Busca POIs no Overpass ao redor do centroide do imóvel, grava no cache (`pois`)
 * e vincula via fn_vincular_pois. Nunca lança — falha vira job para o worker.
 */
export async function buscarEVincularPois(propertyId: string): Promise<number> {
  const admin = supabaseAdmin();
  try {
    const { data: prop } = await admin
      .from("properties")
      .select("tipo, municipality_id")
      .eq("id", propertyId)
      .single();
    const { data: geo } = await admin.rpc("fn_property_admin_geometry", { p_property_id: propertyId });
    if (!prop || !geo) return 0;

    // centroide simples do geojson
    const coords: [number, number][] = [];
    const walk = (c: unknown): void => {
      if (Array.isArray(c) && typeof c[0] === "number") coords.push(c as [number, number]);
      else if (Array.isArray(c)) c.forEach(walk);
    };
    walk((geo as { coordinates: unknown }).coordinates);
    if (!coords.length) return 0;
    const lng = coords.reduce((s, c) => s + c[0], 0) / coords.length;
    const lat = coords.reduce((s, c) => s + c[1], 0) / coords.length;

    const { data: raioCfg } = await admin
      .from("settings").select("valor")
      .eq("chave", prop.tipo === "rural" ? "poi_raio_rural_m" : "poi_raio_urbano_m")
      .single();
    const raio = Number(raioCfg?.valor ?? 10000);

    await buscarPoisAoRedor(lng, lat, raio, prop.municipality_id);
    const { data: n, error: e2 } = await admin.rpc("fn_vincular_pois", { p_property_id: propertyId, p_raio_m: raio });
    if (e2) throw new Error(`fn_vincular_pois: ${e2.message}`);
    return Number(n ?? 0);
  } catch (e) {
    console.error("Overpass falhou, delegando ao worker:", e);
    await admin.from("jobs").insert({ tipo: "fetch_pois", payload: { property_id: propertyId } });
    return 0;
  }
}
