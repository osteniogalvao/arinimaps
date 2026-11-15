import { competenciaMensal, type CotacaoAtual } from "./formato";

export const REGIOES: Record<string, string[]> = {
  Norte: ["AC", "AP", "AM", "PA", "RO", "RR", "TO"],
  Nordeste: ["AL", "BA", "CE", "MA", "PB", "PE", "PI", "RN", "SE"],
  "Centro-Oeste": ["DF", "GO", "MT", "MS"],
  Sudeste: ["ES", "MG", "RJ", "SP"],
  Sul: ["PR", "RS", "SC"],
};

export const ESTADOS: Record<string, string> = {
  AC: "Acre",
  AL: "Alagoas",
  AP: "Amapá",
  AM: "Amazonas",
  BA: "Bahia",
  CE: "Ceará",
  DF: "Distrito Federal",
  ES: "Espírito Santo",
  GO: "Goiás",
  MA: "Maranhão",
  MT: "Mato Grosso",
  MS: "Mato Grosso do Sul",
  MG: "Minas Gerais",
  PA: "Pará",
  PB: "Paraíba",
  PR: "Paraná",
  PE: "Pernambuco",
  PI: "Piauí",
  RJ: "Rio de Janeiro",
  RN: "Rio Grande do Norte",
  RS: "Rio Grande do Sul",
  RO: "Rondônia",
  RR: "Roraima",
  SC: "Santa Catarina",
  SP: "São Paulo",
  SE: "Sergipe",
  TO: "Tocantins",
};

export function termosDaPraca(c: CotacaoAtual) {
  const uf = c.uf ?? "";
  const regiao = Object.keys(REGIOES).find((nome) => REGIOES[nome].includes(uf));
  const triangulo = uf === "MG" && /tri[âa]ngulo/i.test(c.praca ?? "");
  return [c.praca, uf, ESTADOS[uf], regiao, triangulo && "Triângulo Mineiro"].filter(Boolean).join(" ");
}

export function podeComparar(a: CotacaoAtual, b: CotacaoAtual) {
  if (a.id === b.id || a.produto !== b.produto || a.unidade !== b.unidade || competenciaMensal(a) !== competenciaMensal(b)) return false;
  // Um grupo como "insumos" abrange produtos diferentes vendidos pela mesma unidade.
  const grupos = ["vacas", "novilhas", "semoventes", "graos", "insumos"];
  return !grupos.includes(a.produto) || a.nome.trim().toLocaleLowerCase("pt-BR") === b.nome.trim().toLocaleLowerCase("pt-BR");
}

export function urlSerie(slug: string, comparar?: string, periodo?: string) {
  const qs = new URLSearchParams({ serie: slug });
  if (comparar) qs.set("comparar", comparar);
  if (periodo) qs.set("periodo", periodo);
  return `/mercado?${qs}`;
}
