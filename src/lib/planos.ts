/**
 * Planos por nicho — o registro do que existe (pedido do Carlos, 05/10/2026).
 *
 * Três eixos, cada um numa coluna de `profiles`:
 *  · papel  (`role`)  — o que a pessoa FAZ no fluxo: src/lib/perfis.ts;
 *  · nicho  (`nicho`) — o segmento comercial da conta, vindo das personas do
 *                       Fluxograma Mestre (NICHOS, abaixo);
 *  · plano  (`plan_id`) — o pacote de RECURSOS e COTAS que a conta tem.
 *
 * O que cada plano libera mora no banco (tabela `plans`, editável pela
 * Diretoria em /admin/planos). O que cada recurso SIGNIFICA mora aqui: um
 * recurso novo = uma entrada em RECURSOS + a trava no servidor (`exigirRecurso`)
 * + a tela escondendo o botão. A equipe da Matriz tem todos os recursos pelo
 * papel, sem plano.
 *
 * Regra herdada do CRM: quem manda é o servidor, não a tela. Esconder um botão
 * é conveniência; `exigirRecurso` em src/lib/planos-servidor.ts é a trava.
 */

import { podeAnunciar } from "./perfis";

export type RecursoId =
  | "mapa" | "ficha_basica" | "interesse" | "camada_car" | "camada_lotes" | "ferramenta_medir"
  | "solicitacao_cartografica" | "calculadora_insumos"
  | "camadas_oficiais" | "consulta_area" | "relatorio_territorial" | "ferramenta_kml" | "ferramenta_exportar"
  | "historico_imovel" | "pre_avaliacao" | "chat_ia"
  | "anunciar" | "painel_parceiro" | "oportunidades" | "crm_privado" | "crm_setorial"
  | "multiusuario" | "api_dados" | "territorio";

export type Recurso = {
  id: RecursoId;
  nome: string;
  descricao: string;
  grupo: "consulta" | "ferramentas" | "profissional" | "anuncios" | "organizacao";
  /** ainda não há tela/rota que use: fica reservado no plano até existir */
  reservado?: boolean;
};

export const RECURSOS: Recurso[] = [
  { id: "calculadora_insumos", nome: "Calculadora de insumos", descricao: "Calcular quantidades e custos por área em hectares ou alqueires.", grupo: "ferramentas" },
  // consulta básica
  { id: "mapa", nome: "Mapa e imóveis publicados", descricao: "Navegar no mapa regional e ver os anúncios aprovados.", grupo: "consulta" },
  { id: "ficha_basica", nome: "Ficha do imóvel", descricao: "Página pública do anúncio com fotos, área medida e pontos de interesse.", grupo: "consulta" },
  { id: "interesse", nome: "Demonstrar interesse", descricao: "Pedir informação ou visita; vira lead na central da Arini.", grupo: "consulta" },
  { id: "camada_car", nome: "Divisas do CAR", descricao: "Malha dos imóveis rurais (SICAR) sobre o satélite.", grupo: "consulta" },
  { id: "camada_lotes", nome: "Lotes urbanos", descricao: "Lotes clicáveis das plantas das cidades, com metragens.", grupo: "consulta" },
  { id: "ferramenta_medir", nome: "Medir área e distância", descricao: "Medição geodésica direto no mapa.", grupo: "ferramentas" },
  { id: "solicitacao_cartografica", nome: "Informar imóvel ausente ou divergente", descricao: "Abrir protocolo para a equipe de cartografia incluir ou corrigir uma área.", grupo: "consulta" },
  // consulta profissional
  { id: "camadas_oficiais", nome: "Camadas oficiais no mapa", descricao: "Terras indígenas, embargos, mineração, desmatamento e demais fontes ao vivo.", grupo: "profissional" },
  { id: "consulta_area", nome: "Consulta de área", descricao: "Cruzar com as fontes oficiais (CAR, SIGEF, IBAMA, ANM, INPE, ANA…) uma área do CAR, um lote urbano ou uma área desenhada em qualquer ponto do Brasil. Sujeita a cota mensal.", grupo: "profissional" },
  { id: "relatorio_territorial", nome: "Relatório territorial completo", descricao: "Relatório consolidado do imóvel com todas as fontes e o detalhe de cada item.", grupo: "profissional" },
  { id: "ferramenta_kml", nome: "Importar arquivo", descricao: "Sobrepor ao mapa um KML, KMZ, GeoJSON ou Shapefile próprio.", grupo: "ferramentas" },
  { id: "ferramenta_exportar", nome: "Imprimir, capturar e baixar", descricao: "Imprimir o mapa, salvar a imagem da tela e baixar a área medida em KML, DXF ou memorial descritivo.", grupo: "ferramentas" },
  { id: "historico_imovel", nome: "Histórico e versões", descricao: "Ver as versões da divisa, a origem dos dados e o histórico do imóvel.", grupo: "profissional" },
  { id: "pre_avaliacao", nome: "Pré-avaliação de valor", descricao: "Estimativa automatizada por comparáveis e aptidão territorial (aparece quando a Diretoria liga a função).", grupo: "profissional" },
  { id: "chat_ia", nome: "Assistente de IA", descricao: "Perguntas em linguagem natural sobre imóveis publicados, áreas do CAR e a base de conhecimento. Inclui a leitura de matrícula. Cota mensal nos planos gratuitos.", grupo: "consulta" },
  // anúncios
  { id: "crm_privado", nome: "CRM privado do titular", descricao: "No painel de corretores e profissionais técnicos: contatos, triagem, próximos retornos e histórico exclusivos da conta.", grupo: "profissional" },
  { id: "crm_setorial", nome: "Modelos de profissão no CRM", descricao: "Profissionais técnicos com CRM privado podem classificar atendimentos por serviço e registrar os dados próprios da profissão.", grupo: "profissional" },
  { id: "anunciar", nome: "Anunciar imóvel", descricao: "Cadastrar imóvel para análise e publicação pela Matriz.", grupo: "anuncios" },
  { id: "painel_parceiro", nome: "Painel do parceiro", descricao: "Carteira de imóveis de terceiros e atendimento das oportunidades encaminhadas.", grupo: "anuncios" },
  { id: "oportunidades", nome: "Oportunidades", descricao: "Acompanhar visitas, propostas e negociações dos próprios imóveis.", grupo: "anuncios" },
  // organização
  { id: "multiusuario", nome: "Vários usuários", descricao: "Contas de uma mesma organização compartilhando o plano: o administrador convida e remove membros em /painel/organizacao.", grupo: "organizacao" },
  { id: "api_dados", nome: "Acesso a dados", descricao: "Exportação e integração de dados (reservado).", grupo: "organizacao", reservado: true },
  { id: "territorio", nome: "Território de franquia", descricao: "Operar dentro da região da franquia.", grupo: "organizacao" },
];

