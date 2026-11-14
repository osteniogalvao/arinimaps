/**
 * Catálogo comercial dos anexos revisados em 14/11/2026.
 * Valores do proprietário seguem as confirmações do usuário, inclusive R$ 699 anuais.
 * Cada pedido registra a configuração desejada para avaliação pela Central.
 * A ativação e a cobrança dependem da confirmação de disponibilidade pela equipe.
 */
export type PersonaCatalogoId = "proprietario" | "corretor_imobiliaria" | "produtor_rural" | "profissional_tecnico";
export type PlanoCatalogoId =
  | "proprietario_gratuito" | "proprietario_monitoramento" | "proprietario_inteligencia" | "proprietario_completo"
  | "corretor_teste" | "corretor_essencial" | "corretor_profissional" | "corretor_premium"
  | "produtor_teste" | "produtor_essencial" | "produtor_profissional" | "produtor_premium"
  | "tecnico_teste" | "tecnico_consulta" | "tecnico_essencial" | "tecnico_profissional" | "tecnico_premium";

export type DisponibilidadeCatalogo = "disponivel" | "parcial" | "em_implantacao" | "sob_orcamento";
export const DISPONIBILIDADE_CATALOGO: Record<DisponibilidadeCatalogo, string> = {
  disponivel: "Disponível",
  parcial: "Disponibilidade a confirmar",
  em_implantacao: "Em implantação",
  sob_orcamento: "Sob orçamento",
};

export type RecursoCatalogo = {
  nome: string;
  disponibilidade: DisponibilidadeCatalogo;
  motivo: string;
};

