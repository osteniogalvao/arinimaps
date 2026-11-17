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
  | "snci" | "credito_rural" | "outorgas_federais" | "sigef" | "ibama_embargos" | "anm" | "funai" | "ucs" | "quilombolas" | "prodes_cerrado" | "inpe_queimadas" | "ibge_biomas"
  | "aneel_transmissao" | "aneel_hidreletricas" | "aneel_termeletricas" | "aneel_solar" | "iphan_sitios" | "ana_rios"
  | "prodes_biomas" | "assentamentos" | "ucs_brasil" | "ibama_autos" | "florestas_publicas" | "aerodromos" | "ana_pivos" | "barragens"
  | "solos" | "solos_textura" | "aptidao_agricola" | "climas" | "faixa_fronteira" | "area_queimada" | "icmbio_embargos" | "sinaflor"
  | "outorgas_subterraneas" | "frigorificos" | "silos_armazens" | "usinas_etanol";

export type CamadaOficial = {
  id: CamadaOficialId;
  nome: string;
  orgao: string;
  grupo: "Fundiário" | "Ambiental" | "Infraestrutura" | "Solo e clima" | "Produção";
  cor: string;
  zoomMin: number;
  /** focos de calor são pontos; o resto, polígonos */
  ponto?: boolean;
  /** rede de linhas (transmissão, rios): traço clicável, sem preenchimento; pontos da mesma fonte viram círculos */
  linha?: boolean;
  /** fonte de geometria variável (achada pelo nome do serviço): desenha polígono, linha e ponto */
  misto?: boolean;
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

/**
 * Cores da cartografia ARINI, compartilhadas pela busca, pelo desenho e pela legenda.
 * 17/11/2026: o Carlos achou o mapa pálido. As malhas passaram a cores puras e
 * saturadas, que se destacam sobre o satélite (referência de estilo: Geomart):
 * SIGEF vermelho, SNCI azul, CAR laranja ARINI, crédito rural amarelo.
 */
export const CORES_RURAIS = {
  sigef: "#FF2A2A",
  snci: "#2F6BFF",
  car: "#FF9800",
  credito_rural: "#FFE11A",
  funai: "#B44DFF",
  outorgas_federais: "#00D9FF",
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
  { id: "quilombolas", nome: "Territórios quilombolas", orgao: "INCRA", grupo: "Fundiário", cor: "#FF8FAB", zoomMin: 7,
    ajuda: "Território em reconhecimento ou titulado." },
  { id: "ibama_embargos", nome: "Áreas embargadas", orgao: "IBAMA", grupo: "Ambiental", cor: "#FF1493", zoomMin: 9,
    ajuda: "Embargo ambiental: a área não pode ser usada até a regularização." },
  { id: "ucs", nome: "Unidades de conservação (Cerrado)", orgao: "MMA/INPE", grupo: "Ambiental", cor: "#22E07A", zoomMin: 7,
    ajuda: "Uso restrito conforme a categoria da unidade." },
  { id: "prodes_cerrado", nome: "Desmatamento (PRODES Cerrado)", orgao: "INPE", grupo: "Ambiental", cor: "#C6FF00", zoomMin: 12,
    ajuda: "Supressão de vegetação detectada por satélite, por ano." },
  { id: "inpe_queimadas", nome: "Focos de queimada (12 meses)", orgao: "INPE", grupo: "Ambiental", cor: "#FF3D00", zoomMin: 9, ponto: true,
    ajuda: "Focos de calor detectados por satélite no último ano." },
  { id: "ibge_biomas", nome: "Biomas (limite oficial)", orgao: "IBGE", grupo: "Ambiental", cor: "#C9B23B", zoomMin: 5,
    cores: CORES_BIOMAS, semContorno: true,
    ajuda: "Bioma pelo limite oficial do IBGE: define o percentual de reserva legal e as regras de supressão." },
  { id: "anm", nome: "Processos minerários", orgao: "ANM", grupo: "Infraestrutura", cor: "#E6E6E6", zoomMin: 9,
    ajuda: "Pedido ou direito de pesquisa e lavra mineral sobre a área." },
  // 17/11/2026: camadas que o Dados Fazenda oferece no plano Pro e cuja fonte
  // pública já respondia na consulta de área (src/lib/rural/adaptadores.ts).
  { id: "aneel_transmissao", nome: "Linhas de energia e subestações", orgao: "ANEEL/ONS", grupo: "Infraestrutura", cor: "#FFD54F", zoomMin: 9, linha: true,
    ajuda: "Linha de transmissão gera faixa de servidão: restringe construção e plantio alto sob os cabos." },
  { id: "aneel_hidreletricas", nome: "Hidrelétricas (UHE, PCH, CGH)", orgao: "ANEEL", grupo: "Infraestrutura", cor: "#40C4FF", zoomMin: 7, ponto: true,
    ajuda: "Usinas hidrelétricas e pequenas centrais. Perto do reservatório pode haver APP e área desapropriada." },
  { id: "aneel_termeletricas", nome: "Termelétricas", orgao: "ANEEL", grupo: "Infraestrutura", cor: "#FF7043", zoomMin: 7, ponto: true,
    ajuda: "Usinas térmicas, inclusive as de bagaço de cana das usinas de açúcar e etanol." },
  { id: "aneel_solar", nome: "Usinas solares", orgao: "ANEEL", grupo: "Infraestrutura", cor: "#FFEA00", zoomMin: 7, ponto: true,
    ajuda: "Usinas fotovoltaicas outorgadas: indicam arrendamento de terra para energia na região." },
  { id: "ana_rios", nome: "Rios e cursos d'água (ANA)", orgao: "ANA", grupo: "Ambiental", cor: "#29B6F6", zoomMin: 11, linha: true,
    ajuda: "Base hidrográfica oficial da ANA. Margens de rio são APP pelo Código Florestal." },
  { id: "iphan_sitios", nome: "Sítios arqueológicos e bens tombados", orgao: "IPHAN", grupo: "Fundiário", cor: "#D7A86E", zoomMin: 9, ponto: true,
    ajuda: "Bem cultural cadastrado no IPHAN: obra ou supressão no local exige autorização prévia." },
  // 17/11/2026, segundo lote. O serviço de cada uma é achado pelo nome na pasta
  // do órgão (src/lib/geo/camadasMapa.ts): se o órgão renomear, a camada avisa
  // que não respondeu, e o resto do mapa segue igual.
  { id: "prodes_biomas", nome: "Desmatamento (PRODES outros biomas)", orgao: "INPE", grupo: "Ambiental", cor: "#B2FF59", zoomMin: 12,
    ajuda: "PRODES da Amazônia Legal, Mata Atlântica, Caatinga, Pampa e Pantanal: supressão detectada por satélite, por ano." },
  { id: "assentamentos", nome: "Assentamentos", orgao: "INCRA", grupo: "Fundiário", cor: "#26A69A", zoomMin: 8, misto: true,
    ajuda: "Projeto de assentamento da reforma agrária: lote não pode ser vendido antes da titulação." },
  { id: "ucs_brasil", nome: "Unidades de conservação (Brasil)", orgao: "ICMBio/MMA", grupo: "Ambiental", cor: "#00C853", zoomMin: 7, misto: true,
    ajuda: "UCs federais, estaduais e municipais de todo o país. A de proteção integral impede o uso; a de uso sustentável impõe regras." },
  { id: "ibama_autos", nome: "Autos de infração", orgao: "IBAMA", grupo: "Ambiental", cor: "#FF4081", zoomMin: 10, misto: true,
    ajuda: "Autuação ambiental registrada no local. Vale checar se gerou embargo ou débito." },
  { id: "florestas_publicas", nome: "Florestas públicas", orgao: "SFB", grupo: "Fundiário", cor: "#2E7D32", zoomMin: 8, misto: true,
    ajuda: "Cadastro Nacional de Florestas Públicas: terra pública ou destinada não pode ser vendida como particular." },
  { id: "aerodromos", nome: "Aeródromos", orgao: "ANAC", grupo: "Infraestrutura", cor: "#B0BEC5", zoomMin: 7, misto: true,
    ajuda: "Pistas públicas e privadas. Perto delas há limite de altura de construção e de aplicação aérea." },
  { id: "ana_pivos", nome: "Pivôs de irrigação", orgao: "ANA/Embrapa", grupo: "Infraestrutura", cor: "#00E5FF", zoomMin: 10, misto: true,
    ajuda: "Pivôs centrais mapeados por satélite: sinal de agricultura irrigada e de outorga de água." },
  { id: "barragens", nome: "Barragens e reservatórios", orgao: "ANA/ANEEL", grupo: "Infraestrutura", cor: "#448AFF", zoomMin: 9, misto: true,
    ajuda: "Barragens do SNISB e reservatórios de usinas: há APP no entorno e risco a jusante." },
  // 17/11/2026, lote 3: o restante da lista do Dados Fazenda. Mesmo cuidado do
  // lote 2: serviço achado pelo nome; falhou, só a camada avisa.
  { id: "solos", nome: "Classes de solo", orgao: "IBGE/Embrapa", grupo: "Solo e clima", cor: "#A1887F", zoomMin: 8, misto: true,
    ajuda: "Mapa de solos (pedologia) 1:250 mil: a classe do solo pesa no preço da terra e na aptidão para lavoura." },
  { id: "solos_textura", nome: "Composição do solo (textura)", orgao: "Embrapa", grupo: "Solo e clima", cor: "#D7A86E", zoomMin: 8, misto: true,
    ajuda: "Teor de argila e areia do solo: arenoso exige mais correção e retém menos água." },
  { id: "aptidao_agricola", nome: "Aptidão agrícola", orgao: "Embrapa/IBGE", grupo: "Solo e clima", cor: "#9CCC65", zoomMin: 8, misto: true,
    ajuda: "Classe de aptidão das terras (lavoura, pastagem, silvicultura) pelo sistema da Embrapa." },
  { id: "climas", nome: "Climas do Brasil", orgao: "IBGE", grupo: "Solo e clima", cor: "#80DEEA", zoomMin: 5, misto: true,
    ajuda: "Zonas climáticas do IBGE (temperatura e meses secos). A chuva da área está no relatório." },
  { id: "area_queimada", nome: "Área queimada", orgao: "INPE", grupo: "Ambiental", cor: "#8D6E63", zoomMin: 10, misto: true,
    ajuda: "Cicatrizes de queimada mapeadas por satélite: mostram onde o fogo passou, não só o foco." },
  { id: "icmbio_embargos", nome: "Embargos ICMBio", orgao: "ICMBio", grupo: "Ambiental", cor: "#F50057", zoomMin: 9, misto: true,
    ajuda: "Embargos aplicados pelo ICMBio, em geral dentro ou no entorno de unidades de conservação." },
  { id: "sinaflor", nome: "Autorizações de supressão (SINAFLOR)", orgao: "IBAMA", grupo: "Ambiental", cor: "#76FF03", zoomMin: 10, misto: true,
    ajuda: "Supressão de vegetação autorizada: separa desmatamento legal do ilegal." },
  { id: "outorgas_subterraneas", nome: "Outorgas subterrâneas (poços)", orgao: "ANA", grupo: "Ambiental", cor: "#18FFFF", zoomMin: 9, misto: true,
    ajuda: "Poços com outorga registrada na base nacional. Muitos estados (IGAM, DAEE) mantêm a própria base." },
  { id: "faixa_fronteira", nome: "Faixa de fronteira (150 km)", orgao: "IBGE", grupo: "Fundiário", cor: "#FFAB40", zoomMin: 5, misto: true,
    ajuda: "Na faixa de 150 km da fronteira, venda a estrangeiro e alguns atos exigem assentimento do Conselho de Defesa Nacional." },
  { id: "frigorificos", nome: "Frigoríficos e abatedouros", orgao: "OpenStreetMap", grupo: "Produção", cor: "#EF5350", zoomMin: 8, ponto: true,
    ajuda: "Frigoríficos mapeados no OpenStreetMap (a lista oficial do SIF não tem coordenadas). Distância ao frigorífico pesa no preço do boi." },
  { id: "silos_armazens", nome: "Silos e armazéns", orgao: "OpenStreetMap", grupo: "Produção", cor: "#FFCA28", zoomMin: 8, ponto: true,
    ajuda: "Silos e armazéns de grãos mapeados no OpenStreetMap. Complementa o cadastro de armazéns da CONAB." },
  { id: "usinas_etanol", nome: "Usinas de açúcar, etanol e biodiesel", orgao: "OpenStreetMap", grupo: "Produção", cor: "#7CB342", zoomMin: 7, ponto: true,
    ajuda: "Usinas mapeadas no OpenStreetMap. Arrendamento para cana costuma seguir o raio da usina." },
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
    case "aneel_transmissao":
      return { titulo: `${s(p.tipo) || "Linha de transmissão"}${s(p.nome) ? ` — ${s(p.nome)}` : ""}`, detalhe: junta(s(p.tensao) && `${s(p.tensao)} kV`, s(p.agente), s(p.situacao)) };
    case "aneel_hidreletricas":
    case "aneel_termeletricas":
    case "aneel_solar":
      return { titulo: `${s(p.tipo) || "Usina"}${s(p.nome) ? ` — ${s(p.nome)}` : ""}`,
        detalhe: junta(Number(p.potencia_kw) > 0 ? `${(Number(p.potencia_kw) / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MW` : "", s(p.situacao), s(p.agente)) };
    case "iphan_sitios":
      return { titulo: s(p.nome) || "Bem cultural cadastrado", detalhe: junta(s(p.tipo), s(p.classificacao), s(p.codigo) && `IPHAN ${s(p.codigo)}`) };
    case "ana_rios":
      return { titulo: s(p.nome) || "Curso d'água sem nome cadastrado", detalhe: "Base hidrográfica da ANA" };
    case "prodes_biomas":
      return { titulo: `Desmatamento ${s(p.ano)}`, detalhe: junta(ha(p.area_ha), s(p.bioma) && `PRODES ${s(p.bioma)}`) };
    case "assentamentos":
    case "ucs_brasil":
    case "ibama_autos":
    case "florestas_publicas":
    case "aerodromos":
    case "ana_pivos":
    case "barragens":
    case "solos":
    case "solos_textura":
    case "aptidao_agricola":
    case "climas":
    case "faixa_fronteira":
    case "area_queimada":
    case "icmbio_embargos":
    case "sinaflor":
    case "outorgas_subterraneas":
    case "frigorificos":
    case "silos_armazens":
    case "usinas_etanol":
      return { titulo: s(p.nome) || camadaOficialPorId(id)!.nome, detalhe: junta(s(p.detalhe), ha(p.area_ha)) };
  }
}
