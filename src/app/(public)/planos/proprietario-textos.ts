/**
 * Textos da página "Planos para proprietários", conforme os modelos do Carlos
 * de 25/11/2026 ("ARINI Planos para proprietários" e "ARINI Planos urbanos").
 * Preços e regras continuam no catálogo (lib/planos-catalogo) e no banco.
 */
import type { PlanoCatalogoId } from "@/lib/planos-catalogo";

export type TipoImovel = "rural" | "urbano";

/**
 * Urbano: hoje só o Gratuito está à venda. Os pacotes pagos aparecem como
 * "Em breve", porque dependem da integração com as prefeituras (IPTU, ITBI).
 * Mudar para true libera o urbano com os mesmos preços do rural.
 */
export const URBANO_PAGOS_LIBERADOS = false;

export type CartaoProprietario = {
  /** Chamada curta acima do cartão: ENTRAR, CUIDAR, ENTENDER, MOSTRAR. */
  chamada: string;
  frase: string;
  apoio: string;
  /** "Tudo do Gratuito, mais:" */
  base?: string;
  itens: (string | [texto: string, emBreve: true])[];
  nota?: string;
  /** Texto do botão quando não está selecionado. */
  botao?: string;
};

type Cartoes = Partial<Record<PlanoCatalogoId, CartaoProprietario>>;

export const CARTOES: Record<TipoImovel, Cartoes> = {
  rural: {
    proprietario_gratuito: {
      chamada: "Entrar", frase: "Conheça sua terra, sem compromisso.", apoio: "Cadastre uma área de graça e veja uma hipótese do que ela vale.",
      itens: ["Cadastre uma área e veja no mapa", "Hipótese do valor da sua área", "Desenhe e meça áreas, cercas e distâncias",
        "Dados fundiários e ambientais da área", "Solo, relevo e aptidão", "Cofre digital e dossiê da propriedade",
        "Cotações do boi gordo, do bezerro e dos grãos", "Calculadoras do campo", "Avisos e lembretes no WhatsApp", "Anuncie quando quiser"],
      botao: "Cadastrar grátis",
    },
    proprietario_monitoramento: {
      chamada: "Cuidar", frase: "Cuide da sua terra todos os dias.", apoio: "Vigilância diária da sua área.", base: "Tudo do Gratuito, mais:",
      itens: ["Monitoramento diário e alertas de mudança", "Alertas de incêndio, focos de calor e embargos", "Voltar no tempo e comparar imagens",
        "Chuva, clima e previsão da sua área", "Caderno de gastos por área e calendário do campo", "Importe e exporte KML e KMZ",
        "Alertas da área e relatório mensal no WhatsApp", "Avisos de vencimento do cofre"],
    },
    proprietario_inteligencia: {
      chamada: "Entender", frase: "Entenda sua terra a fundo.", apoio: "Documentos e dados explicados por IA.", base: "Tudo do Monitoramento, mais:",
      itens: ["Ari lê seus documentos e explica", "Pergunte à Ari sobre a sua terra", "Estimativa de mercado detalhada",
        "Relatórios territoriais e ambientais", "Relevo detalhado, declividade e 3D", "Resumo de mercado no WhatsApp"],
    },
    proprietario_completo: {
      chamada: "Mostrar", frase: "Mostre sua terra para o mundo.", apoio: "Peças técnicas e apresentação.", base: "Tudo da Inteligência, mais:",
      itens: ["Tour e vídeo em 3D da propriedade", "Geoprocessamento, CAD e memorial", "Produtos cartográficos",
        "Inteligência de oportunidades e análise de risco", "Análise completa do imóvel", ["Atendimento com prioridade", true]],
    },
  },
  urbano: {
    proprietario_gratuito: {
      chamada: "Entrar", frase: "Conheça e cuide do seu imóvel.", apoio: "Tudo o que a ARINI já entrega para o imóvel urbano.",
      itens: ["Cadastre seus lotes e imóveis e veja no mapa", "Hipótese do valor do seu imóvel", "Meça lote, muro e divisa",
        "Localização, quadra, lote e entorno", "Cofre do imóvel: matrícula, IPTU, habite-se, certidões e fotos",
        "Lembretes de vencimento com as datas que você cadastra", "Juros, INCC e preço do m² do dia",
        "Calculadoras de casa e terreno e conversor de medidas", "Mapa de imóveis à venda", "Avisos e lembretes no WhatsApp",
        "Anuncie quando quiser, com tudo já cadastrado"],
      nota: "A hipótese de valor é estimativa de mercado, sem valor de laudo ou avaliação oficial.",
      botao: "Cadastrar meu imóvel grátis",
    },
    proprietario_monitoramento: {
      chamada: "Cuidar", frase: "Cuide do seu imóvel todos os meses.", apoio: "Vencimentos e entorno sob controle.", base: "Tudo do Gratuito, mais:",
      itens: ["Dados e vencimentos do IPTU direto da prefeitura", "Alertas de certidões e contratos", "Comparar períodos e mudanças no entorno",
        "Termômetro do bairro", "Previsão do tempo e relatório mensal no WhatsApp", "Reajuste de aluguel e KML/KMZ"],
    },
    proprietario_inteligencia: {
      chamada: "Entender", frase: "Entenda seu imóvel a fundo.", apoio: "Documentos e dados explicados por IA.", base: "Tudo do Monitoramento, mais:",
      itens: ["Ari lê matrícula, IPTU, habite-se e contratos", "Pergunte à Ari sobre o imóvel e o bairro", "Estimativa de mercado detalhada",
        "Relatórios do imóvel e do entorno", "Resumo de mercado no WhatsApp"],
    },
    proprietario_completo: {
      chamada: "Mostrar", frase: "Mostre seu imóvel para o mundo.", apoio: "Peças técnicas e apresentação.", base: "Tudo da Inteligência, mais:",
      itens: ["Tour e vídeo em 3D do imóvel", "Planta, memorial e desmembramento", "Produtos cartográficos urbanos",
        "Inteligência de oportunidades e análise de risco", "Análise completa do imóvel", "Atendimento com prioridade"],
    },
  },
};