export const RECURSOS_CATALOGO = {
  mapa_publico: {
    nome: "Mapa e imóveis à venda",
    disponibilidade: "disponivel",
    motivo: "Navegação, anúncios aprovados, filtros e manifestações de interesse implementados.",
  },
  cofre_propriedade: {
    nome: "Cofre da propriedade e dossiê digital",
    disponibilidade: "disponivel",
    motivo: "Em /painel/cofre, cadastre a área, o CAR e a matrícula declarados e guarde documentos privados de até 25 MB por arquivo.",
  },
  dados_territoriais: {
    nome: "Dados fundiários, ambientais, solo e relevo",
    disponibilidade: "parcial",
    motivo: "Há consultas às fontes e camadas oficiais. A cobertura e os dados cadastrais disponíveis variam conforme a fonte e a região.",
  },
  medicao_desenho: {
    nome: "Desenho e medição de áreas e distâncias",
    disponibilidade: "disponivel",
    motivo: "Ferramentas de desenho, área, distância e perímetro implementadas no mapa.",
  },
  anunciar_proprio: {
    nome: "Enviar imóvel à venda e acompanhar interessados",
    disponibilidade: "disponivel",
    motivo: "Anunciante cadastra e acompanha o imóvel. A publicação depende da aprovação da Central.",
  },
  rede_arini: {
    nome: "Participação opcional na rede ARINI",
    disponibilidade: "parcial",
    motivo: "Captação e intermediação existem. Adesão, exclusividade e repasse ao captador dependem da validação contratual.",
  },
  monitoramento: {
    nome: "Monitoramento diário e alertas do imóvel",
    disponibilidade: "em_implantacao",
    motivo: "As fontes ambientais são consultáveis. Agendamento por propriedade, histórico de eventos e entrega dos alertas precisam ser implementados.",
  },
  comparacao_clima: {
    nome: "Comparação de períodos, clima e precipitação",
    disponibilidade: "parcial",
    motivo: "Comparação de imagens e dados climáticos existem. Histórico contínuo por imóvel e versões de monitoramento exigem integração.",
  },
  arquivos_geograficos: {
    nome: "Importação e exportação de KML e KMZ",
    disponibilidade: "parcial",
    motivo: "Importação e exportação geográfica existem. Formatos e armazenamento no cadastro dependem do fluxo utilizado.",
  },
  inteligencia_ia: {
    nome: "Pesquisa, leitura de documentos e análises com IA",
    disponibilidade: "parcial",
    motivo: "Assistente, leitura de matrícula e cadastro rápido existem. Créditos comerciais compartilhados exigem controle de consumo próprio.",
  },
  avaliacao_mercado: {
    nome: "Pré-avaliação, valores de mercado e análise do imóvel",
    disponibilidade: "parcial",
    motivo: "Pré-avaliação e comparáveis existem. A metodologia, a cobertura e os dados de referência precisam de validação técnica.",
  },
  relatorios: {
    nome: "Relatórios territoriais e ambientais",
    disponibilidade: "disponivel",
    motivo: "Consulta territorial e exportação de relatório implementadas, respeitando a disponibilidade das fontes.",
  },
  relevo_3d: {
    nome: "Relevo detalhado, declividade e visualização 3D",
    disponibilidade: "parcial",
    motivo: "Relevo e visualização 3D existem. Curvas de nível e precisão dependem dos dados altimétricos disponíveis.",
  },
  sobreposicoes_memorial: {
    nome: "Sobreposições e memorial preliminar",
    disponibilidade: "parcial",
    motivo: "Sobreposições e exportação de memorial apoiam a análise; documentos oficiais exigem revisão técnica.",
  },
  geoprocessamento: {
    nome: "Geoprocessamento, CAD, produtos cartográficos e memorial",
    disponibilidade: "parcial",
    motivo: "Conversão DXF, exportações, validação e memorial preliminar existem. O conjunto técnico completo exige implantação e revisão profissional.",
  },
  tour_video: {
    nome: "Tours e vídeos em 3D da propriedade",
    disponibilidade: "parcial",
    motivo: "Tour 3D de imóveis implementado. Geração de vídeo a partir de arquivos KML ou KMZ exige desenvolvimento.",
  },
  google_drive: {
    nome: "Fotos e documentos no Google Drive do cliente",
    disponibilidade: "em_implantacao",
    motivo: "A integração OAuth e a gravação no Drive de cada cliente ainda precisam ser implementadas.",
  },
  crm_corretor_basico: {
    nome: "CRM com imóveis, proprietários, clientes, leads, agenda e relatórios",
    disponibilidade: "parcial",
    motivo: "O titular pode cadastrar contatos, conduzir atendimentos, marcar retornos e consultar o histórico em /painel/crm com o recurso liberado. Carteira de imóveis, relatórios e colaboração entre usuários ainda dependem de implantação.",
  },
  crm_corretor_gestao: {
    nome: "Captação, marketing, equipe, jurídico, financeiro, empresas, comissões e chat",
    disponibilidade: "em_implantacao",
    motivo: "Módulos internos existem na Central. A operação privada de cada escritório precisa de adaptação de dados e permissões.",
  },
  crm_corretor_premium: {
    nome: "Aluguéis, ponto, auditoria e chatbot",
    disponibilidade: "em_implantacao",
    motivo: "Ponto e auditoria atendem a equipe interna. Locação e chatbot por imobiliária dependem de implementação e configuração.",
  },
  loteamentos: {
    nome: "Lançamentos, loteamentos e fichas completas",
    disponibilidade: "parcial",
    motivo: "Lotes e imóveis são consultáveis. Gestão de estoque e disponibilidade por imobiliária precisa de integração.",
  },
  equipe_privada: {
    nome: "Equipe com logins e permissões próprios",
    disponibilidade: "parcial",
    motivo: "Organizações e convites existem. Escopo de dados e limites de cada novo CRM precisam ser homologados.",
  },
  planejamento_rural: {
    nome: "Planejamento de piquetes, talhões, cercas e aguadas",
    disponibilidade: "em_implantacao",
    motivo: "O mapa permite desenho. Cadastro operacional de talhões, piquetes e estruturas ainda precisa ser implementado.",
  },
  agrimensura_ia: {
    nome: "Desenho e conferência territorial com apoio de IA",
    disponibilidade: "em_implantacao",
    motivo: "A medição cartográfica existe. A conferência de precisão assistida por IA depende de desenvolvimento e validação técnica.",
  },
  calculadora_insumos: {
    nome: "Calculadora de insumos, hectare e alqueire",
    disponibilidade: "disponivel",
    motivo: "Calcule a quantidade e o custo a partir da dose informada e da área em hectares ou alqueires, com fator de conversão regional.",
  },
  crm_produtor_basico: {
    nome: "Painel da fazenda, propriedades, agenda e tarefas",
    disponibilidade: "em_implantacao",
    motivo: "O módulo de operação diária da fazenda ainda precisa ser implementado.",
  },
  gestao_fazenda: {
    nome: "Estoque, compras, vendas, custos e resultado por área e safra",
    disponibilidade: "em_implantacao",
    motivo: "Estoque rural, lançamentos por área, safras e indicadores produtivos são novos módulos.",
  },
  pecuaria: {
    nome: "Rebanho, cria, recria, engorda, sanidade e viabilidade",
    disponibilidade: "em_implantacao",
    motivo: "Cadastro de animais e lotes, manejo, pesagens e custos pecuários são novos módulos.",
  },
  comparador_insumos: {
    nome: "Comparação de preços de insumos por nota fiscal",
    disponibilidade: "em_implantacao",
    motivo: "Leitura, normalização de produtos e comparação de notas fiscais ainda precisam ser implementadas.",
  },
  regularizacao_ambiental: {
    nome: "Apoio à regularização de CAR, APP e Reserva Legal",
    disponibilidade: "sob_orcamento",
    motivo: "As camadas dão apoio à consulta. A regularização requer análise e responsabilidade profissional por imóvel.",
  },
  cotacoes: {
    nome: "Cotações de boi gordo e commodities",
    disponibilidade: "parcial",
    motivo: "Painel e coleta existem. Disponibilidade e atualização dependem das fontes autorizadas.",
  },
  cadastro_ia: {
    nome: "Cadastro rápido por texto, fotos e áudio",
    disponibilidade: "parcial",
    motivo: "Cadastro por texto e imagem implementado. Áudio requer serviço de transcrição configurado.",
  },
  precisao_lavoura: {
    nome: "NDVI por talhão, taxa variável, safras e produtividade",
    disponibilidade: "em_implantacao",
    motivo: "Consulta Sentinel e NDVI existe. Séries por talhão, aplicação variável e modelos produtivos dependem de novos módulos.",
  },
  crm_tecnico_padrao: {
    nome: "Clientes, serviços, projetos, agenda, prazos e propostas",
    disponibilidade: "parcial",
    motivo: "Contatos, triagem, retornos e histórico do titular estão em /painel/crm quando liberados no plano. Projetos, propostas e integração com agenda ainda não estão disponíveis.",
  },
  crm_tecnico_setor: {
    nome: "CRM da profissão, dossiês, vistorias e modelos de documento",
    disponibilidade: "parcial",
    motivo: "O CRM setorial oferece seis modelos de triagem com categorias e campos da profissão, preservados no histórico. Emissão de laudos, dossiês completos e validações profissionais ainda exigem serviços próprios.",
  },
  crm_tecnico_completo: {
    nome: "Financeiro, honorários, contratos, equipe, ponto, marketing e auditoria",
    disponibilidade: "em_implantacao",
    motivo: "Os módulos internos da Central precisam ser adaptados aos dados, permissões e processos de cada escritório.",
  },
  relatorios_marca: {
    nome: "Relatórios e documentos com a marca do profissional",
    disponibilidade: "em_implantacao",
    motivo: "Exportação territorial existe. Modelos, marca e geração de documentos por profissão ainda precisam de integração.",
  },
  assinatura_documentos: {
    nome: "Assinatura de contratos e laudos",
    disponibilidade: "parcial",
    motivo: "Aceite e evidências de termos existem. Assinatura dos documentos dos escritórios depende de fluxo e provedor definidos.",
  },
  api_integracoes: {
    nome: "API e conexão com outros sistemas",
    disponibilidade: "sob_orcamento",
    motivo: "Escopo de API, autenticação, conectores e limites de cada integração precisam ser definidos.",
  },
  atendimento_prioritario: {
    nome: "Atendimento prioritário",
    disponibilidade: "sob_orcamento",
    motivo: "Canais, horários e capacidade de atendimento precisam ser acordados com a Central.",
  },
  crm_atendimento: {
    nome: "WhatsApp empresarial com setores, atendentes e IA",
    disponibilidade: "parcial",
    motivo: "Há conversa WhatsApp na Central. O produto por empresa exige número autorizado, isolamento, distribuição e cotas próprios.",
  },
  drone: {
    nome: "Levantamento aéreo, ortomosaico e mapeamento de precisão",
    disponibilidade: "sob_orcamento",
    motivo: "Serviço realizado por profissional e equipamento contratados conforme área e região.",
  },
} as const satisfies Record<string, RecursoCatalogo>;

