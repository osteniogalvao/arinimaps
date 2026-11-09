// POIs de um imóvel: retry quando o Overpass falhou na publicação (`fetch_pois`)
// e atualização periódica (`refresh_pois`, roadmap 2.12). Em ambos o vínculo
// (fn_vincular_pois) carimba properties.pois_atualizados_em.
const CATEGORIAS = [
  { categoria: "combustivel", seletor: '"amenity"="fuel"' },
  { categoria: "farmacia", seletor: '"amenity"="pharmacy"' },
  { categoria: "supermercado", seletor: '"shop"="supermarket"' },
  { categoria: "hospital", seletor: '"amenity"~"hospital|clinic"' },
  { categoria: "escola", seletor: '"amenity"="school"' },
  { categoria: "acesso_rodovia", seletor: '"highway"~"motorway|trunk|primary"' },
];

/*
  O Overpass público vive sobrecarregado: na fila de 26/10/2026, 11 imóveis
  falharam com 429/502/504 em sequência, porque o job tentava um servidor só e
  o worker repetia na hora. Agora: três espelhos públicos, espera crescente
  entre as voltas e uma pausa curta depois de cada consulta, por cortesia.
*/
const ESPELHOS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];
const ESPERAS_MS = [0, 20_000, 60_000];
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

async function consultarOverpass(consulta) {
  let ultimo = "";
  for (const espera of ESPERAS_MS) {
    if (espera) await dormir(espera);
    for (const url of ESPELHOS) {
      try {
        const res = await fetch(url, {
          method: "POST",
          body: "data=" + encodeURIComponent(consulta),
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": "AriniImoveisBrasil/1.0 (contato@arinibrasil.com.br)",
            Accept: "application/json",
          },
          signal: AbortSignal.timeout(40_000),
        });
        if (res.ok) {
          const json = await res.json();
          await dormir(2_000);
          return json;
        }
        ultimo = `Overpass ${res.status} (${new URL(url).host})`;
        // 4xx que não é limite de uso: a consulta está errada, outro espelho não resolve
        if (res.status < 500 && res.status !== 429) throw new Error(ultimo);
      } catch (e) {
        if (e instanceof Error && e.message === ultimo) throw e;
        ultimo = `Overpass ${e instanceof Error ? e.message : e} (${new URL(url).host})`;
      }
    }
  }
  throw new Error(ultimo);
}

export async function fetchPois(payload, db) {
  const { property_id } = payload;
  const { rows: [prop] } = await db.query(`
    select p.tipo, st_x(g.centroid) as lng, st_y(g.centroid) as lat
    from properties p join property_geometries g on g.property_id = p.id
    where p.id = $1`, [property_id]);
  // imóvel apagado (ou sem divisa) depois de entrar na fila: não há o que
  // buscar, e repetir não muda nada — encerra em vez de virar erro
  if (!prop) {
    console.log(`[pois] imóvel ${property_id} sem geometria ou removido; nada a fazer`);
    return;
  }

  const { rows: [cfg] } = await db.query(
    `select valor from settings where chave = $1`,
    [prop.tipo === "rural" ? "poi_raio_rural_m" : "poi_raio_urbano_m"]);
  const raio = Number(cfg?.valor ?? 10000);

  const blocos = CATEGORIAS.map((c) => `nwr[${c.seletor}](around:${raio},${prop.lat},${prop.lng});`).join("");
  const json = await consultarOverpass(`[out:json][timeout:25];(${blocos});out center 120;`);

  // um INSERT só para todos os POIs (unnest), em vez de um por POI. Dedup por
  // osm_id antes: o mesmo id duas vezes no lote quebraria o ON CONFLICT
  // ("cannot affect row a second time").
  const porOsm = new Map();
  for (const el of json.elements ?? []) {
    const lat = el.lat ?? el.center?.lat;
    const lng = el.lon ?? el.center?.lon;
    if (lat == null || lng == null) continue;
    const tags = el.tags ?? {};
    const categoria =
      tags.amenity === "fuel" ? "combustivel" :
      tags.amenity === "pharmacy" ? "farmacia" :
      tags.shop === "supermarket" ? "supermercado" :
      tags.amenity === "hospital" || tags.amenity === "clinic" ? "hospital" :
      tags.amenity === "school" ? "escola" :
      tags.highway ? "acesso_rodovia" : null;
    if (!categoria) continue;
    porOsm.set(`${el.type}/${el.id}`, { categoria, nome: tags.name ?? null, lng, lat });
  }
  if (porOsm.size) {
    const ids = [...porOsm.keys()];
    const itens = [...porOsm.values()];
    await db.query(`
      insert into pois (categoria, nome, geom, fonte, osm_id)
      select c, n, st_setsrid(st_point(x, y), 4326), 'osm', o
      from unnest($1::text[], $2::text[], $3::float8[], $4::float8[], $5::text[]) as t(c, n, x, y, o)
      on conflict (fonte, osm_id) do update set nome = coalesce(excluded.nome, pois.nome), fetched_at = now()`,
      [itens.map((i) => i.categoria), itens.map((i) => i.nome), itens.map((i) => i.lng), itens.map((i) => i.lat), ids]);
  }
  await db.query(`select fn_semear_pois_centro()`);
  await db.query(`select fn_vincular_pois($1, $2)`, [property_id, raio]);
}