export const COMECAR: Record<TipoImovel, { titulo: string; texto: string; acao: string; destino: "vender" | "planos" | "gratuito" }[]> = {
  rural: [
    { titulo: "Quero vender", texto: "Divulgue com a ARINI, assine a exclusividade e use todo o sistema para o imóvel, sem mensalidade.", acao: "Divulgar grátis", destino: "vender" },
    { titulo: "Quero cuidar", texto: "Acompanhe suas propriedades todos os dias, com alertas, clima, documentos e a Ari.", acao: "Ver os planos", destino: "planos" },
    { titulo: "Quero conhecer", texto: "Cadastre uma área de graça, sem compromisso, veja os dados dela e uma hipótese do que ela vale.", acao: "Cadastrar grátis", destino: "gratuito" },
  ],
  urbano: [
    { titulo: "Quero vender", texto: "Divulgue com a ARINI, assine a exclusividade e use o sistema para o imóvel, sem mensalidade.", acao: "Divulgar grátis", destino: "vender" },
    { titulo: "Quero cuidar", texto: "Cadastre seus imóveis, guarde os documentos e receba lembretes de prazos.", acao: "Cadastrar grátis", destino: "gratuito" },
    { titulo: "Quero conhecer", texto: "Cadastre um imóvel sem compromisso e veja uma hipótese do que ele vale.", acao: "Cadastrar grátis", destino: "gratuito" },
  ],
};

export const VENDER: Record<TipoImovel, { recursos: [string, string][]; continua: string[]; deixa: string[] }> = {
  rural: {
    recursos: [
      ["Mapa e medidas", "Sua área com divisa e vizinhos. Meça cerca, estrada, aceiro e áreas."],
      ["Futura estrada", "Trace no mapa e veja km, hectares ocupados e desnível."],
      ["Curvas de nível e solo", "Veja a forma do terreno e a qualidade do solo, trecho por trecho."],
      ["Tour 3D e voltar no tempo", "Sobrevoe a propriedade e compare como ela era antes."],
      ["Acompanhamento da venda", "Relatório de cada visita, placar, conversa com o corretor e alerta de proposta."],
      ["Ferramentas e cofre", "Caderno de gastos, calculadoras, KML, cotações, clima e cofre."],
    ],
    continua: ["Cotações do boi gordo, do bezerro e dos grãos", "Clima do dia na sua região", "Conversor de área e calculadoras",
      "Mapa de imóveis à venda", "Avisos no WhatsApp", "O que você cadastrou no plano Gratuito"],
    deixa: ["Acompanhamento da venda", "Tour 3D, relatórios e vigilância do imóvel", "Ferramentas avançadas do imóvel"],
  },
  urbano: {
    recursos: [
      ["Meu imóvel no mapa", "Medir lote, muro e divisa, marcar pontos; lote no mapa da cidade (em breve)."],
      ["Calculadoras de casa e terreno", "Medidas do lote, o que dá para construir e quanto sobra na venda."],
      ["Termômetro do bairro", "Procura, tempo para vender e seu preço frente ao entorno."],
      ["Tour 3D do imóvel", "Mostre o imóvel ao comprador de qualquer lugar."],
      ["Acompanhamento da venda", "Relatório de cada visita, placar, conversa com o corretor e alerta de proposta."],
      ["Cofre e divulgação", "Matrícula, IPTU, habite-se, certidões, placa com QR code e checklist."],
    ],
    continua: ["Juros, INCC e m² do dia", "Conversor de medidas e calculadoras", "Mapa de imóveis à venda", "Avisos no WhatsApp",
      "O que você cadastrou no plano Gratuito"],
    deixa: ["Acompanhamento da venda", "Tour 3D, termômetro do bairro e divulgação", "Ferramentas avançadas do imóvel"],
  },
};