export const RECURSO_IDS = RECURSOS.map((r) => r.id);
export const recursoPorId = (id: string) => RECURSOS.find((r) => r.id === id) ?? null;

export const GRUPO_RECURSO_LABEL: Record<Recurso["grupo"], string> = {
  consulta: "Consulta", ferramentas: "Ferramentas do mapa", profissional: "Consulta profissional",
  anuncios: "Anúncios e negociação", organizacao: "Organização e território",
};

/** Cotas que um plano pode limitar. Ausente no plano = sem limite. */
export const COTAS: { id: string; nome: string; ajuda: string }[] = [
  { id: "propriedades_cofre", nome: "Propriedades no cofre", ajuda: "Vagas incluídas no pacote, antes dos adicionais concedidos à conta." },
  { id: "consultas_area_mes", nome: "Consultas de área por mês", ajuda: "Cruzamentos com as fontes oficiais por conta, no mês corrente." },
  { id: "imoveis_ativos", nome: "Imóveis ativos", ajuda: "Anúncios em análise ou publicados ao mesmo tempo." },
  { id: "mensagens_ia_mes", nome: "Mensagens ao assistente de IA por mês", ajuda: "Perguntas enviadas ao assistente por conta, no mês corrente." },
];

export type NichoId =
  | "consulta" | "comprador_investidor" | "proprietario" | "produtor_rural" | "corretor_imobiliaria"
  | "leiloeiro" | "engenheiro" | "empresa_holding" | "ente_publico" | "franqueado";

export type Nicho = {
  id: NichoId;
  nome: string;
  descricao: string;
  /** papéis que podem estar neste nicho (o primeiro é o sugerido no cadastro) */
  papeis: string[];
  /** a pessoa pode escolher no cadastro? franqueado e organização são definidos pela Matriz */
  escolhivel: boolean;
  /** persona do fluxograma sem fluxo próprio definido ainda */
  reservado?: boolean;
};

