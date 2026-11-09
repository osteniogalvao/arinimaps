/**
 * Área de um polígono [lng, lat] em m², com a mesma fórmula do turf.area
 * (excesso esférico de Chamberlain & Duquette, raio médio 6.371.008,8 m), para
 * o número das ferramentas do mapa continuar idêntico ao de antes — sem baixar
 * o @turf/turf inteiro (516 KB) no navegador só para isso.
 * Distância: use `distanciaM` de ./distancia (haversine, também igual ao turf).
 */

const FATOR = (6_371_008.8 * 6_371_008.8) / 2;
const RAD = Math.PI / 180;

/** Área (com sinal) de um anel fechado (primeiro ponto repetido no fim). */
function areaAnel(anel: [number, number][]): number {
  const n = anel.length - 1;
  if (n <= 2) return 0;
  let total = 0;
  for (let i = 0; i < n; i++) {
    const baixo = anel[i];
    const meio = anel[i + 1 === n ? 0 : i + 1];
    const alto = anel[i + 2 >= n ? (i + 2) % n : i + 2];
    total += (alto[0] * RAD - baixo[0] * RAD) * Math.sin(meio[1] * RAD);
  }
  return total * FATOR;
}

/** Área em m² de um polígono (anel externo + furos), anéis fechados. */
export function areaPoligonoM2(aneis: [number, number][][]): number {
  if (!aneis.length) return 0;
  let total = Math.abs(areaAnel(aneis[0]));
  for (let i = 1; i < aneis.length; i++) total -= Math.abs(areaAnel(aneis[i]));
  return total;
}
