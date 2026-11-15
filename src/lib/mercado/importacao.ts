import { ESTADOS } from "./pracas";

export const PRODUTOS_IMPORTACAO = [
  "boi-gordo",
  "vacas",
  "novilhas",
  "semoventes",
  "frango",
  "milho",
  "soja",
  "graos",
  "insumos",
];
export const LIMITE_CSV = 65000;
export type PontoImportado = { data: string; valor: number };
export type SerieImportada = {
  codigo: string;
  produto: string;
  nome: string;
  praca: string;
  uf: string;
  unidade: string;
  fonte: string;
  url: string;
};
export type PreviaCotacoes = {
  slug: string;
  total: number;
  novas: number;
  corrigidas: number;
  iguais: number;
  revisao: string;
  amostra: { data: string; valor: number; anterior: number | null }[];
};
export function validarSerie(entrada: unknown): SerieImportada {
  if (!entrada || typeof entrada !== "object") throw Error("Informe a série.");
  const s = entrada as Record<string, unknown>;
  function campo(k: string, max = 110) {
    const v = s[k];
    if (typeof v !== "string" || !v.trim() || v.length > max || /[\x00-\x1f]/.test(v))
      throw Error("Confira o campo " + k + ".");
    return v.trim();
  }
  const serie = {
    codigo: campo("codigo", 60),
    produto: campo("produto"),
    nome: campo("nome"),
    praca: campo("praca"),
    uf: campo("uf", 2).toUpperCase(),
    unidade: campo("unidade", 35),
    fonte: campo("fonte"),
    url: campo("url", 600),
  };
  if (
    !/^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$/.test(serie.codigo) ||
    !Object.hasOwn(ESTADOS, serie.uf) ||
    !PRODUTOS_IMPORTACAO.includes(serie.produto)
  )
    throw Error("Confira o código da série, o produto e a UF.");
  let url: URL;
  try {
    url = new URL(serie.url);
  } catch {
    throw Error("Informe o endereço público da fonte.");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash)
    throw Error("Informe uma URL HTTPS pública da fonte, sem credenciais ou parâmetros.");
  return serie;
}
export function lerCsvPrecos(csv: string, hoje: string): PontoImportado[] {
  if (typeof csv !== "string" || new TextEncoder().encode(csv).length > LIMITE_CSV)
    throw Error("O CSV pode ter até 65 KB.");
  const [cabecalho, ...linhas] = csv
    .replace(/^\uFEFF/, "")
    .trim()
    .split(/\r?\n/);
  const separador = cabecalho.includes(";") ? ";" : ",";
  const limpar = (v: string) =>
    v
      .trim()
      .replace(/^"([^"]*)"$/, "$1")
      .trim();
  if (
    cabecalho
      .split(separador)
      .map((v) => limpar(v).toLowerCase())
      .join(";") !== "data;valor"
  )
    throw Error("A primeira linha deve ser data;valor.");
  if (linhas.length < 1 || linhas.length > 1000) throw Error("Inclua de 1 a 1.000 datas por arquivo.");
  const datas = new Set<string>();
  return linhas
    .map((linha, i) => {
      const partes = linha.split(separador).map(limpar),
        [data, preco] = partes;
      const dia = /^\d{4}-\d{2}-\d{2}$/.test(data) ? Date.parse(data + "T12:00:00Z") : NaN;
      if (
        partes.length !== 2 ||
        !Number.isFinite(dia) ||
        new Date(dia).toISOString().slice(0, 10) !== data ||
        data < "1900-01-01" ||
        data > hoje ||
        datas.has(data)
      )
        throw Error("Linha " + (i + 2) + ": data inválida, futura ou repetida.");
      if (!/^\d{1,12}([.,]\d{1,4})?$/.test(preco) || Number(preco.replace(",", ".")) <= 0)
        throw Error(
          "Linha " +
            (i + 2) +
            ": informe um preço positivo com até quatro decimais, sem separador de milhar.",
        );
      datas.add(data);
      return { data, valor: Number(preco.replace(",", ".")) };
    })
    .sort((a, b) => a.data.localeCompare(b.data));
}
