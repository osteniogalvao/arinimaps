/**
 * Relatório completo ou básico (segunda etapa do cliente, item 5).
 *
 * Antes de gerar ou imprimir, a pessoa escolhe "Completo" (tudo o que está
 * disponível e autorizado) ou "Básico" com as seções que interessam. A escolha
 * vai na URL (?secoes=localizacao,ambiental) para o link poder ser
 * compartilhado: quem abre vê as mesmas seções.
 */

export type SecaoId = "localizacao" | "ambiental" | "fundiario" | "satelite" | "relevo" | "mercado" | "fotos";

export const SECOES: { id: SecaoId; rotulo: string; descricao: string }[] = [
  { id: "localizacao", rotulo: "Localização e mapa", descricao: "Resumo, divisa no mapa, entorno, estradas e energia." },
  { id: "ambiental", rotulo: "CAR e ambiental", descricao: "CAR, embargos, desmatamento, queimadas, unidades de conservação e água." },
  { id: "fundiario", rotulo: "SIGEF e fundiário", descricao: "Parcelas certificadas, terras indígenas, quilombolas, mineração e patrimônio." },
  { id: "satelite", rotulo: "Imagens de satélite e NDVI", descricao: "Vigor da vegetação medido no Sentinel-2." },
  { id: "relevo", rotulo: "Relevo e aptidão", descricao: "Declividade e aptidão territorial da área." },
  { id: "mercado", rotulo: "Mercado e valor", descricao: "Valor anunciado, condições e pré-avaliação." },
  { id: "fotos", rotulo: "Fotos e características", descricao: "Fotos, ficha técnica, descrição e benfeitorias." },
];

export const SECAO_IDS = SECOES.map((s) => s.id);

/** Em que seção cai cada fonte oficial (id de fontes_externas). Fonte nova sem mapa vai para "ambiental". */
const SECAO_DA_FONTE: Record<string, SecaoId> = {
  car: "ambiental", car_ambiental: "ambiental", ibama_embargos: "ambiental", prodes_cerrado: "ambiental",
  deter_cerrado: "ambiental", inpe_queimadas: "ambiental", ucs: "ambiental", ibge_biomas: "ambiental",
  hidrografia: "ambiental", ana: "ambiental",
  sigef: "fundiario", snci: "fundiario", funai: "fundiario", quilombolas: "fundiario", anm: "fundiario", iphan: "fundiario",
  sentinel: "satelite",
  aneel: "localizacao", dnit: "localizacao",
};

export const secaoDaFonte = (fonteId: string): SecaoId => SECAO_DA_FONTE[fonteId] ?? "ambiental";

/**
 * Lê ?secoes= da URL. `null` = completo (sem parâmetro, "completo" ou nada
 * válido). Ids desconhecidos são ignorados.
 */
export function lerSecoes(param: string | string[] | undefined): Set<SecaoId> | null {
  const bruto = Array.isArray(param) ? param.join(",") : param;
  if (!bruto || bruto === "completo") return null;
  const ids = bruto.split(",").map((s) => s.trim()).filter((s): s is SecaoId => (SECAO_IDS as string[]).includes(s));
  return ids.length ? new Set(ids) : null;
}

/** Valor do ?secoes= na ordem do relatório (estável, para o link não variar). */
export const escreverSecoes = (ids: Iterable<SecaoId>) => {
  const s = new Set(ids);
  return SECAO_IDS.filter((id) => s.has(id)).join(",");
};
