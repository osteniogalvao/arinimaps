export const profissaoSugerida = [
  "Advocacia",
  "Agrimensura e topografia",
  "Contabilidade",
  "Corretagem",
  "Engenharia ambiental",
  "Engenharia civil",
];

export function modeloDaProfissao(nome: string | null | undefined, modelos: string[]) {
  const normalizar = (s: string) =>
    s.trim().toLocaleLowerCase("pt-BR").normalize("NFD").replace(/\p{M}/gu, "");
  const termos: Record<string, string> = {
    advogado: "Advocacia",
    advogada: "Advocacia",
    contador: "Contabilidade",
    contadora: "Contabilidade",
    "engenheiro civil": "Engenharia civil",
    "engenheira civil": "Engenharia civil",
    "engenheiro ambiental": "Engenharia ambiental",
    "engenheira ambiental": "Engenharia ambiental",
    agrimensor: "Agrimensura e topografia",
    topografo: "Agrimensura e topografia",
    corretor: "Corretagem",
    corretora: "Corretagem",
    "corretor de imoveis": "Corretagem",
  };
  if (!nome) return null;
  const busca = normalizar(termos[normalizar(nome)] ?? nome);
  return [...modelos, "Corretagem"].find((m) => normalizar(m) === busca) ?? null;
}
