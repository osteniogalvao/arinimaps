type Ponto = [number, number];
type Peca = { nomeCad: string; area: Ponto[] };
export const normalizarCad = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
export function termosDescricaoCad(busca: string) {
  const palavras = normalizarCad(busca).split(" ");
  const comando = /^(?:apagar|remover|excluir|selecionar|ocultar|esconder)$/;
  if (comando.test(palavras[0])) {
    palavras.shift();
    while (palavras.length && /^(?:todas?|todos?|as?|os?|linhas?|camadas?|d[aeo]s?|com|descricao)$/.test(palavras[0])) palavras.shift();
  }
  return palavras.filter(Boolean).map(p => p.length > 3 ? p.replace(/s$/, "") : p);
}
const chave = ([x, y]: number[]) => `${Math.round(x * 1e6)},${Math.round(y * 1e6)}`;

/** Fecho convexo das linhas conectadas, quando o DXF veio em segmentos soltos. */
export function contornoConvexo(pts: Ponto[]): Ponto[] {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const metade = (lista: Ponto[]) => {
    const v: Ponto[] = [];
    for (const q of lista) {
      while (v.length >= 2) {
        const a = v.at(-2)!, b = v.at(-1)!;
        if ((b[0]-a[0])*(q[1]-a[1]) - (b[1]-a[1])*(q[0]-a[0]) > 0) break;
        v.pop();
      }
      v.push(q);
    }
    return v.slice(0, -1);
  };
  return [...metade(p), ...metade(p.reverse())];
}

export function detectarBlocosCad(fc: GeoJSON.FeatureCollection, ocultos: Set<string>, excluidas: Set<string>, naVista: (p: Ponto) => boolean) {
  const quadras: Peca[] = [], linhas: { pontos: Ponto[]; nome: string }[] = [];
  fc.features.forEach((f, i) => {
    const nome = String(f.properties?.layer || f.properties?.nome || "CAD");
    const camada = normalizarCad(nome);
    if (ocultos.has(nome) || /arruamento|paisag|veget|area verde|meio fio|canteiro|eixo|texto|cota|logradouro|via publica/.test(camada)) return;
    const g = f.geometry;
    const ls = g.type === "MultiLineString" ? g.coordinates : g.type === "LineString" ? [g.coordinates] :
      g.type === "Polygon" ? [g.coordinates[0]] : [];
    ls.forEach((coords, j) => {
      if (coords.length < 2 || excluidas.has(g.type === "MultiLineString" ? `${i}:${j}` : String(i))) return;
      const pts = coords as Ponto[];
      if (!pts.every(naVista)) return;
      const fechada = pts.length >= 4 && chave(pts[0]) === chave(pts.at(-1)!);
      if (fechada && /quadra|bloco|(?:^| )qd(?:r|s)?(?: |$)/.test(camada)) {
        quadras.push({ nomeCad: nome, area: pts.slice(0, -1) });
      } else linhas.push({ pontos: pts, nome });
    });
  });
  // Une os trechos que partilham vértices; ruas separam componentes de lotes.
  const raiz = linhas.map((_, i) => i);
  const dono = new Map<string, number>();
  function achar(i: number): number {
    while (raiz[i] !== i) { raiz[i] = raiz[raiz[i]]; i = raiz[i]; }
    return i;
  }
  linhas.forEach(({ pontos }, i) => {
    for (const p of pontos) {
      const k = chave(p), anterior = dono.get(k);
      if (anterior === undefined) dono.set(k, i);
      else raiz[achar(i)] = achar(anterior);
    }
  });
  const grupos = new Map<number, { nomeCad: string; pontos: Ponto[]; linhas: number }>();
  linhas.forEach(({ pontos, nome }, i) => {
    const k = achar(i), grupo = grupos.get(k) ?? { nomeCad: nome, pontos: [], linhas: 0 };
    grupo.linhas++;
    for (const p of pontos) grupo.pontos.push(p);
    grupos.set(k, grupo);
  });
  for (const grupo of grupos.values()) {
    const fechada = grupo.pontos.length >= 4 && chave(grupo.pontos[0]) === chave(grupo.pontos.at(-1)!);
    if (grupo.linhas < 2 && !fechada) continue;
    const area = grupo.linhas === 1 && fechada ? grupo.pontos.slice(0, -1) : contornoConvexo(grupo.pontos);
    if (area.length >= 3) quadras.push({ nomeCad: grupo.nomeCad, area });
  }
  return quadras;
}