/** Personas do Fluxograma Mestre (05/10/2026) como nichos comerciais. */
export const NICHOS: Nicho[] = [
  { id: "consulta", nome: "Consulta", descricao: "Só pesquisa o mapa e as informações.", papeis: ["consulta"], escolhivel: true },
  { id: "comprador_investidor", nome: "Comprador / investidor", descricao: "Procura imóvel para comprar ou investir.", papeis: ["comprador"], escolhivel: true },
  { id: "proprietario", nome: "Proprietário / vendedor", descricao: "Quer anunciar o próprio imóvel.", papeis: ["proprietario"], escolhivel: true },
  { id: "produtor_rural", nome: "Produtor rural", descricao: "Consulta e gere as próprias áreas rurais.", papeis: ["proprietario", "consulta"], escolhivel: true },
  { id: "corretor_imobiliaria", nome: "Corretor / imobiliária", descricao: "Anuncia imóveis de terceiros e atende oportunidades.", papeis: ["corretor", "imobiliaria"], escolhivel: true },
  { id: "leiloeiro", nome: "Leiloeiro", descricao: "Publica imóveis de leilão.", papeis: ["leiloeiro"], escolhivel: true },
  { id: "engenheiro", nome: "Engenheiro / profissional técnico", descricao: "Consulta profissional e laudos.", papeis: ["engenheiro"], escolhivel: true },
  { id: "empresa_holding", nome: "Empresa / holding", descricao: "Organização com vários usuários.", papeis: ["consulta", "comprador", "proprietario"], escolhivel: false, reservado: true },
  { id: "ente_publico", nome: "Prefeitura / ente público", descricao: "Gestão urbana e parcerias.", papeis: ["consulta"], escolhivel: false, reservado: true },
  { id: "franqueado", nome: "Franqueado", descricao: "Opera o território de uma franquia da Arini.", papeis: ["franqueado"], escolhivel: false },
];

export const NICHO_IDS = NICHOS.map((n) => n.id);
export const nichoPorId = (id: string | null | undefined) => NICHOS.find((n) => n.id === id) ?? null;
export const NICHO_LABEL: Record<string, string> = Object.fromEntries(NICHOS.map((n) => [n.id, n.nome]));

/** Nichos que a pessoa pode escolher ao criar a conta com este papel. */
export const nichosDoPapel = (role: string) => NICHOS.filter((n) => n.escolhivel && n.papeis.includes(role));

/** Nicho que o papel recebe quando ninguém escolhe (espelha fn_nicho_padrao no banco). */
export function nichoPadrao(role: string): NichoId | null {
  return (NICHOS.find((n) => n.papeis[0] === role) ?? NICHOS.find((n) => n.papeis.includes(role)))?.id ?? null;
}

/**
 * Blocos de persona da página /planos (Revisão.pdf do Carlos, 29/10/2026:
 * "criar um bloco de personas clicável para cada perfil (...) para após
 * clicarem, ser ofertado os pacotes de planos, individualmente para cada perfil").
 *
 * Cada persona junta um ou mais nichos. Os planos mostrados são os que nascem
 * nesses nichos (`plans.nichos_padrao`, editável em /admin/planos) mais os
 * `extras`, que são o próximo degrau natural daquele perfil. Um id de plano que
 * não existir mais no banco é simplesmente ignorado.
 *
 * `papel` é o perfil que já vem marcado no cadastro (/entrar?cadastro=1&papel=…):
 * o botão "Cadastre-se" da home leva a esta escolha, e daqui a pessoa segue
 * para a conta já no perfil certo. Sem papel = conta criada pela Matriz.
 */
export type PersonaPlano = {
  id: string;
  nome: string;
  chamada: string;
  nichos: NichoId[];
  extras?: string[];
  papel?: string;
  icone: "busca" | "casa" | "trator" | "regua" | "predio" | "martelo" | "lupa" | "governo";
};

export const PERSONAS_PLANOS: PersonaPlano[] = [
  { id: "vender", nome: "Sou proprietário", chamada: "Acompanhe seus imóveis, consulte documentos e anuncie quando quiser.", nichos: ["proprietario"], papel: "proprietario", icone: "casa" },
  { id: "corretor", nome: "Sou corretor ou imobiliária", chamada: "Organize sua carteira e acompanhe os atendimentos do escritório.", nichos: ["corretor_imobiliaria"], papel: "corretor", icone: "predio" },
  { id: "produtor", nome: "Sou produtor rural", chamada: "Consulte suas áreas e conheça as opções para gestão da fazenda.", nichos: ["produtor_rural"], papel: "proprietario", icone: "trator" },
  { id: "tecnico", nome: "Sou profissional técnico", chamada: "Escolha a consulta territorial ou configure o CRM da sua profissão.", nichos: ["engenheiro"], papel: "engenheiro", icone: "regua" },
  { id: "comprar", nome: "Sou comprador ou investidor", chamada: "Encontre imóveis à venda e solicite uma visita.", nichos: ["comprador_investidor"], extras: ["consulta_profissional"], papel: "comprador", icone: "busca" },
  { id: "leiloeiro", nome: "Sou leiloeiro", chamada: "Publique imóveis de leilão com a localização exata no mapa.", nichos: ["leiloeiro"], papel: "leiloeiro", icone: "martelo" },
  { id: "instituicao", nome: "Sou órgão público ou instituição", chamada: "Consulte as opções de acesso institucional ao território.", nichos: ["ente_publico"], icone: "governo" },
  { id: "empresa", nome: "Sou empresa ou incorporadora", chamada: "Consulte as opções para a equipe e os empreendimentos.", nichos: ["empresa_holding"], icone: "predio" },
];

