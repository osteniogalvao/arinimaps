// Gera os lotes urbanos de uma planta vetorial: fecha as linhas do CAD em
// polígonos e fica com as faces que têm tamanho e forma de lote.
//
// Usado pelo worker (job `gerar_lotes`) e por scripts/gera-lotes.mjs. Precisa
// de conexão direta com o banco: a poligonização de Iturama leva ~75 s, mais do
// que cabe numa requisição web.
//
// O QUE É "LOTE" AQUI. Face com área entre AREA_MIN e AREA_MAX e compacta
// (4π·área/perímetro² > COMPACIDADE_MIN). O filtro de forma tira as faixas
// compridas — calçada, canteiro, a rua entre duas quadras — que têm área de
// lote mas não são lote. Quadra inteira sem subdivisão fica de fora pelo teto
// de área. É uma leitura do desenho, não um cadastro: lote que o CAD não fechou
// (traço faltando) não aparece.

import { seletorDeMatriz, pedacosComMatriz, assinaturaAjustes, assinaturaExclusoes, assinaturaEdicoes, aplicarEdicoes } from "./ajustes.mjs";

const AREA_MIN = 100;      // m² — abaixo disso é detalhe de desenho
const AREA_MAX = 5000;     // m² — acima disso é quadra ou gleba
const COMPACIDADE_MIN = 0.3;
const GRADE_M = 0.05;      // linhas que quase se tocam (até 5 cm) passam a se tocar

// PONTAS SOLTAS. Planta de prefeitura é desenhada sem "snap": a linha do lote
// para a centímetros da linha da quadra, e para o olho fecha, para a geometria
// não. Medido em 01/10/2026 numa janela do centro de Iturama: de 2.176 pontas de
// linha, 536 terminavam entre 0 e 30 cm da linha vizinha sem tocar. Sem tratar
// isso a janela rendia 80 lotes; esticando cada ponta 30 cm, 263. Esticar mais
// (até 2 m) não muda o resultado — o que faltava era o toque.
const ESTICA_M = 0.3;

// Poligonizar a cidade inteira de uma vez não escala: com as pontas esticadas,
// a união das 122 mil linhas de Iturama passou de 10 minutos. Em ladrilhos de
// 400 m cada pedaço leva décimos de segundo. A margem é maior que o maior lote
// (5.000 m² pode ter 100 m de lado), e a face só entra pelo ladrilho em que o
// seu ponto interno cai — nenhum lote é contado duas vezes nem cortado.
const LADRILHO_M = 400;

const MARGEM_M = 130;

/** Centro do retângulo da coleção, em graus — o mesmo cálculo de centroDe() no app. */
export function centroDe(fc) {
  let x0 = 180, y0 = 90, x1 = -180, y1 = -90;
  const olhar = (c) => {
    if (Array.isArray(c) && typeof c[0] === "number" && typeof c[1] === "number") {
      if (c[0] < x0) x0 = c[0]; if (c[0] > x1) x1 = c[0];
      if (c[1] < y0) y0 = c[1]; if (c[1] > y1) y1 = c[1];
      return;
    }
    if (Array.isArray(c)) for (const f of c) olhar(f);
  };
  for (const f of fc.features) if (f.geometry?.coordinates) olhar(f.geometry.coordinates);
  return x0 > x1 ? [0, 0] : [(x0 + x1) / 2, (y0 + y1) / 2];
}

/**
 * Coeficientes de ST_Affine que reproduzem, em graus, a calibração que o mapa
 * aplica no navegador (src/lib/geo/deslocar.ts: escala e giro em torno do
 * centro, em metros locais, depois deslocamento). Tem de ser a MESMA conta, ou
 * o lote clicável fica deslocado da linha da planta que o usuário está vendo.
 */
