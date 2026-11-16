export const RAIOS_CONSULTA = [0, 500, 1000, 2000, 5000, 10000, 25000, 50000];

export function raioConsulta(valor: unknown, padrao: number): number | null {
  if (valor === null || valor === undefined) return padrao;
  if (typeof valor !== "string" || !/^\d{1,5}$/.test(valor)) return null;
  const raio = Number(valor);
  return RAIOS_CONSULTA.includes(raio) ? raio : null;
}

export function rotuloRaio(metros: number) {
  if (metros === 0) return "Somente a área";
  return metros < 1000 ? `${metros} m` : `${metros / 1000} km`;
}

export function alcanceDaFonte(fonte: string, metros: number) {
  const recorte = metros ? `perímetro e entorno de até ${rotuloRaio(metros)}` : "perímetro da área";
  return fonte === "anm" || fonte === "car_ambiental"
    ? `Interseção com o ${recorte}`
    : `Busca no retângulo que abrange o ${recorte}. A incidência na divisa requer conferência.`;
}
