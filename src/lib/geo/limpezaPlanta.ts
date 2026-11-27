/**
 * Limpeza automática da planta na calibração.
 *
 * Vídeo do Carlos (26/11/2026, zona rural de Iturama): "linha desnecessária,
 * linha desnecessária... rodovias... ela mesma poderia filtrar, que sobrasse o
 * mínimo". Duas peneiras, as duas só PROPÕEM (nada some sem o operador ver):
 *
 *  1. camadas que não são cadastro, pelo nome (vegetação, textos, cotas, grid,
 *     defpoints...): viram camadas ocultas, que se religam com um clique;
 *  2. linhas soltas, pela geometria: linha cujo trajeto passa quase todo por
 *     lugar vazio (círculo de raio, perímetro urbano, risco no pasto). Vão
 *     para a seleção, para o operador conferir e apagar.
 *
 * A peneira 2 existe porque o lixo de verdade mora na camada "0" (Iturama: 104
 * mil linhas nela), onde o nome não ajuda.
 */

/** Camadas que não são quadra, lote, rua nem divisa. */
export const CAMADA_NAO_CADASTRO =
  /paisag|veget|jardin|arvor|árvor|forra|tronco|legend|texto|cota|dim\b|dim[-_ ]|hach|quaresm|acerola|amora|pau.?brasil|ip[eê]\b|palmeir|grama|piso|tátil|tatil|simbol|símbol|carimbo|coco|defpoints|\bgrid\b|azimute|seta|lou[cç]a|mobili/i;

/**
 * Linhas paralelas do arruamento (áudio do Carlos, 26/11/2026, 21h58: "ruamentos
 * paralelos, linhas paralelas... deixar o que realmente é essencial"): guia,
 * meio-fio, calçada, sarjeta, eixo e canteiro correm junto da frente da quadra
 * e embolam o desenho. Para o cadastro basta a quadra e o lote.
 */
export const CAMADA_ARRUAMENTO = /guia|meio.?fio|cal[cç]ada|sarjeta|arruament|\beixo|canteiro|ciclovia|pista|passeio|alinhamento predial|meio fio/i;

export function camadasNaoCadastro(nomes: string[], tirarArruamento = true): string[] {
  return nomes.filter((n) => CAMADA_NAO_CADASTRO.test(n) || (tirarArruamento && CAMADA_ARRUAMENTO.test(n)));
}

export type LinhaChave = { chave: string; coords: number[][] };

/**
 * Chaves das linhas soltas. Divide o terreno em células de `celulaM` metros e
 * conta quantas linhas passam por cada uma; a linha é solta quando mais de
 * `fracaoVazia` das células que ela atravessa têm menos de `vizinhas` outras
 * linhas. Medido em Iturama (26/11/2026): de 110 mil linhas sobraram 21 — o
 * círculo de 6 km, o perímetro urbano e riscos isolados; nenhuma quadra.
 */
export function linhasSoltas(linhas: LinhaChave[], celulaM = 100, vizinhas = 3, fracaoVazia = 0.6): string[] {
  if (!linhas.length) return [];
  let cy = 0, n = 0;
  for (const l of linhas) if (l.coords[0]) { cy += l.coords[0][1]; n++; if (n > 200) break; }
  cy /= Math.max(1, n);
  const kx = 111_320 * Math.cos((cy * Math.PI) / 180), ky = 110_540;
  const celulasDe = (coords: number[][]) => {
    const out = new Set<string>();
    for (let i = 0; i + 1 < coords.length; i++) {
      const x0 = coords[i][0] * kx, y0 = coords[i][1] * ky, x1 = coords[i + 1][0] * kx, y1 = coords[i + 1][1] * ky;
      const passos = Math.min(5000, Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / (celulaM / 2))));
      for (let k = 0; k <= passos; k++) {
        const t = k / passos;
        out.add(Math.floor((x0 + t * (x1 - x0)) / celulaM) + "," + Math.floor((y0 + t * (y1 - y0)) / celulaM));
      }
    }
    return out;
  };
  const porLinha = linhas.map((l) => celulasDe(l.coords));
  const conta = new Map<string, number>();
  for (const s of porLinha) for (const c of s) conta.set(c, (conta.get(c) ?? 0) + 1);
  const soltas: string[] = [];
  porLinha.forEach((s, i) => {
    if (!s.size) return;
    let vazias = 0;
    for (const c of s) if ((conta.get(c) ?? 1) - 1 < vizinhas) vazias++;
    if (vazias / s.size > fracaoVazia) soltas.push(linhas[i].chave);
  });
  return soltas;
}
