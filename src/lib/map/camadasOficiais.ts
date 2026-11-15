/**
 * Camadas oficiais desenhadas no mapa (08/10/2026) — a parte que o navegador
 * também usa: nome, cor, zoom mínimo e como cada feição vira linha de cartão.
 * A busca nos órgãos fica no servidor (src/lib/geo/camadasMapa.ts).
 *
 * São camadas públicas do mapa (D0).
 * `zoomMin` é onde a camada passa a ser pedida: SIGEF e desmatamento são
 * milhares de polígonos pequenos, só fazem sentido de perto; terras indígenas
 * e unidades de conservação são grandes e aparecem já na visão regional.
 */
export type CamadaOficialId =
  | "snci" | "credito_rural" | "outorgas_federais" | "sigef" | "ibama_embargos" | "anm" | "funai" | "ucs" | "quilombolas" | "prodes_cerrado" | "inpe_queimadas" | "ibge_biomas";

export type CamadaOficial = {
  id: CamadaOficialId;
  nome: string;
  orgao: string;
  grupo: "Fundiário" | "Ambiental" | "Infraestrutura";
  cor: string;
  zoomMin: number;
  /** focos de calor são pontos; o resto, polígonos */
  ponto?: boolean;
  /** o que essa camada significa para quem negocia terra */
  ajuda: string;
  /** cor por valor de `nome` (biomas); sem isto, tudo em `cor` */
  cores?: Record<string, string>;
  /** só preenchimento: a camada vem recortada em células e o contorno desenharia as emendas */
  semContorno?: boolean;
};

/** Cores dos biomas: as mesmas famílias do mapa de biomas do IBGE, ajustadas para o tema escuro. */
export const CORES_BIOMAS: Record<string, string> = {
  "Amazônia": "#2E9E5B", "Caatinga": "#E0A458", "Cerrado": "#C9B23B",
  "Mata Atlântica": "#5BC08A", "Pampa": "#A7C957", "Pantanal": "#4FA3C7",
};

/** Cores da cartografia ARINI, compartilhadas pela busca, pelo desenho e pela legenda. */
export const CORES_RURAIS = {
  sigef: "#5BC0EB",
  snci: "#B6A7DA",
  car: "#FF9D3D",
  credito_rural: "#8BC34A",
  funai: "#E4572E",
  outorgas_federais: "#4FA8E0",
} as const;

export const CAMADAS_OFICIAIS: CamadaOficial[] = [
  { id: "sigef", nome: "Parcelas certificadas (SIGEF)", orgao: "INCRA", grupo: "Fundiário", cor: CORES_RURAIS.sigef, zoomMin: 12,
    ajuda: "Imóveis com georreferenciamento certificado pelo INCRA." },
  { id: "snci", nome: "Imóveis certificados (SNCI)", orgao: "INCRA", grupo: "Fundiário", cor: CORES_RURAIS.snci, zoomMin: 12,
    ajuda: "Certificações históricas anteriores ao SIGEF. Fonte nacional do INCRA e base estadual do IAT no interior do Paraná." },
  { id: "credito_rural", nome: "Crédito rural (SICOR)", orgao: "Banco Central", grupo: "Fundiário", cor: CORES_RURAIS.credito_rural, zoomMin: 12,
    ajuda: "Glebas nas edições anuais do SICOR importadas para Iturama e municípios vizinhos. Cada polígono informa o ano e a data da carga." },
  { id: "outorgas_federais", nome: "Outorgas federais", orgao: "ANA", grupo: "Ambiental", cor: CORES_RURAIS.outorgas_federais, zoomMin: 9, ponto: true,
    ajuda: "Outorgas federais de uso de águas superficiais. Consulte a vigência no detalhe de cada ponto." },
  { id: "funai", nome: "Terras indígenas", orgao: "FUNAI", grupo: "Fundiário", cor: CORES_RURAIS.funai, zoomMin: 7,
    ajuda: "Área indígena: compra e venda vedadas." },
  { id: "quilombolas", nome: "Territórios quilombolas", orgao: "INCRA", grupo: "Fundiário", cor: "#F3A712", zoomMin: 7,
    ajuda: "Território em reconhecimento ou titulado." },
  { id: "ibama_embargos", nome: "Áreas embargadas", orgao: "IBAMA", grupo: "Ambiental", cor: "#FF4D6D", zoomMin: 9,
    ajuda: "Embargo ambiental: a área não pode ser usada até a regularização." },
  { id: "ucs", nome: "Unidades de conservação (Cerrado)", orgao: "MMA/INPE", grupo: "Ambiental", cor: "#3FCF7F", zoomMin: 7,
    ajuda: "Uso restrito conforme a categoria da unidade." },
  { id: "prodes_cerrado", nome: "Desmatamento (PRODES Cerrado)", orgao: "INPE", grupo: "Ambiental", cor: "#C77DFF", zoomMin: 12,
    ajuda: "Supressão de vegetação detectada por satélite, por ano." },
  { id: "inpe_queimadas", nome: "Focos de queimada (12 meses)", orgao: "INPE", grupo: "Ambiental", cor: "#FF7B00", zoomMin: 9, ponto: true,
    ajuda: "Focos de calor detectados por satélite no último ano." },
  { id: "ibge_biomas", nome: "Biomas (limite oficial)", orgao: "IBGE", grupo: "Ambiental", cor: "#C9B23B", zoomMin: 5,
    cores: CORES_BIOMAS, semContorno: true,
    ajuda: "Bioma pelo limite oficial do IBGE: define o percentual de reserva legal e as regras de supressão." },
  { id: "anm", nome: "Processos minerários", orgao: "ANM", grupo: "Infraestrutura", cor: "#B8B8B8", zoomMin: 9,
    ajuda: "Pedido ou direito de pesquisa e lavra mineral sobre a área." },
];