export type RecursoCatalogoId = keyof typeof RECURSOS_CATALOGO;
export type LimitesCatalogo = {
  usuarios?: number;
  propriedades?: number;
  imoveisCrm?: number | "ilimitado";
  areaTotalHa?: number;
  ndviHa?: number;
  consultasMensais?: number | "uso_justo";
  creditosIaMensais?: number | "uso_justo";
  /** Usado quando o anexo ainda deixa a quantidade por definir. */
  pendentes?: string[];
};

export type PlanoCatalogo = {
  id: PlanoCatalogoId;
  personaId: PersonaCatalogoId;
  nome: string;
  descricao: string;
  mensalCentavos: number;
  anualCentavos: number | null;
  primeiroMesCentavos?: number;
  origemPreco: "confirmado_usuario" | "referencia_anexo";
  escopo: "conta" | "escritorio";
  alcance?: "global";
  exigeProfissao?: boolean;
  incluiPlanoId?: PlanoCatalogoId;
  teste?: { dias: number; crm: "privado" | "demonstracao" | "sem_crm"; aposTeste: string[] };
  limites: LimitesCatalogo;
  /** Recursos acrescentados ao pacote indicado em incluiPlanoId. */
  recursos: RecursoCatalogoId[];
  disponibilidade: DisponibilidadeCatalogo;
  motivoDisponibilidade: string;
  condicoes?: string[];
};

export const CONTRATACAO_CATALOGO = {
  modo: "pedido_central",
  debitoAutomatico: false,
  mensagem: "Envie o plano e os complementos desejados. A Central confirma disponibilidade, configuração e valores antes de ativar e cobrar.",
} as const;

export const PERSONAS_CATALOGO: {
  id: PersonaCatalogoId; nome: string; descricao: string; regras: string[];
}[] = [
  {
    id: "proprietario", nome: "Sou proprietário", descricao: "Cofre, acompanhamento e análise dos próprios imóveis.",
    regras: ["Dados completos do imóvel assumido após validação da documentação.", "Dos demais imóveis, acesso ao conteúdo autorizado dos anúncios.", "Acima de 1.000 hectares somados ou de 10 propriedades, solicite configuração sob medida."],
  },
  {
    id: "corretor_imobiliaria", nome: "Sou corretor ou imobiliária", descricao: "CRM privado, consultas e participação opcional na rede ARINI.",
    regras: ["CRECI individual ou CNPJ e CRECI jurídico conforme o cadastro.", "CRM próprio e rede ARINI podem ser contratados de forma independente.", "A rede prevê comissão total de 1,9%, com retorno de 0,5% ao captador, conforme contrato.", "Imóveis e clientes privados do CRM têm acesso próprio do escritório."],
  },
  {
    id: "produtor_rural", nome: "Sou produtor rural", descricao: "Planejamento da propriedade e gestão da fazenda.",
    regras: ["A quantidade de usuários e a cobertura de NDVI variam conforme o pacote.", "A unidade de alqueire depende da região da propriedade.", "Fotos e documentos no Drive dependem da integração da conta Google."],
  },
  {
    id: "profissional_tecnico", nome: "Sou profissional técnico", descricao: "Consulta territorial e CRM conforme a profissão.",
    regras: ["Consulta é um plano global e dispensa profissão.", "Os planos com CRM solicitam profissão e registro profissional aplicável.", "Cada escritório tem seus próprios dados, usuários e permissões.", "Consultas liberadas para uso humano normal, com vedação de extração em massa e revenda.", "Prazo de configuração de profissão nova será confirmado pela Central."],
  },
];

