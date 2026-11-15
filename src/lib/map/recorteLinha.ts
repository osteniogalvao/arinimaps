/** Corta segmentos nas interseções com todos os anéis e testa o meio dos trechos
 * resultantes. Funciona tanto em coordenadas geográficas como em pixels de um tile. */
export function recortarLinha(linha: number[][], areas: number[][][][]): number[][][] {
  const dentro = (x: number, y: number) =>
    areas.some((aneis) => {
      let interior = false;
      for (const anel of aneis) {
        for (let i = 1; i < anel.length; i++) {
          const [ax, ay] = anel[i - 1],
            [bx, by] = anel[i];
          const comprimento = Math.abs(bx - ax) + Math.abs(by - ay);
          if (
            comprimento > 0 &&
            Math.abs((x - ax) * (by - ay) - (y - ay) * (bx - ax)) <= comprimento * 1e-11 &&
            x >= Math.min(ax, bx) - 1e-11 &&
            x <= Math.max(ax, bx) + 1e-11 &&
            y >= Math.min(ay, by) - 1e-11 &&
            y <= Math.max(ay, by) + 1e-11
          )
            return true;
          if (ay > y !== by > y && x < ax + ((bx - ax) * (y - ay)) / (by - ay)) interior = !interior;
        }
      }
      return interior;
    });
  const partes: number[][][] = [];
  let atual: number[][] = [];
  for (let i = 1; i < linha.length; i++) {
    const [x, y] = linha[i - 1],
      dx = linha[i][0] - x,
      dy = linha[i][1] - y;
    if (!dx && !dy) continue;
    const cortes = [0, 1];
    for (const aneis of areas)
      for (const anel of aneis)
        for (let j = 1; j < anel.length; j++) {
          const [ax, ay] = anel[j - 1];
          const sx = anel[j][0] - ax,
            sy = anel[j][1] - ay;
          const den = dx * sy - dy * sx;
          if (!den) continue;
          const t = ((ax - x) * sy - (ay - y) * sx) / den,
            u = ((ax - x) * dy - (ay - y) * dx) / den;
          if (t > 0 && t < 1 && u >= 0 && u <= 1) cortes.push(t);
        }
    cortes.sort((a, b) => a - b);
    for (let j = 1; j < cortes.length; j++) {
      const a = cortes[j - 1],
        b = cortes[j],
        meio = (a + b) / 2;
      if (b - a < 1e-10) continue;
      if (dentro(x + dx * meio, y + dy * meio)) {
        if (!atual.length) atual.push([x + dx * a, y + dy * a]);
        atual.push([x + dx * b, y + dy * b]);
      } else if (atual.length) {
        partes.push(atual);
        atual = [];
      }
    }
  }
  if (atual.length) partes.push(atual);
  return partes;
}