export function afim(centro, t) {
  const [cx, cy] = centro;
  const kx = 111_320 * Math.cos((cy * Math.PI) / 180), ky = 110_540;
  const rad = (t.rot * Math.PI) / 180, cos = Math.cos(rad), sen = Math.sin(rad), s = t.esc || 1;
  const a = s * cos, b = (-s * sen * ky) / kx, d = (s * sen * kx) / ky, e = s * cos;
  return { a, b, d, e, xoff: cx - a * cx - b * cy + t.dx / kx, yoff: cy - d * cx - e * cy + t.dy / ky };
}

export const assinaturaDe = (c) =>
  [c.offset_leste_m ?? 0, c.offset_norte_m ?? 0, c.rotacao_graus ?? 0, c.escala ?? 1, [...(c.layers_ocultos ?? [])].sort().join("|")].join(";") +
  assinaturaExclusoes(c.linhas_excluidas) + assinaturaAjustes(c.ajustes_locais) + assinaturaEdicoes(c.edicoes_geometria);

/**
 * @param {{layer_id: string}} payload
 * @param {import("pg").Pool} db
 */
export async function gerarLotes(payload, db) {
  const base = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) throw new Error("SUPABASE_URL não configurada");
  const client = await db.connect();
  try {

    const { rows: [cam] } = await client.query(
      `select id, nome, municipality_id, tiles_path, layers_ocultos, linhas_excluidas, offset_leste_m, offset_norte_m, rotacao_graus, escala, ajustes_locais, edicoes_geometria
       from cartography_layers where id = $1 and tipo = 'vector'`, [payload.layer_id]);
    if (!cam) throw new Error("planta vetorial não encontrada");

    const arquivo = await fetch(`${base}/storage/v1/object/public/media/${cam.tiles_path}`, { signal: AbortSignal.timeout(120_000) });
    if (!arquivo.ok) throw new Error(`Falha ao ler a planta: HTTP ${arquivo.status}`);
    const original = await arquivo.json();
    if (!Array.isArray(original?.features)) throw new Error("GeoJSON da planta ilegível");
    const centroOriginal = centroDe(original);
    const fc = aplicarEdicoes(original, cam.edicoes_geometria);
    // cada linha usa a matriz da sua parte ajustada, ou a da planta (worker/jobs/ajustes.mjs)
    const matrizDe = seletorDeMatriz(centroOriginal, {
      dx: Number(cam.offset_leste_m ?? 0), dy: Number(cam.offset_norte_m ?? 0),
      rot: Number(cam.rotacao_graus ?? 0), esc: Number(cam.escala ?? 1),
    }, cam.ajustes_locais);
    const ocultos = new Set(cam.layers_ocultos ?? []);
    // linhas apagadas na calibração (chave "i" ou "i:j", posição no arquivo original)
    const apagadas = new Set(cam.linhas_excluidas ?? []);
    const temPartes = (cam.ajustes_locais ?? []).length > 0;

    await client.query("begin");
    await client.query("set local statement_timeout = '5min'");
    await client.query("create temp table _linhas (geom geometry(LineString, 31982)) on commit drop");
    let linhas = 0;
    for (const [i, f0] of fc.features.entries()) {
      if (ocultos.has(String(f0.properties?.layer ?? "")) || !f0.geometry || apagadas.has(String(i))) continue;
      let f = f0;
      if (apagadas.size && f0.geometry.type === "MultiLineString") {
        const linhasVivas = f0.geometry.coordinates.filter((_, j) => !apagadas.has(`${i}:${j}`));
        if (!linhasVivas.length) continue;
        f = { ...f0, geometry: { ...f0.geometry, coordinates: linhasVivas } };
      }
      // calibra em graus (como o mapa) e só então projeta em UTM 22S para medir
      // em metros; com partes ajustadas, cada grupo de linhas vai com a sua matriz
      for (const { geometry, m: k } of pedacosComMatriz(f.geometry, matrizDe, temPartes)) {
        // Um layer pode ter dezenas de milhares de traços. Limita a mensagem
        // enviada ao pooler, mantendo a mesma geometria e a mesma transação.
        const multi = geometry.type === "MultiLineString";
        const quantidade = multi ? geometry.coordinates.length : 1;
        for (let i = 0; i < quantidade; i += 1000) {
          const bloco = multi ? { type: geometry.type, coordinates: geometry.coordinates.slice(i, i + 1000) } : geometry;
          const r = await client.query(
            `insert into _linhas
             select (st_dump(st_transform(st_affine(st_setsrid(st_geomfromgeojson($1), 4326), $2, $3, $4, $5, $6, $7), 31982))).geom`,
            [JSON.stringify(bloco), k.a, k.b, k.d, k.e, k.xoff, k.yoff]);
          linhas += r.rowCount;
        }
      }
    }

    // estica as duas pontas de cada linha aberta e encaixa na grade
    const ponta = (i, j) => `st_setsrid(st_makepoint(
        st_x(st_pointn(geom, ${i})) + (st_x(st_pointn(geom, ${i})) - st_x(st_pointn(geom, ${j}))) / greatest(st_distance(st_pointn(geom, ${i}), st_pointn(geom, ${j})), 0.001) * ${ESTICA_M},
        st_y(st_pointn(geom, ${i})) + (st_y(st_pointn(geom, ${i})) - st_y(st_pointn(geom, ${j}))) / greatest(st_distance(st_pointn(geom, ${i}), st_pointn(geom, ${j})), 0.001) * ${ESTICA_M}), 31982)`;
    await client.query(`create temp table _ext on commit drop as
      select st_snaptogrid(
        case when st_isclosed(geom) or st_npoints(geom) < 2 then geom
             else st_setpoint(st_setpoint(geom, 0, ${ponta(1, 2)}), st_npoints(geom) - 1, ${ponta(-1, -2)}) end,
        ${GRADE_M}) as geom
      from _linhas`);
    await client.query("create index on _ext using gist (geom)");
    await client.query("analyze _ext");
    await client.query("create temp table _faces (geom geometry(Polygon, 31982)) on commit drop");

    // a extensão útil sai da mediana, não do mínimo/máximo: a planta de Iturama
    // tem coordenada corrompida a milhares de quilômetros
    const { rows: [e] } = await client.query(`
      select percentile_cont(0.01) within group (order by st_xmin(geom)) x0, percentile_cont(0.99) within group (order by st_xmax(geom)) x1,
             percentile_cont(0.01) within group (order by st_ymin(geom)) y0, percentile_cont(0.99) within group (order by st_ymax(geom)) y1
      from _ext`);
    const x0 = Number(e.x0) - LADRILHO_M, y0 = Number(e.y0) - LADRILHO_M, x1 = Number(e.x1) + LADRILHO_M, y1 = Number(e.y1) + LADRILHO_M;
    let ladrilhos = 0;
    for (let x = x0; x < x1; x += LADRILHO_M) {
      for (let y = y0; y < y1; y += LADRILHO_M) {
        const r = await client.query(`
          with cel as (select st_makeenvelope($1, $2, $3, $4, 31982) dentro,
                              st_makeenvelope($1 - ${MARGEM_M}, $2 - ${MARGEM_M}, $3 + ${MARGEM_M}, $4 + ${MARGEM_M}, 31982) fora),
          rec as (select st_intersection(l.geom, cel.fora) g from _ext l, cel where l.geom && cel.fora),
          fac as (select (st_dump(st_polygonize(u))).geom from (select st_unaryunion(st_collect(g)) u from rec where not st_isempty(g)) t)
          insert into _faces
          select fac.geom from fac, cel
          where st_area(fac.geom) between ${AREA_MIN} and ${AREA_MAX}
            and st_within(st_pointonsurface(fac.geom), cel.dentro)`, [x, y, x + LADRILHO_M, y + LADRILHO_M]);
        if (r.rowCount) ladrilhos++;
      }
    }
    console.log(`[lotes] ${cam.nome}: faces em ${ladrilhos} ladrilhos de ${LADRILHO_M} m`);

    // Serializa a troca dos lotes com a exclusão individual pelo operador.
    const { rows: [atual] } = await client.query("select * from cartography_layers where id=$1 for update", [cam.id]);
    if (!atual || atual.tiles_path !== cam.tiles_path || assinaturaDe(atual) !== assinaturaDe(cam)) {
      throw new Error("A planta mudou durante a geração. A fila repetirá com os ajustes atuais.");
    }
    const { rows: [schema] } = await client.query("select to_regclass('public.cartografia_lotes_excluidos') as tabela");
    const exclusoes = schema.tabela
      ? await client.query("select lng, lat from cartografia_lotes_excluidos where layer_id=$1", [cam.id])
      : { rows: [] };
    for (const { lng, lat } of exclusoes.rows) {
      const m = matrizDe([lng, lat]);
      const x = m.a * lng + m.b * lat + m.xoff, y = m.d * lng + m.e * lat + m.yoff;
      await client.query(`delete from _faces where st_contains(geom, st_transform(st_setsrid(st_makepoint($1,$2),4326),31982))`, [x, y]);
    }
    await client.query(`create temp table _novos on commit drop as
      with lotes as (
        -- tira os vértices colineares que a poligonização cria em cada cruzamento:
        -- sem isso um lado de 12 m viraria três "lados" de 4 m
        select st_simplifypreservetopology(geom, 0.03) g from _faces
        where 4 * pi() * st_area(geom) / nullif(st_perimeter(geom) ^ 2, 0) > ${COMPACIDADE_MIN}
      )
      select st_transform(g, 4326) geom, st_area(g) area_m2, st_perimeter(g) perimetro_m,
        (select coalesce(jsonb_agg(jsonb_build_object('m', round(st_length(s.geom)::numeric, 2)) order by s.path), '[]'::jsonb)
         from st_dumpsegments(st_exteriorring(g)) s where st_length(s.geom) >= 0.5) lados
      from lotes where st_geometrytype(g) = 'ST_Polygon'`);
    await client.query("create index on _novos using gist(geom)");
    await client.query("analyze _novos");
    // Uma correção local deve manter id e numeração das faces idênticas.
    await client.query(`delete from urban_lots u where layer_id=$1 and not exists
      (select 1 from _novos n where n.geom && u.geom and st_equals(n.geom,u.geom))`, [cam.id]);
    await client.query(`insert into urban_lots(layer_id,municipality_id,geom,area_m2,perimetro_m,lados)
      select $1,$2,n.geom,n.area_m2,n.perimetro_m,n.lados from _novos n where not exists
      (select 1 from urban_lots u where u.layer_id=$1 and u.geom && n.geom and st_equals(n.geom,u.geom))`, [cam.id,cam.municipality_id]);
    const { rows: [{ total }] } = await client.query("select count(*)::int total from urban_lots where layer_id=$1", [cam.id]);

    await client.query(
      "update cartography_layers set lotes_total = $2, lotes_gerados_em = now(), lotes_assinatura = $3 where id = $1",
      [cam.id, total, assinaturaDe(cam)]);
    await client.query("commit");
    console.log(`[lotes] ${cam.nome}: ${linhas} linhas → ${total} lotes`);

    // os lotes antigos sumiram: cada anúncio de lote é encaixado no equivalente
    // da planta nova (migration 0053); o que não casar vai para o admin conferir
    const { rows: [re] } = await client.query("select fn_reencaixar_anuncios($1) r", [cam.id]);
    console.log(`[lotes] ${cam.nome}: reencaixe ${JSON.stringify(re.r)}`);
    return { planta: cam.nome, linhas, lotes: total, reencaixe: re.r };
  } catch (e) {
    await client.query("rollback").catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}