export const PLANOS_CATALOGO: PlanoCatalogo[] = [
  {
    id: "proprietario_gratuito", personaId: "proprietario", nome: "Gratuito", descricao: "Cofre da Propriedade.",
    mensalCentavos: 0, anualCentavos: null, origemPreco: "confirmado_usuario", escopo: "conta",
    limites: { propriedades: 3, creditosIaMensais: 0 },
    recursos: ["mapa_publico", "cofre_propriedade", "dados_territoriais", "medicao_desenho", "anunciar_proprio"],
    disponibilidade: "parcial", motivoDisponibilidade: "O cofre gratuito inclui três propriedades e aceita documentos privados. A Central pode conceder vagas adicionais após o pedido. A consulta territorial depende da cobertura das fontes e a publicação de anúncios passa por análise.",
  },
  {
    id: "proprietario_monitoramento", personaId: "proprietario", nome: "Monitoramento", descricao: "Acompanhamento e proteção do imóvel.",
    mensalCentavos: 2990, anualCentavos: 29900, origemPreco: "confirmado_usuario", escopo: "conta",
    incluiPlanoId: "proprietario_gratuito", limites: { propriedades: 3, areaTotalHa: 1000, creditosIaMensais: 0, pendentes: ["Quantidade de alertas"] },
    recursos: ["monitoramento", "comparacao_clima", "arquivos_geograficos"],
    disponibilidade: "em_implantacao", motivoDisponibilidade: "Monitoramento diário por imóvel e envio de alertas dependem da implantação.",
  },
  {
    id: "proprietario_inteligencia", personaId: "proprietario", nome: "Inteligência", descricao: "Análises, documentos e dados para decidir.",
    mensalCentavos: 5990, anualCentavos: 49900, primeiroMesCentavos: 4990, origemPreco: "confirmado_usuario", escopo: "conta",
    incluiPlanoId: "proprietario_monitoramento", limites: { propriedades: 3, areaTotalHa: 1000, creditosIaMensais: "uso_justo", pendentes: ["Critério de consumo de IA no uso justo"] },
    recursos: ["inteligencia_ia", "avaliacao_mercado", "relatorios", "relevo_3d"],
    disponibilidade: "parcial", motivoDisponibilidade: "IA, consultas e pré-avaliação existem. O pacote depende da ativação e do monitoramento incluído.",
    condicoes: ["Primeiro mês da assinatura mensal por R$ 49,90. A partir do segundo, R$ 59,90.", "O anual tem preço fechado próprio."],
  },
  {
    id: "proprietario_completo", personaId: "proprietario", nome: "Completo", descricao: "Análise do imóvel e ferramentas técnicas.",
    mensalCentavos: 9990, anualCentavos: 69900, primeiroMesCentavos: 6990, origemPreco: "confirmado_usuario", escopo: "conta",
    incluiPlanoId: "proprietario_inteligencia", limites: { propriedades: 3, areaTotalHa: 1000, creditosIaMensais: "uso_justo" },
    recursos: ["geoprocessamento", "tour_video"],
    disponibilidade: "parcial", motivoDisponibilidade: "Há ferramentas técnicas disponíveis. Processamentos avançados e geração de vídeo dependem da entrega acordada.",
    condicoes: ["Primeiro mês da assinatura mensal por R$ 69,90. A partir do segundo, R$ 99,90.", "O anual tem preço fechado próprio.", "Desconto previsto de 20% em serviços elegíveis sob contratação, sujeito ao orçamento da Central."],
  },
  {
    id: "corretor_teste", personaId: "corretor_imobiliaria", nome: "Teste gratuito", descricao: "Experimente a triagem privada de contatos e as consultas territoriais.",
    mensalCentavos: 0, anualCentavos: null, origemPreco: "referencia_anexo", escopo: "conta",
    teste: { dias: 3, crm: "privado", aposTeste: ["Mapa e imóveis à venda"] },
    limites: { usuarios: 1, creditosIaMensais: 0 },
    recursos: ["mapa_publico", "crm_corretor_basico", "dados_territoriais", "medicao_desenho", "arquivos_geograficos", "relatorios"],
    disponibilidade: "disponivel", motivoDisponibilidade: "O teste dura 72 horas a partir da ativação. No seu CRM, cadastre contatos, encaminhe atendimentos e marque retornos. O acesso de teste termina sem cobrança.",
  },
  {
    id: "corretor_essencial", personaId: "corretor_imobiliaria", nome: "Essencial", descricao: "CRM base e consulta de qualquer área.",
    mensalCentavos: 9700, anualCentavos: 97000, origemPreco: "referencia_anexo", escopo: "escritorio",
    limites: { usuarios: 1, imoveisCrm: 100, creditosIaMensais: 0 },
    recursos: ["mapa_publico", "rede_arini", "crm_corretor_basico", "dados_territoriais", "medicao_desenho", "arquivos_geograficos", "google_drive", "relatorios"],
    disponibilidade: "parcial", motivoDisponibilidade: "O titular já pode usar o CRM privado quando liberado no plano. Gestão de imóveis e integração com o Drive ainda dependem de implantação.",
    condicoes: ["O limite de imóveis foi apresentado como sugestão no anexo.", "IA imobiliária e CRM de atendimento são complementos."],
  },
  {
    id: "corretor_profissional", personaId: "corretor_imobiliaria", nome: "Profissional", descricao: "Gestão do escritório e da equipe.",
    mensalCentavos: 24700, anualCentavos: 247000, origemPreco: "referencia_anexo", escopo: "escritorio",
    incluiPlanoId: "corretor_essencial", limites: { usuarios: 5, imoveisCrm: 500, creditosIaMensais: 0 },
    recursos: ["crm_corretor_gestao", "equipe_privada", "loteamentos", "relevo_3d"],
    disponibilidade: "em_implantacao", motivoDisponibilidade: "Gestão comercial, jurídica e financeira precisam operar no escopo do escritório.",
  },
  {
    id: "corretor_premium", personaId: "corretor_imobiliaria", nome: "Premium", descricao: "Controle da operação, monitoramento e recursos técnicos.",
    mensalCentavos: 49700, anualCentavos: 497000, origemPreco: "referencia_anexo", escopo: "escritorio",
    incluiPlanoId: "corretor_profissional", limites: { usuarios: 15, imoveisCrm: "ilimitado", creditosIaMensais: 0 },
    recursos: ["crm_corretor_premium", "monitoramento", "comparacao_clima", "geoprocessamento"],
    disponibilidade: "em_implantacao", motivoDisponibilidade: "Aluguéis, chatbot, monitoramento e demais funções por imobiliária precisam de implantação.",
  },
  {
    id: "produtor_teste", personaId: "produtor_rural", nome: "Teste gratuito", descricao: "Cadastre uma propriedade no cofre e calcule a quantidade e o custo dos insumos.",
    mensalCentavos: 0, anualCentavos: null, origemPreco: "referencia_anexo", escopo: "conta",
    teste: { dias: 3, crm: "sem_crm", aposTeste: ["Mapa e imóveis à venda", "Documentos privados no cofre da propriedade"] },
    limites: { usuarios: 1, propriedades: 1, creditosIaMensais: 0 },
    recursos: ["mapa_publico", "medicao_desenho", "cofre_propriedade", "calculadora_insumos"],
    disponibilidade: "disponivel", motivoDisponibilidade: "Durante 72 horas, use a calculadora com a dose e o preço que você informar. Os documentos da propriedade continuam no cofre após o teste.",
  },
  {
    id: "produtor_essencial", personaId: "produtor_rural", nome: "Essencial", descricao: "Mapa, planejamento e cálculos da propriedade.",
    mensalCentavos: 3990, anualCentavos: 39900, origemPreco: "referencia_anexo", escopo: "conta",
    limites: { usuarios: 1, propriedades: 3, creditosIaMensais: 100 },
    recursos: ["mapa_publico", "dados_territoriais", "medicao_desenho", "planejamento_rural", "agrimensura_ia", "calculadora_insumos", "relevo_3d", "crm_produtor_basico", "google_drive", "arquivos_geograficos", "inteligencia_ia"],
    disponibilidade: "em_implantacao", motivoDisponibilidade: "Planejamento rural, cálculos de insumos, Drive e consumo de créditos precisam de implantação.",
  },
  {
    id: "produtor_profissional", personaId: "produtor_rural", nome: "Profissional", descricao: "Gestão da fazenda, pecuária e resultado por área.",
    mensalCentavos: 8990, anualCentavos: 89900, origemPreco: "referencia_anexo", escopo: "conta",
    incluiPlanoId: "produtor_essencial", limites: { usuarios: 3, propriedades: 5, creditosIaMensais: 300 },
    recursos: ["gestao_fazenda", "pecuaria", "comparador_insumos", "monitoramento", "regularizacao_ambiental", "cotacoes", "cadastro_ia", "relatorios", "equipe_privada"],
    disponibilidade: "em_implantacao", motivoDisponibilidade: "Estoque, manejo de rebanho, custos por área e monitoramento precisam de desenvolvimento.",
  },
  {
    id: "produtor_premium", personaId: "produtor_rural", nome: "Premium", descricao: "Planejamento de safra e agricultura de precisão.",
    mensalCentavos: 16990, anualCentavos: 169900, origemPreco: "referencia_anexo", escopo: "conta",
    incluiPlanoId: "produtor_profissional", limites: { usuarios: 8, propriedades: 10, ndviHa: 1000, creditosIaMensais: 800 },
    recursos: ["precisao_lavoura", "geoprocessamento", "tour_video"],
    disponibilidade: "em_implantacao", motivoDisponibilidade: "Séries por talhão, taxa variável e modelos de produtividade precisam ser implementados.",
    condicoes: ["Levantamento por drone é contratado sob orçamento."],
  },
  {
    id: "tecnico_teste", personaId: "profissional_tecnico", nome: "Teste gratuito", descricao: "Consultas e demonstração do CRM.",
    mensalCentavos: 0, anualCentavos: null, origemPreco: "referencia_anexo", escopo: "conta", exigeProfissao: false,
    teste: { dias: 3, crm: "demonstracao", aposTeste: ["Mapa e imóveis à venda"] },
    limites: { usuarios: 1, consultasMensais: "uso_justo", creditosIaMensais: 0 },
    recursos: ["mapa_publico", "dados_territoriais", "medicao_desenho", "arquivos_geograficos", "relatorios"],
    disponibilidade: "disponivel", motivoDisponibilidade: "Durante 72 horas, consulte áreas e experimente um atendimento com um cliente fictício. As alterações da demonstração duram até você sair da página.",
  },
  {
    id: "tecnico_consulta", personaId: "profissional_tecnico", nome: "Consulta", descricao: "Dados do território, ferramentas de mapa e relatório simples.",
    mensalCentavos: 2990, anualCentavos: 29900, origemPreco: "referencia_anexo", escopo: "conta", alcance: "global", exigeProfissao: false,
    limites: { usuarios: 1, consultasMensais: "uso_justo", creditosIaMensais: 0 },
    recursos: ["mapa_publico", "dados_territoriais", "medicao_desenho", "arquivos_geograficos", "avaliacao_mercado", "relatorios"],
    disponibilidade: "parcial", motivoDisponibilidade: "Consultas e relatórios existem. Ativação do novo pacote e política de uso justo dependem da Central.",
  },
  {
    id: "tecnico_essencial", personaId: "profissional_tecnico", nome: "Essencial", descricao: "Consultas e CRM padrão do profissional.",
    mensalCentavos: 7990, anualCentavos: 79900, origemPreco: "referencia_anexo", escopo: "escritorio", exigeProfissao: true,
    incluiPlanoId: "tecnico_consulta", limites: { usuarios: 1, consultasMensais: "uso_justo", creditosIaMensais: 100 },
    recursos: ["crm_tecnico_padrao", "google_drive", "inteligencia_ia"],
    disponibilidade: "parcial", motivoDisponibilidade: "O plano pode liberar a triagem privada do titular. Drive, créditos e gestão de projetos por escritório ainda dependem de implantação.",
  },
  {
    id: "tecnico_profissional", personaId: "profissional_tecnico", nome: "Profissional", descricao: "CRM da profissão e relatórios com a sua marca.",
    mensalCentavos: 15990, anualCentavos: 159900, origemPreco: "referencia_anexo", escopo: "escritorio", exigeProfissao: true,
    incluiPlanoId: "tecnico_essencial", limites: { usuarios: 3, consultasMensais: "uso_justo", creditosIaMensais: 300 },
    recursos: ["crm_tecnico_setor", "relatorios_marca", "sobreposicoes_memorial", "monitoramento", "equipe_privada", "assinatura_documentos"],
    disponibilidade: "parcial", motivoDisponibilidade: "Os seis modelos de serviço estão disponíveis para contas com o CRM setorial liberado. Monitoramento, relatórios com marca e documentos oficiais ainda dependem de implantação.",
    condicoes: ["A Central confirma o prazo de configuração conforme a profissão e as integrações solicitadas."],
  },
  {
    id: "tecnico_premium", personaId: "profissional_tecnico", nome: "Premium", descricao: "Gestão completa do escritório e recursos técnicos.",
    mensalCentavos: 32990, anualCentavos: 329900, origemPreco: "referencia_anexo", escopo: "escritorio", exigeProfissao: true,
    incluiPlanoId: "tecnico_profissional", limites: { usuarios: 10, consultasMensais: "uso_justo", creditosIaMensais: 1000 },
    recursos: ["crm_tecnico_completo", "geoprocessamento", "tour_video", "api_integracoes", "atendimento_prioritario"],
    disponibilidade: "em_implantacao", motivoDisponibilidade: "Gestão completa do escritório, API e serviços prioritários dependem da configuração e entrega acordadas.",
  },
];