export const camadaOficialPorId = (id: string) => CAMADAS_OFICIAIS.find((c) => c.id === id);

/** Linha do cartão do clique: título e detalhe a partir das propriedades já enxutas pelo servidor. */
export function descreverFeicao(id: CamadaOficialId, p: Record<string, unknown>): { titulo: string; detalhe: string } {
  const s = (v: unknown) => (v == null || v === "" ? "" : String(v));
  const ha = (v: unknown) => (Number(v) > 0 ? `${Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} ha` : "");
  const junta = (...xs: string[]) => xs.filter(Boolean).join(" · ");
  switch (id) {
    case "snci":
      return { titulo: s(p.nome) || "Imóvel certificado no SNCI", detalhe: junta(s(p.natureza), s(p.certificacao), ha(p.area_ha), s(p.fonte)) };
    case "credito_rural":
      return { titulo: "Gleba de crédito rural", detalhe: junta("SICOR", s(p.ano), s(p.importado_em) && "Carga em " + new Date(String(p.importado_em)).toLocaleDateString("pt-BR")) };
    case "outorgas_federais":
      return { titulo: s(p.curso) || "Outorga federal", detalhe: junta(s(p.municipio), s(p.ato), s(p.validade), s(p.status)) };
    case "sigef":
      return { titulo: s(p.nome) || "Parcela certificada", detalhe: junta(s(p.situacao), s(p.natureza), s(p.certificada_em) && `certificada em ${s(p.certificada_em)}`) };
    case "ibama_embargos":
      return { titulo: `Embargo ${s(p.termo)}`, detalhe: junta(s(p.data) && `embargado em ${s(p.data)}`, ha(p.area_ha), s(p.infracao)) };
    case "anm":
      return { titulo: `${s(p.substancia) || "Processo minerário"} — ${s(p.fase)}`, detalhe: junta(s(p.processo), s(p.uso), ha(p.area_ha)) };
    case "funai":
      return { titulo: s(p.nome) || "Terra indígena", detalhe: junta(s(p.fase), s(p.etnia)) };
    case "ucs":
      return { titulo: s(p.nome) || "Unidade de conservação", detalhe: junta(s(p.categoria), s(p.esfera)) };
    case "quilombolas":
      return { titulo: s(p.nome) || "Território quilombola", detalhe: junta(s(p.municipio), s(p.fase)) };
    case "inpe_queimadas":
      return { titulo: "Foco de queimada", detalhe: junta(s(p.data) && `detectado em ${s(p.data)}`, s(p.satelite)) };
    case "prodes_cerrado":
      return { titulo: `Desmatamento ${s(p.ano)}`, detalhe: junta(ha(p.area_ha), "PRODES Cerrado") };
    case "ibge_biomas":
      return { titulo: s(p.nome) || "Bioma", detalhe: "Limite oficial do IBGE (1:250.000)" };
  }
}
