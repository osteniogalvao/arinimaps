/**
 * Municípios onde a Arini anuncia (áudio do Carlos, 17/11/2026 19h09): o
 * "Esta área é minha · anunciar" só vale nos municípios atendidos. O CAR
 * nacional continua no mapa para consulta, mas o anúncio fora deles não
 * abre. A lista é a de Central > Cartografia > Regiões (municípios ativos):
 * na expansão, basta adicionar o município lá. Pode ir ao cliente.
 */
export type MunicipioAtendido = { id: string; nome: string; uf: string; codigo_ibge: string };

/** Código IBGE de 7 dígitos que vem no número do CAR ("MG-3134400-…"). */
export function ibgeDoCar(cod: string | null | undefined): string | null {
  return /^[A-Z]{2}-(\d{7})-/.exec(String(cod ?? "").trim().toUpperCase())?.[1] ?? null;
}

const semAcento = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/** Município atendido da área do CAR (pelo código; o nome é o plano B), ou null. */
export function municipioAtendidoDoCar(
  lista: MunicipioAtendido[],
  car: { cod?: string | null; municipio?: string | null },
): MunicipioAtendido | null {
  const ibge = ibgeDoCar(car.cod);
  if (ibge) return lista.find((m) => String(m.codigo_ibge) === ibge) ?? null;
  const nome = car.municipio ? semAcento(car.municipio.split("/")[0].split(" - ")[0]) : "";
  return (nome && lista.find((m) => semAcento(m.nome) === nome)) || null;
}

/** "Iturama, Campina Verde e Limeira do Oeste" */
export function listaDeMunicipios(lista: MunicipioAtendido[]): string {
  const nomes = lista.map((m) => m.nome);
  return nomes.length <= 1 ? nomes.join("") : `${nomes.slice(0, -1).join(", ")} e ${nomes.at(-1)}`;
}