export type ComplementoCatalogoId =
  | "propriedade_adicional" | "usuario_adicional" | "ia_imobiliaria"
  | "creditos_ia" | "crm_atendimento" | "atendente_adicional" | "hectares_ndvi" | "drone";
export type ComplementoCatalogo = {
  id: ComplementoCatalogoId;
  nome: string;
  descricao: string;
  planos: PlanoCatalogoId[];
  mensalCentavos: number | null;
  mensalCentavosPorPlano?: Partial<Record<PlanoCatalogoId, number>>;
  unidade: string;
  quantidadePorUnidade: number;
  disponibilidade: DisponibilidadeCatalogo;
  motivoDisponibilidade: string;
  inclui?: { usuarios?: number; numerosWhatsApp?: number; creditosIaMensais?: number; respostasIaMensais?: number };
  requerComplemento?: ComplementoCatalogoId;
  requerComplementoPorPersona?: Partial<Record<PersonaCatalogoId, ComplementoCatalogoId>>;
  condicoes?: string[];
};

export const COMPLEMENTOS_CATALOGO: ComplementoCatalogo[] = [
  {
    id: "propriedade_adicional", nome: "Mais propriedades", descricao: "Amplie o número de propriedades da conta.",
    planos: ["proprietario_gratuito", "proprietario_monitoramento", "proprietario_inteligencia", "proprietario_completo", "produtor_essencial", "produtor_profissional", "produtor_premium"],
    mensalCentavos: 1500, unidade: "propriedade", quantidadePorUnidade: 1,
    disponibilidade: "parcial", motivoDisponibilidade: "A Central confirma o número de imóveis e o escopo de cada propriedade.",
    condicoes: ["Proprietário acima de 1.000 ha somados ou de 10 propriedades requer configuração sob medida."],
  },
  {
    id: "usuario_adicional", nome: "Mais usuários", descricao: "Adicione pessoas com login e permissões próprios.",
    planos: ["corretor_essencial", "corretor_profissional", "corretor_premium", "produtor_essencial", "produtor_profissional", "produtor_premium", "tecnico_essencial", "tecnico_profissional", "tecnico_premium"],
    mensalCentavos: null, mensalCentavosPorPlano: {
      corretor_essencial: 2900, corretor_profissional: 2500, corretor_premium: 1900,
      produtor_essencial: 1500, produtor_profissional: 1500, produtor_premium: 1200,
      tecnico_essencial: 2500, tecnico_profissional: 2500, tecnico_premium: 1900,
    },
    unidade: "usuário", quantidadePorUnidade: 1,
    disponibilidade: "parcial", motivoDisponibilidade: "Convites de organização existem. Cada CRM precisa da configuração de acesso da equipe.",
  },
  {
    id: "ia_imobiliaria", nome: "IA imobiliária", descricao: "Pesquisa, pré-avaliação, comparáveis e leitura de documentos.",
    planos: ["corretor_essencial", "corretor_profissional", "corretor_premium"],
    mensalCentavos: 9700, unidade: "conta", quantidadePorUnidade: 1, inclui: { creditosIaMensais: 1000 },
    disponibilidade: "parcial", motivoDisponibilidade: "As ferramentas existem. O saldo de créditos compartilhados e os custos por operação precisam de configuração.",
    condicoes: ["Créditos compartilhados por toda a conta.", "O rendimento por busca, avaliação e documento será confirmado pela Central."],
  },
  {
    id: "creditos_ia", nome: "Mais créditos de IA", descricao: "Amplie a franquia mensal de análises e documentos da conta.",
    planos: ["corretor_essencial", "corretor_profissional", "corretor_premium", "produtor_essencial", "produtor_profissional", "produtor_premium", "tecnico_essencial", "tecnico_profissional", "tecnico_premium"],
    mensalCentavos: 6900, unidade: "créditos", quantidadePorUnidade: 1000,
    requerComplementoPorPersona: { corretor_imobiliaria: "ia_imobiliaria" },
    disponibilidade: "em_implantacao", motivoDisponibilidade: "A medição por créditos e a franquia mensal compartilhada precisam de implantação.",
    condicoes: ["Na persona corretor, exige o complemento IA imobiliária.", "Compartilhados pelos usuários da conta."],
  },
  {
    id: "crm_atendimento", nome: "CRM de atendimento", descricao: "WhatsApp empresarial com setores, distribuição, agendamento e respostas com IA.",
    planos: ["corretor_essencial", "corretor_profissional", "corretor_premium", "tecnico_profissional", "tecnico_premium"],
    mensalCentavos: 14700, unidade: "conta", quantidadePorUnidade: 1,
    inclui: { usuarios: 3, numerosWhatsApp: 1, respostasIaMensais: 1500 },
    disponibilidade: "parcial", motivoDisponibilidade: "Depende de número oficial autorizado e configuração do atendimento privado da empresa.",
    condicoes: ["As respostas de IA deste complemento têm franquia própria.", "Condições do provedor e uso do número são confirmados antes da ativação."],
  },
  {
    id: "atendente_adicional", nome: "Mais atendentes", descricao: "Amplie a equipe do CRM de atendimento.",
    planos: ["corretor_essencial", "corretor_profissional", "corretor_premium", "tecnico_profissional", "tecnico_premium"],
    mensalCentavos: 3900, unidade: "atendente", quantidadePorUnidade: 1, requerComplemento: "crm_atendimento",
    disponibilidade: "parcial", motivoDisponibilidade: "O atendente depende da configuração do CRM de atendimento da conta.",
  },
  {
    id: "hectares_ndvi", nome: "Mais hectares no satélite", descricao: "Amplie a área dos talhões acompanhados por NDVI.",
    planos: ["produtor_premium"], mensalCentavos: 1900, unidade: "hectares", quantidadePorUnidade: 500,
    disponibilidade: "em_implantacao", motivoDisponibilidade: "A série de NDVI por talhão e a medição de área contratada precisam de implantação.",
  },
  {
    id: "drone", nome: "Levantamento com drone", descricao: "Voo planejado, ortomosaico e mapeamento de precisão.",
    planos: ["produtor_essencial", "produtor_profissional", "produtor_premium"],
    mensalCentavos: null, unidade: "serviço", quantidadePorUnidade: 1,
    disponibilidade: "sob_orcamento", motivoDisponibilidade: "Preço e execução dependem da região, da área e do profissional contratado.",
  },
];