export const ETAPAS_MUNDO: [titulo: string, texto: string, plano: string][] = [
  ["Plantar", "Cadastre uma área, conheça o que ela tem e veja uma hipótese do valor.", "Gratuito"],
  ["Cuidar", "Monitore, acompanhe o clima e mantenha os documentos em dia.", "Monitoramento"],
  ["Entender", "Peça à Ari para explicar documentos, dados e mercado.", "Inteligência"],
  ["Colher", "Quando decidir vender, já está tudo pronto: anuncie em poucos cliques.", "Vender"],
];

/** Colunas: Gratuito, Vender, Monitoramento, Inteligência, Completo. */
type Linha = [recurso: string, marcas: string];
export const COMPARATIVO: Record<TipoImovel, { quais: [string, string, string]; grupos: [string, Linha[]][] }> = {
  rural: {
    quais: ["área sua", "O imóvel à venda com a ARINI", "Até 3 propriedades suas"],
    grupos: [
      ["Cadastro e cofre", [["Cadastrar a área e ver no mapa", "11111"], ["Cofre digital, dossiê e álbum de fotos", "11111"], ["Avisos de vencimento do cofre", "01111"]]],
      ["Dados da área", [["Dados fundiários e ambientais (CAR, SIGEF, INCRA, APP, água)", "11111"], ["Solo, relevo e aptidão", "11111"], ["Relevo detalhado, declividade e 3D", "01011"]]],
      ["Quanto vale", [["Hipótese do valor da área", "11111"], ["Estimativa detalhada: semelhantes e tendência", "01011"], ["Inteligência de oportunidades e análise de risco", "00001"]]],
      ["Meu mundo", [["Desenhar, medir e marcar pontos", "11111"], ["Voltar no tempo e comparar imagens", "01111"], ["Tour e vídeo 3D", "01001"]]],
      ["Vigilância", [["Alertas de mudança, incêndio e embargos", "01111"], ["Chuva, clima e previsão da área", "01111"]]],
      ["Dia a dia do campo", [["Cotações do boi gordo, do bezerro e dos grãos", "11111"], ["Calculadoras: lotação, arroba e conversor de área", "11111"],
        ["Caderno de gastos e calendário do campo", "01111"], ["Importar e exportar KML/KMZ", "01111"]]],
      ["WhatsApp", [["Avisos e lembretes da sua área", "11111"], ["Alertas da área e relatório mensal", "01111"], ["Resumo de mercado", "00111"]]],
      ["Vender", [["Anunciar com a ARINI (exclusividade)", "11111"], ["Acompanhamento da venda: visitas, placar, corretor e propostas", "11111"]]],
      ["A Ari (inteligência artificial)", [["Ari lê e explica seus documentos", "00011"], ["Pergunte à Ari", "00011"], ["Relatórios explicados pela Ari", "00011"]]],
      ["Peças e serviços", [["Geoprocessamento, CAD e memorial", "00001"], ["Produtos cartográficos e análise completa", "00001"], ["Atendimento com prioridade", "00001"]]],
    ],
  },
  urbano: {
    quais: ["imóvel seu", "O imóvel à venda com a ARINI", "Até 3 imóveis seus"],
    grupos: [
      ["Cadastro e cofre", [["Cadastrar o imóvel e ver no mapa", "11111"], ["Cofre: matrícula, IPTU, habite-se, certidões e fotos", "11111"],
        ["Alertas de vencimento: IPTU, certidões e contratos", "01111"]]],
      ["Dados do imóvel", [["Localização, quadra, lote e entorno", "11111"], ["Comparar períodos e mudanças no entorno", "01111"], ["Termômetro do bairro", "01111"]]],
      ["Quanto vale", [["Hipótese do valor do imóvel", "11111"], ["Estimativa detalhada: semelhantes e tendência", "01011"], ["Inteligência de oportunidades e análise de risco", "00001"]]],
      ["Meu imóvel", [["Medir lote, muro e divisa e marcar pontos", "11111"], ["Tour e vídeo 3D", "01001"]]],
      ["Dia a dia", [["Juros, INCC e m² do dia", "11111"], ["Calculadoras de casa e terreno e conversor de medidas", "11111"], ["KML/KMZ e reajuste de aluguel (em breve)", "01111"]]],
      ["WhatsApp", [["Avisos e lembretes do seu imóvel", "11111"], ["Previsão do tempo e relatório mensal", "01111"], ["Resumo de mercado", "00111"]]],
      ["Vender", [["Anunciar com a ARINI (exclusividade)", "11111"], ["Acompanhamento da venda: visitas, placar, corretor e propostas", "11111"],
        ["Material de divulgação, placa QR e checklist", "01111"]]],
      ["A Ari (inteligência artificial)", [["Ari lê e explica seus documentos", "00011"], ["Pergunte à Ari", "00011"], ["Relatórios explicados pela Ari", "00011"]]],
      ["Peças e serviços", [["Planta, memorial e desmembramento", "00001"], ["Produtos cartográficos urbanos e análise completa", "00001"], ["Atendimento com prioridade", "00001"]]],
    ],
  },
};
