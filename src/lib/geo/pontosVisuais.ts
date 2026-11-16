type Pixel = [number, number];
export type ParVisual = { planta: Pixel; satelite: Pixel };

/** Encontra cantos com gradiente nas duas direções (Shi–Tomasi). A votação por
 * deslocamento rejeita cantos isolados de telhados e vegetação. As sugestões
 * servem como pontos de controle que o operador confere antes de aplicar. */
export function sugerirParesVisuais(
  imagem: Pick<ImageData, "data" | "width" | "height">, vertices: Pixel[],
): ParVisual[] {
  const { width, height, data } = imagem;
  const cinza = new Uint8Array(width * height);
  for (let i = 0; i < cinza.length; i++) cinza[i] = (data[i*4]*77 + data[i*4+1]*150 + data[i*4+2]*29) >> 8;
  const raio = 22, margem = raio + 3;
  const pontuacoes = new Float32Array(width * height);
  const canto = (x: number, y: number) => {
    const p = y * width + x;
    if (pontuacoes[p]) return pontuacoes[p];
    let xx = 0, yy = 0, xy = 0;
    for (let j = -2; j <= 2; j++) for (let i = -2; i <= 2; i++) {
      const k = p + j * width + i, gx = cinza[k+1] - cinza[k-1], gy = cinza[k+width] - cinza[k-width];
      xx += gx * gx; yy += gy * gy; xy += gx * gy;
    }
    return pontuacoes[p] = Math.max(-1, (xx + yy - Math.hypot(xx - yy, 2 * xy)) / 50) || -1;
  };
  const candidatos: { planta: Pixel; satelite: Pixel; dx: number; dy: number; forca: number }[] = [];
  const celulas = new Set<string>();
  for (const planta of vertices) {
    const [x, y] = planta.map(Math.round);
    if (x < margem || y < margem || x >= width - margem || y >= height - margem) continue;
    const celula = Math.floor(x/32) + "," + Math.floor(y/32);
    if (celulas.has(celula)) continue;
    celulas.add(celula);
    let melhor = 0, destino: Pixel = [x, y];
    for (let dy = -raio; dy <= raio; dy++) for (let dx = -raio; dx <= raio; dx++) {
      const dist = Math.hypot(dx, dy);
      if (dist > raio) continue;
      const poder = canto(x+dx, y+dy) / (1 + .025 * dist);
      if (poder > melhor) { melhor = poder; destino = [x+dx, y+dy]; }
    }
    if (melhor >= 100) candidatos.push({ planta, satelite:destino, dx:destino[0]-planta[0], dy:destino[1]-planta[1], forca:melhor });
  }
  const compativeis = (a: typeof candidatos[number]) => candidatos.filter(b => Math.hypot(a.dx-b.dx, a.dy-b.dy) <= 4);
  let melhores: typeof candidatos = [];
  for (const candidato of candidatos) {
    const vizinhos = compativeis(candidato);
    if (vizinhos.length > melhores.length) melhores = vizinhos;
  }
  if (melhores.length < 3 || melhores.length < candidatos.length * .35) return [];
  const pares: ParVisual[] = [];
  for (const candidato of melhores.sort((a,b)=>b.forca-a.forca)) {
    if (pares.every(p=>Math.hypot(p.planta[0]-candidato.planta[0],p.planta[1]-candidato.planta[1])>=42)) {
      pares.push({ planta:candidato.planta, satelite:candidato.satelite });
    }
    if (pares.length === 4) break;
  }
  return pares.length >= 3 ? pares : [];
}