export const PROFISSOES_TECNICAS: {
  id: string; nome: string; prioridadeInicial: boolean; disponibilidade: DisponibilidadeCatalogo; modulos: string[];
}[] = [
  { id: "advocacia", nome: "Advocacia", prioridadeInicial: true, disponibilidade: "parcial", modulos: ["Casos e processos", "Prazos e audiências", "Dossiê do imóvel", "Peças e contratos", "Honorários"] },
  { id: "agrimensura", nome: "Agrimensura e topografia", prioridadeInicial: true, disponibilidade: "parcial", modulos: ["Ordens de serviço", "Memorial e plantas", "Confrontantes", "ART", "Equipe de campo", "Orçamento por área"] },
  { id: "contabilidade", nome: "Contabilidade", prioridadeInicial: true, disponibilidade: "parcial", modulos: ["Obrigações e vencimentos", "Tarefas por competência", "Imóveis do cliente", "Documentos fiscais", "Honorários"] },
  { id: "engenharia_ambiental", nome: "Engenharia ambiental", prioridadeInicial: true, disponibilidade: "parcial", modulos: ["Licenças e condicionantes", "APP e Reserva Legal", "Vistorias e laudos", "ART", "Recuperação de áreas"] },
  { id: "engenharia_civil", nome: "Engenharia civil", prioridadeInicial: true, disponibilidade: "parcial", modulos: ["Obras e cronogramas", "Vistorias", "Orçamentos e medições", "Estudo do terreno", "ART"] },
  { id: "corretagem", nome: "Corretagem", prioridadeInicial: true, disponibilidade: "parcial", modulos: ["Imóveis", "Proprietários e clientes", "Leads e agenda", "Comissões", "Relatórios"] },
  { id: "engenharia_agronomica", nome: "Engenharia agronômica", prioridadeInicial: false, disponibilidade: "sob_orcamento", modulos: [] },
  { id: "avaliacao_pericia", nome: "Avaliação e perícia", prioridadeInicial: false, disponibilidade: "sob_orcamento", modulos: [] },
  { id: "despachante", nome: "Despachante", prioridadeInicial: false, disponibilidade: "sob_orcamento", modulos: [] },
  { id: "consultoria_rural", nome: "Consultoria rural", prioridadeInicial: false, disponibilidade: "sob_orcamento", modulos: [] },
  { id: "topografia_obras", nome: "Topografia de obras", prioridadeInicial: false, disponibilidade: "sob_orcamento", modulos: [] },
];

