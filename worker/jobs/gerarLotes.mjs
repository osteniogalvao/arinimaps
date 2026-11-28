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

// BOLA DA QUADRA. Áudio do Carlos (28/11/2026, 09h03): em Iturama os lotes de
// 12 × 20 (240 m² na matrícula) saíam com 230 m² e outros com 30 a 40 m² a
// menos. O número da quadra é escrito dentro de um círculo desenhado no meio
// da quadra; o círculo entrava na poligonização como divisa, cortava um
// pedaço dos lotes do miolo e deixava furo onde caía inteiro dentro de um. O
// círculo pequeno (até 8 m de raio) é rótulo, não divisa: sai das linhas, e o
// texto dentro dele é o número da quadra.
const RAIO_ROTULO_MAX_M = 8;

/** Anel fechado com muitos vértices à mesma distância do centro e raio de rótulo. */
export function circuloDeRotulo(linha) {
  const n = linha.length;
  if (n < 20) return null;
  const [x0, y0] = linha[0], [x1, y1] = linha[n - 1];
  let cx = 0, cy = 0;
  for (let i = 0; i < n - 1; i++) { cx += linha[i][0]; cy += linha[i][1]; }
  cx /= n - 1; cy /= n - 1;
  const kx = 111_320 * Math.cos((cy * Math.PI) / 180), ky = 110_540;
  if (Math.hypot((x1 - x0) * kx, (y1 - y0) * ky) > 0.05) return null;
  let soma = 0, min = Infinity, max = 0;
  for (let i = 0; i < n - 1; i++) {
    const r = Math.hypot((linha[i][0] - cx) * kx, (linha[i][1] - cy) * ky);
    soma += r; if (r < min) min = r; if (r > max) max = r;
  }
  const r = soma / (n - 1);
  if (r < 0.3 || r > RAIO_ROTULO_MAX_M || (max - min) > 0.06 * r) return null;
  return { c: [cx, cy], r };
}

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
  // Conexão em uso derrubada pelo banco: a query em andamento já rejeita; o
  // ouvinte só impede que o 'error' do client derrube o worker.
  const aoCair = (e) => console.error("[lotes] conexão caiu:", e.message);
  client.on("error", aoCair);
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
    const circulos = [];

    await client.query("begin");
    await client.query("set local statement_timeout = '5min'");
    await client.query("create temp table _linhas (geom geometry(LineString, 31982)) on commit drop");
    let linhas = 0;
    for (const [i, f0] of fc.features.entries()) {
      if (ocultos.has(String(f0.properties?.layer ?? "")) || !f0.geometry || apagadas.has(String(i))) continue;
      let f = f0;
      if (f0.geometry.type === "MultiLineString") {
        const linhasVivas = f0.geometry.coordinates.filter((linha, j) => {
          if (apagadas.has(`${i}:${j}`)) return false;
          const circ = circuloDeRotulo(linha);
          if (circ) { circulos.push(circ); return false; }
          return true;
        });
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
        -- sem isso um lado de 12 m viraria três "lados" de 4 m. O lote é o
        -- contorno externo: furo deixado por texto ou símbolo dentro dele não
        -- desconta área (28/11/2026)
        select st_makepolygon(st_exteriorring(st_simplifypreservetopology(geom, 0.03))) g from _faces
        where 4 * pi() * st_area(geom) / nullif(st_perimeter(geom) ^ 2, 0) > ${COMPACIDADE_MIN}
          and st_geometrytype(st_simplifypreservetopology(geom, 0.03)) = 'ST_Polygon'
      )
      select row_number() over () nid, st_transform(g, 4326) geom, st_area(g) area_m2, st_perimeter(g) perimetro_m,
        (select coalesce(jsonb_agg(jsonb_build_object('m', round(st_length(s.geom)::numeric, 2)) order by s.path), '[]'::jsonb)
         from st_dumpsegments(st_exteriorring(g)) s where st_length(s.geom) >= 0.5) lados
      from lotes where st_geometrytype(g) = 'ST_Polygon'`);
    await client.query("create index on _novos using gist(geom)");
    await client.query("analyze _novos");

    // MEDIDA DO DESENHO, NÃO DA CALIBRAÇÃO (28/11/2026). A face é medida na
    // posição calibrada; com escala na planta ou numa peça encaixada (ex.:
    // 97,9%), 240 m² viravam 230. A planta do CAD está em metros de verdade:
    // a escala da calibração é só para casar com o satélite. Desfaz o fator
    // da matriz em que o lote caiu (det = escala²).
    const { rows: centros } = await client.query(
      "select nid, st_x(p) x, st_y(p) y from (select nid, st_pointonsurface(geom) p from _novos) s");
    const nids = [], fatores = [];
    for (const { nid, x, y } of centros) {
      const k = matrizDe([Number(x), Number(y)]);
      const det = Math.abs(k.a * k.e - k.b * k.d);
      if (det > 0 && Math.abs(det - 1) > 1e-6) { nids.push(nid); fatores.push(det); }
    }
    for (let i = 0; i < nids.length; i += 5000) {
      await client.query(`
        update _novos n set area_m2 = n.area_m2 / f.det, perimetro_m = n.perimetro_m / sqrt(f.det),
          lados = (select coalesce(jsonb_agg(jsonb_build_object('m', round(((e.v->>'m')::float8 / sqrt(f.det))::numeric, 2)) order by e.o), '[]'::jsonb)
                   from jsonb_array_elements(n.lados) with ordinality e(v, o))
        from unnest($1::bigint[], $2::float8[]) f(nid, det) where n.nid = f.nid`,
        [nids.slice(i, i + 5000), fatores.slice(i, i + 5000)]);
    }
    const { rows: [colArea] } = await client.query(
      "select exists(select 1 from information_schema.columns where table_schema='public' and table_name='urban_lots' and column_name='area_texto_m2') tem");
    // Uma correção local deve manter id e numeração das faces idênticas.
    await client.query(`delete from urban_lots u where layer_id=$1 and not exists
      (select 1 from _novos n where n.geom && u.geom and st_equals(n.geom,u.geom))`, [cam.id]);
    await client.query(`insert into urban_lots(layer_id,municipality_id,geom,area_m2,perimetro_m,lados)
      select $1,$2,n.geom,n.area_m2,n.perimetro_m,n.lados from _novos n where not exists
      (select 1 from urban_lots u where u.layer_id=$1 and u.geom && n.geom and st_equals(n.geom,u.geom))`, [cam.id,cam.municipality_id]);
    // o lote que ficou com o mesmo id também passa a ter a medida do desenho
    await client.query(`update urban_lots u set area_m2 = ${colArea.tem ? "coalesce(u.area_texto_m2, n.area_m2)" : "n.area_m2"},
        perimetro_m = n.perimetro_m, lados = n.lados
      from _novos n where u.layer_id=$1 and u.geom && n.geom and st_equals(n.geom,u.geom)`, [cam.id]);
    const numeracao = await numerarPelosTextos(client, base, cam, matrizDe, circulos, colArea.tem);
    if (numeracao) console.log(`[lotes] ${cam.nome}: textos do DXF ${JSON.stringify(numeracao)}`);
    // número de quadra posto à mão na calibração (migration 0174): reaplica a
    // partir da âncora no desenho original; a última âncora da quadra vence
    const { rows: [tabQuadras] } = await client.query("select to_regclass('public.cartografia_quadras_manuais') as tabela");
    if (tabQuadras.tabela) {
      const { rows: ancoras } = await client.query(
        "select quadra, lng, lat from cartografia_quadras_manuais where layer_id=$1 order by criado_em, id", [cam.id]);
      for (const { quadra, lng, lat } of ancoras) {
        const m = matrizDe([lng, lat]);
        const x = m.a * lng + m.b * lat + m.xoff, y = m.d * lng + m.e * lat + m.yoff;
        // a matriz devolve graus (como na exclusão de lote acima)
        await client.query("select fn_numerar_quadra($1, $2, $3, $4)", [cam.id, x, y, quadra]);
      }
    }
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
    return { planta: cam.nome, linhas, lotes: total, numeracao, reencaixe: re.r };
  } catch (e) {
    await client.query("rollback").catch(() => undefined);
    throw e;
  } finally {
    client.off("error", aoCair);
    client.release();
  }
}

/**
 * Quadra, número e área oficial de cada lote, a partir dos textos do DXF
 * guardados no envio da planta (src/lib/cartografia/textosPlanta.ts). Mesma
 * heurística de scripts/numera-lotes.mjs, agora dentro da fila: cada geração
 * de lotes numera de novo, e a recalibração não apaga mais os números.
 * Sem o arquivo de textos (planta antiga), não mexe em nada.
 */
export async function numerarPelosTextos(client, base, cam, matrizDe, circulos, temColArea) {
  const r = await fetch(`${base}/storage/v1/object/public/media/cartografia/textos/${cam.id}.json`, { signal: AbortSignal.timeout(60_000) })
    .catch(() => null);
  if (!r?.ok) return null;
  const arq = await r.json().catch(() => null);
  const textos = Array.isArray(arq?.textos) ? arq.textos : [];
  if (!textos.length) return null;

  // texto e círculo seguem a parte ajustada em que caem, como as linhas
  const calibrar = ([lng, lat]) => {
    const k = matrizDe([lng, lat]);
    return [k.a * lng + k.b * lat + k.xoff, k.d * lng + k.e * lat + k.yoff];
  };
  const tok = [], tipo = [], alt = [], val = [], xs = [], ys = [];
  for (const t of textos) {
    if (!Array.isArray(t?.c) || !["q", "n", "l", "a"].includes(t.k)) continue;
    const [x, y] = calibrar(t.c);
    tok.push(String(t.t).slice(0, 40)); tipo.push(t.k); alt.push(Number(t.h) || 0); val.push(t.v ?? null); xs.push(x); ys.push(y);
  }
  await client.query(`create temp table _t (id serial primary key, tok text, tipo text, h numeric, v numeric, g geometry(Point, 31982)) on commit drop`);
  for (let i = 0; i < tok.length; i += 5000) {
    const sl = (a) => a.slice(i, i + 5000);
    await client.query(`insert into _t (tok, tipo, h, v, g)
      select tok, tipo, h, v, st_transform(st_setsrid(st_makepoint(x, y), 4326), 31982)
      from unnest($1::text[], $2::text[], $3::numeric[], $4::numeric[], $5::float8[], $6::float8[]) u(tok, tipo, h, v, x, y)`,
      [sl(tok), sl(tipo), sl(alt), sl(val), sl(xs), sl(ys)]);
  }
  await client.query("create index on _t using gist (g)");
  // número ou letra dentro da bola da quadra = rótulo da quadra
  if (circulos.length) {
    const cx = [], cy = [], cr = [];
    for (const c of circulos) { const [x, y] = calibrar(c.c); cx.push(x); cy.push(y); cr.push(c.r); }
    await client.query(`create temp table _circ on commit drop as
      select st_transform(st_setsrid(st_makepoint(x, y), 4326), 31982) g, r
      from unnest($1::float8[], $2::float8[], $3::float8[]) u(x, y, r)`, [cx, cy, cr]);
    await client.query("create index on _circ using gist (g)");
    await client.query(`update _t t set tipo = 'q' where t.tipo in ('n', 'l')
      and exists (select 1 from _circ c where st_dwithin(t.g, c.g, c.r * 1.1))`);
  }
  await client.query("analyze _t");

  await client.query(`create temp table _l on commit drop as
    select id, g, st_pointonsurface(g) p, st_clusterdbscan(g, 1.0, 1) over () cid
    from (select id, st_transform(geom, 31982) g from urban_lots where layer_id = $1) s`, [cam.id]);
  await client.query("create index on _l using gist (g)");
  await client.query("create temp table _q on commit drop as select cid, st_convexhull(st_collect(g)) hull, count(*) n from _l group by cid");
  await client.query("create index on _q using gist (hull)");
  await client.query(`create temp table _tl on commit drop as
    select t.*, (select l.id from _l l where st_contains(l.g, t.g) limit 1) lote_id,
           (select q.cid from _q q where st_contains(q.hull, t.g) order by st_area(q.hull) limit 1) cid
    from _t t`);
  await client.query(`create temp table _hq on commit drop as
    select l.cid, mode() within group (order by round(t.h, 2)) h_lote, count(*) n
    from _tl t join _l l on l.id = t.lote_id where t.tipo = 'n' group by l.cid`);
  await client.query(`create temp table _rq on commit drop as
    select t.id, t.cid, t.tok, t.h, t.g, t.tipo = 'q' explicita
    from _tl t left join _hq hq on hq.cid = t.cid
    where t.cid is not null and t.tipo <> 'a' and (t.tipo = 'q' or (t.h <= 15 and t.h >= coalesce(hq.h_lote * 1.3, 3.0)))`);
  await client.query(`delete from _rq r using (select cid, bool_or(explicita) tem_expl, max(h) hmax from _rq group by cid) m
    where r.cid = m.cid and ((m.tem_expl and not r.explicita) or (not m.tem_expl and r.h < 0.85 * m.hmax))`);

  await client.query("update urban_lots set numero = null, quadra = null where layer_id = $1", [cam.id]);
  const num = await client.query(`
    with cand as (
      select t.lote_id, t.tok, st_distance(t.g, l.p) d
      from _tl t join _l l on l.id = t.lote_id left join _hq hq on hq.cid = l.cid
      where t.tipo = 'n' and t.id not in (select id from _rq)
        and (hq.h_lote is null or abs(t.h - hq.h_lote) <= 0.15 * hq.h_lote)
    ), por_lote as (
      select lote_id, count(distinct tok) distintos, (array_agg(tok order by d))[1] tok from cand group by lote_id
    )
    update urban_lots u set numero = p.tok from por_lote p where u.id = p.lote_id and p.distintos = 1`);
  const qd = await client.query(`
    update urban_lots u set quadra = s.tok
    from (select distinct on (l.id) l.id, r.tok from _l l join _rq r on r.cid = l.cid order by l.id, st_distance(r.g, l.p)) s
    where u.id = s.id`);

  // área escrita dentro do lote ("240,00 m²"): vale a da planta oficial, se
  // estiver a até 25% do que o desenho mede (texto do vizinho não entra)
  let areas = 0;
  if (temColArea) await client.query("update urban_lots set area_texto_m2 = null where layer_id = $1", [cam.id]);
  const ar = await client.query(`
    with cand as (
      select t.lote_id, count(distinct t.v) distintos, min(t.v) v from _tl t where t.tipo = 'a' and t.lote_id is not null group by t.lote_id
    )
    update urban_lots u set area_m2 = c.v${temColArea ? ", area_texto_m2 = c.v" : ""}
    from cand c where u.id = c.lote_id and c.distintos = 1 and abs(u.area_m2 - c.v) <= 0.25 * c.v`);
  areas = ar.rowCount;
  return { textos: tok.length, circulos: circulos.length, com_numero: num.rowCount, com_quadra: qd.rowCount, area_escrita: areas };
}