// URLs de planos compartilhadas antes da separação das personas.
const PERFIS_ANTERIORES: PersonaPlano[] = [
  { id: "consultar", nome: "Consulta de áreas", chamada: "Consulte o mapa e as fontes oficiais.", nichos: ["consulta"], extras: ["consulta_profissional"], papel: "consulta", icone: "lupa" },
  { id: "organizacao", nome: "Organização", chamada: "Acesso para empresas e instituições.", nichos: ["empresa_holding", "ente_publico"], icone: "governo" },
];
export const personaPorId = (id: string | null | undefined) => [...PERSONAS_PLANOS, ...PERFIS_ANTERIORES].find((p) => p.id === id) ?? null;

/** Planos que a persona vê: os do nicho primeiro, depois os extras, sem repetir. */
export function planosDaPersona<P extends { id: string; nichos_padrao: string[] }>(persona: PersonaPlano, planos: P[]): P[] {
  const nichos = new Set<string>(persona.nichos);
  const doNicho = planos.filter((p) => (p.nichos_padrao ?? []).some((n) => nichos.has(n)));
  const extras = (persona.extras ?? [])
    .map((id) => planos.find((p) => p.id === id))
    .filter((p): p is P => !!p && !doNicho.includes(p));
  return [...doNicho, ...extras];
}

export type Plano = {
  id: string;
  nome: string;
  descricao: string;
  nichos_padrao: string[];
  recursos: string[];
  cotas: Record<string, number>;
  preco_mensal: number;
  preco_anual_centavos?: number | null;
  primeiro_mes_centavos?: number | null;
  periodicidade: "gratis" | "mensal" | "anual";
  escopo: "conta" | "organizacao";
  destaque: boolean;
  ativo: boolean;
  ordem: number;
};

/** O que a conta pode, já resolvido (plano + papel). */
export type Acesso = {
  planId: string | null;
  planNome: string | null;
  nicho: string | null;
  /** plano vencido (plan_valido_ate no passado): volta ao padrão do nicho */
  vencido: boolean;
  recursos: Set<string>;
  cotas: Record<string, number>;
  /** equipe da Matriz: tudo liberado pelo papel */
  equipe: boolean;
};

export const PAPEIS_EQUIPE_IDS = ["admin_central", "analista_arini"];

/** Conta sem sessão: o que o visitante vê. */
export const ACESSO_VISITANTE: Acesso = {
  planId: null, planNome: null, nicho: null, vencido: false, equipe: false, cotas: {},
  recursos: new Set(["mapa", "ficha_basica", "interesse", "camada_car", "camada_lotes", "ferramenta_medir"]),
};

/** Monta o acesso a partir do papel e do plano carregado do banco. */
export function montarAcesso(role: string | null | undefined, plano: Plano | null, nicho: string | null, validoAte: string | null): Acesso {
  const equipe = !!role && PAPEIS_EQUIPE_IDS.includes(role);
  const disponiveis = RECURSOS.filter((recurso) => {
    if (recurso.reservado) return false;
    if (recurso.id === "calculadora_insumos") return equipe || nicho === "produtor_rural";
    if (recurso.id === "crm_privado") return !equipe && ["corretor_imobiliaria", "engenheiro"].includes(nicho ?? "");
    if (recurso.id === "crm_setorial") return !equipe && nicho === "engenheiro" && !!plano?.recursos.includes("crm_privado");
    if (recurso.id === "anunciar") return podeAnunciar(role, nicho);
    return true;
  }).map((recurso) => recurso.id);
  if (equipe) {
    return { planId: null, planNome: "Matriz", nicho: null, vencido: false, equipe: true, cotas: {}, recursos: new Set(disponiveis) };
  }
  const vencido = !!validoAte && new Date(validoAte).getTime() < Date.now();
  if (!plano?.ativo || vencido) {
    return { ...ACESSO_VISITANTE, planId: plano?.id ?? null, planNome: plano?.nome ?? null, nicho, vencido,
      recursos: new Set([...ACESSO_VISITANTE.recursos, "solicitacao_cartografica"]) };
  }
  return {
    planId: plano.id, planNome: plano.nome, nicho, vencido: false, equipe: false,
    cotas: plano.cotas ?? {},
    recursos: new Set(disponiveis.filter((id) => plano.recursos.includes(id))),
  };
}

export const temRecurso = (a: Acesso | null | undefined, recurso: RecursoId) => !!a?.recursos.has(recurso);

export const PERIODICIDADE_LABEL: Record<string, string> = { gratis: "Gratuito", mensal: "por mês", anual: "por ano" };
export const PLAN_ORIGEM_LABEL: Record<string, string> = { padrao: "Padrão do nicho", manual: "Definido pela Matriz", assinatura: "Assinatura" };