export type CicloCatalogo = "mensal" | "anual";
export type SelecaoCatalogo = {
  planoId: string;
  ciclo: CicloCatalogo;
  adicionais?: { id: string; quantidade: number }[];
  profissao?: string;
  areaTotalHa?: number;
};

export type ItemCotacao = {
  id: ComplementoCatalogoId;
  nome: string;
  /** Número de unidades comerciais: 2 pacotes de 500 ha representam 1.000 ha. */
  quantidade: number;
  unidade: string;
  quantidadePorUnidade: number;
  valorUnitarioMensalCentavos: number | null;
  subtotalMensalCentavos: number | null;
};

export class SelecaoPlanoInvalida extends Error {}

/** Diferença entre o anual e 12 mensalidades; inclui a promoção se for o primeiro ano. */
export function economiaAnualCentavos(plano: PlanoCatalogo, primeiroAno = true) {
  if (plano.anualCentavos === null) return null;
  const primeiroMes = primeiroAno ? (plano.primeiroMesCentavos ?? plano.mensalCentavos) : plano.mensalCentavos;
  return primeiroMes + 11 * plano.mensalCentavos - plano.anualCentavos;
}

export type PrecoVigente = {
  id: string; preco_mensal: number; preco_anual_centavos: number | null; primeiro_mes_centavos: number | null;
};
export function comPrecoVigente(plano: PlanoCatalogo, preco: PrecoVigente): PlanoCatalogo {
  return { ...plano, mensalCentavos: Math.round(Number(preco.preco_mensal) * 100),
    anualCentavos: preco.preco_anual_centavos, primeiroMesCentavos: preco.primeiro_mes_centavos ?? undefined };
}

