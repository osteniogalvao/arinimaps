// Ajuste por parte da planta, em JS puro para o worker e os scripts.
// É a MESMA conta de src/lib/geo/deslocar.ts (afim, compor, partes): se as duas
// divergirem, o lote clicável sai deslocado da linha que o usuário vê.

/** Coeficientes de ST_Affine para a similaridade em torno de `centro`. t = {dx, dy, rot, esc}. */
export function afim(centro, t) {
  const [cx, cy] = centro;
  const kx = 111_320 * Math.cos((cy * Math.PI) / 180), ky = 110_540;
  const rad = (t.rot * Math.PI) / 180, cos = Math.cos(rad), sen = Math.sin(rad), s = t.esc || 1;
  const a = s * cos, b = (-s * sen * ky) / kx, d = (s * sen * kx) / ky, e = s * cos;
  return { a, b, d, e, xoff: cx - a * cx - b * cy + t.dx / kx, yoff: cy - d * cx - e * cy + t.dy / ky };
}

/** m2 ∘ m1 */
export function compor(m2, m1) {
  return {
    a: m2.a * m1.a + m2.b * m1.d,
    b: m2.a * m1.b + m2.b * m1.e,
    d: m2.d * m1.a + m2.e * m1.d,
    e: m2.d * m1.b + m2.e * m1.e,
    xoff: m2.a * m1.xoff + m2.b * m1.yoff + m2.xoff,
    yoff: m2.d * m1.xoff + m2.e * m1.yoff + m2.yoff,
  };
}

export function centroArea(area) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of area) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return [(x0 + x1) / 2, (y0 + y1) / 2];
}

export function pontoNaArea(p, area) {
  let dentro = false;
  for (let i = 0, j = area.length - 1; i < area.length; j = i++) {
    const [xi, yi] = area[i], [xj, yj] = area[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) dentro = !dentro;
  }
  return dentro;
}

export function centroGeometria(coords) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const olhar = (c) => {
    if (Array.isArray(c) && typeof c[0] === "number" && typeof c[1] === "number") {
      if (c[0] < x0) x0 = c[0]; if (c[0] > x1) x1 = c[0]; if (c[1] < y0) y0 = c[1]; if (c[1] > y1) y1 = c[1];
      return;
    }
    if (Array.isArray(c)) for (const v of c) olhar(v);
  };
  olhar(coords);
  return x0 > x1 ? null : [(x0 + x1) / 2, (y0 + y1) / 2];
}

/**
 * Escolhe a matriz de cada ponto/linha: a da parte que contém o centro, ou a
 * da planta. `ajustes` vem de cartography_layers.ajustes_locais.
 */
export function seletorDeMatriz(centroPlanta, global, ajustes) {
  const g = afim(centroPlanta, global);
  const partes = (ajustes ?? []).map((a) => ({
    area: a.area,
    m: compor(g, afim(centroArea(a.area), { dx: a.t.offsetLesteM, dy: a.t.offsetNorteM, rot: a.t.rotacaoGraus, esc: a.t.escala || 1 })),
  }));
  return (centro) => {
    if (centro) for (const p of partes) if (pontoNaArea(centro, p.area)) return p.m;
    return g;
  };
}

/**
 * Pedaços de uma geometria com a matriz de cada um. O DXF convertido chega como
 * UMA MultiLineString por camada do CAD, então a parte é decidida LINHA A
 * LINHA (como em src/lib/geo/deslocar.ts): as linhas de cada parte saem
 * juntas, numa MultiLineString só, com a matriz daquela parte.
 */
export function pedacosComMatriz(geometry, matrizDe, temPartes) {
  if (!temPartes || geometry.type !== "MultiLineString") {
    return [{ geometry, m: matrizDe(centroGeometria(geometry.coordinates)) }];
  }
  const grupos = new Map();
  for (const linha of geometry.coordinates) {
    const m = matrizDe(centroGeometria(linha));
    if (!grupos.has(m)) grupos.set(m, []);
    grupos.get(m).push(linha);
  }
  return [...grupos].map(([m, linhas]) => ({ geometry: { type: "MultiLineString", coordinates: linhas }, m }));
}

/** Igual a assinaturaAjustes() de src/lib/geo/deslocar.ts. */
export function assinaturaAjustes(ajustes) {
  if (!ajustes?.length) return "";
  const r = (n) => Math.round(n * 1e4) / 1e4;
  const esc = (a) => (a.t.escala && Math.abs(a.t.escala - 1) > 1e-9 ? `,x${r(a.t.escala)}` : "");
  return ";aj:" + ajustes.map((a) => `${a.id}=${r(a.t.offsetLesteM)},${r(a.t.offsetNorteM)},${r(a.t.rotacaoGraus)}${esc(a)}`).join("|");
}

/** Espelho de assinaturaExclusoes (src/lib/geo/deslocar.ts): linhas apagadas na calibração. */
export function assinaturaExclusoes(excluidas) {
  if (!excluidas?.length) return "";
  const s = [...excluidas].sort().join(",");
  let h = 5381;
  for (let k = 0; k < s.length; k++) h = ((h * 33) ^ s.charCodeAt(k)) >>> 0;
  return `;ex:${excluidas.length}-${h.toString(36)}`;
}

/** Aplica somente as polilinhas corrigidas manualmente sobre o arquivo bruto. */
export function aplicarEdicoes(fc, edicoes = []) {
  for (const e of edicoes ?? []) {
    if (e.criar && e.feature === fc.features.length && e.linha === 0 && e.coordinates?.length >= 4) {
      fc.features.push({ type: "Feature", properties: { layer: "Desenho manual" }, geometry: { type: "LineString", coordinates: e.coordinates } });
      continue;
    }
    const g = fc.features?.[e.feature]?.geometry;
    if (g?.type === "MultiLineString" && g.coordinates[e.linha] && e.coordinates?.length >= 2) {
      g.coordinates[e.linha] = e.coordinates;
      // pedaços de uma linha dividida entram no fim (ver EdicaoGeometria em deslocar.ts)
      for (const x of e.extras ?? []) if (x?.length >= 2) g.coordinates.push(x);
    }
    else if (g?.type === "LineString" && e.linha === 0 && e.coordinates?.length >= 2) {
        if (e.extras?.length) fc.features[e.feature].geometry = { type: "MultiLineString", coordinates: [e.coordinates, ...e.extras] };
        else g.coordinates = e.coordinates;
      }
  }
  return fc;
}

export function assinaturaEdicoes(edicoes = []) {
  if (!edicoes?.length) return "";
  let h = 2166136261;
  const pts = (c) => c.map((p) => `${Number(p[0]).toFixed(7)},${Number(p[1]).toFixed(7)}`).join(";");
  const texto = edicoes.map((e) => `${e.criar ? "novo:" : ""}${e.feature}:${e.linha}:${pts(e.coordinates)}${(e.extras ?? []).map((x) => `+${pts(x)}`).join("")}`).join("|");
  for (let i = 0; i < texto.length; i++) h = Math.imul(h ^ texto.charCodeAt(i), 16777619);
  return `;ed:${(h >>> 0).toString(36)}`;
}