export function cotarPlano(selecao: SelecaoCatalogo, ofertas = PLANOS_CATALOGO) {
  const plano = ofertas.find((p) => p.id === selecao?.planoId);
  if (!plano) throw new SelecaoPlanoInvalida("Selecione um plano do catálogo.");
  const { ciclo } = selecao;
  if (ciclo !== "mensal" && ciclo !== "anual") throw new SelecaoPlanoInvalida("Selecione o período do plano.");
  if (ciclo === "anual" && plano.anualCentavos === null) throw new SelecaoPlanoInvalida("Este plano não tem contratação anual.");
  if (selecao.profissao !== undefined && typeof selecao.profissao !== "string") throw new SelecaoPlanoInvalida("Profissão inválida.");
  const profissao = selecao.profissao?.trim() || null;
  if (plano.exigeProfissao && !profissao) throw new SelecaoPlanoInvalida("Informe a profissão para solicitar o CRM.");
  if (profissao && (profissao.length > 150 || !plano.exigeProfissao)) throw new SelecaoPlanoInvalida("A profissão não se aplica a esta seleção ou excede o tamanho permitido.");
  const { areaTotalHa } = selecao;
  if (areaTotalHa !== undefined && (!Number.isFinite(areaTotalHa) || areaTotalHa <= 0 || plano.personaId !== "proprietario")) {
    throw new SelecaoPlanoInvalida("Informe uma área total positiva para o perfil de proprietário.");
  }

  const adicionais = selecao.adicionais === undefined ? [] : selecao.adicionais;
  if (!Array.isArray(adicionais) || adicionais.length > COMPLEMENTOS_CATALOGO.length) {
    throw new SelecaoPlanoInvalida("A lista de complementos é inválida.");
  }
  const ids = new Set<string>();
  const itens: ItemCotacao[] = [];
  for (const item of adicionais) {
    const complemento = COMPLEMENTOS_CATALOGO.find((c) => c.id === item?.id && c.planos.includes(plano.id));
    if (!complemento || ids.has(complemento.id)) throw new SelecaoPlanoInvalida("Complemento incompatível com o plano ou repetido.");
    if (!Number.isSafeInteger(item.quantidade) || item.quantidade < 1 || (complemento.unidade === "conta" && item.quantidade !== 1)) {
      throw new SelecaoPlanoInvalida("Informe uma quantidade válida de " + complemento.nome + ".");
    }
    ids.add(complemento.id);
    const unitario = complemento.mensalCentavosPorPlano?.[plano.id] ?? complemento.mensalCentavos;
    const subtotal = unitario === null ? null : unitario * item.quantidade;
    if (subtotal !== null && !Number.isSafeInteger(subtotal)) throw new SelecaoPlanoInvalida("A quantidade solicitada excede o valor calculável.");
    itens.push({
      id: complemento.id, nome: complemento.nome, quantidade: item.quantidade,
      unidade: complemento.unidade, quantidadePorUnidade: complemento.quantidadePorUnidade,
      valorUnitarioMensalCentavos: unitario, subtotalMensalCentavos: subtotal,
    });
  }
  for (const c of COMPLEMENTOS_CATALOGO) {
    if (!ids.has(c.id)) continue;
    const requisito = c.requerComplementoPorPersona?.[plano.personaId] ?? c.requerComplemento;
    if (requisito && !ids.has(requisito)) throw new SelecaoPlanoInvalida(c.nome + " requer " + COMPLEMENTOS_CATALOGO.find((x) => x.id === requisito)!.nome + ".");
  }
  const extrasPropriedades = itens.find((i) => i.id === "propriedade_adicional")?.quantidade ?? 0;
  const proprietarioSobMedida = plano.personaId === "proprietario" && ((areaTotalHa ?? 0) > 1000 || (plano.limites.propriedades ?? 0) + extrasPropriedades > 10);
  const sobOrcamento = proprietarioSobMedida || itens.some((i) => i.subtotalMensalCentavos === null);
  const adicionaisMensaisCentavos = itens.reduce((soma, i) => soma + (i.subtotalMensalCentavos ?? 0), 0);
  const baseCicloCentavos = ciclo === "anual" ? plano.anualCentavos! : (plano.primeiroMesCentavos ?? plano.mensalCentavos);
  const totalPeriodo = baseCicloCentavos + adicionaisMensaisCentavos * (ciclo === "anual" ? 12 : 1);
  const recorrente = plano.mensalCentavos + adicionaisMensaisCentavos;
  if (!Number.isSafeInteger(totalPeriodo) || !Number.isSafeInteger(recorrente)) throw new SelecaoPlanoInvalida("O valor calculado excede o limite de representação.");
  return {
    planoId: plano.id, personaId: plano.personaId, planoNome: plano.nome, ciclo, profissao,
    areaTotalHa: areaTotalHa ?? null,
    rotulo: PERSONAS_CATALOGO.find((p) => p.id === plano.personaId)!.nome + " · " + plano.nome,
    itens, baseCicloCentavos, adicionaisMensaisCentavos, sobOrcamento,
    /** No anual, estimativa de 12 meses com os mesmos adicionais mensais, sem antecipar sua cobrança. */
    totalCentavos: sobOrcamento ? null : totalPeriodo,
    mensalRecorrenteCentavos: sobOrcamento || ciclo === "anual" ? null : recorrente,
    primeiraMensalidadeCentavos: sobOrcamento || ciclo === "anual" ? null : totalPeriodo,
  };
}
