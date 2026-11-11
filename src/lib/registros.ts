/**
 * Cadastros da Central (Central de CRMs, etapas 2 em diante).
 *
 * Um cadastro novo = uma entrada aqui. A tela (/admin/registros/[recurso]), a
 * API (/api/admin/registros/[recurso]), a validação e a trava de acesso saem
 * deste registro, então campo, permissão e tela nunca ficam fora de sincronia.
 * Fluxos com regra própria (aprovar despesa, emitir nota) entram como `acoes`,
 * tratadas na API por recurso.
 *
 * Arquivo sem dependência de servidor: o componente da tela também o lê.
 */
import type { SetorId } from "@/lib/setores";

export type TipoCampo =
  | "texto" | "textarea" | "numero" | "dinheiro" | "data" | "datahora"
  | "select" | "bool" | "membro" | "ref" | "email" | "telefone";

export type Campo = {
  nome: string;
  rotulo: string;
  tipo: TipoCampo;
  obrigatorio?: boolean;
  /** select: [valor, rótulo] */
  opcoes?: [string, string][];
  /** ref: tabela e coluna mostrada */
  ref?: { tabela: string; rotulo: string; filtroAtivo?: boolean; filtro?: { coluna: string; valores: string[] }; extra?: string };
  /** aparece como coluna na lista */
  lista?: boolean;
  /** não aparece no formulário (preenchido pelo sistema) */
  sistema?: boolean;
  /** só no formulário de criação */
  soCriar?: boolean;
  ajuda?: string;
  padrao?: string | number | boolean;
};

export type Acao = {
  id: string;
  rotulo: string;
  /** status em que a ação aparece */
  quando: string[];
  pedeMotivo?: boolean;
  tom?: "verde" | "critico" | "neutro";
  /** só quem atua nestes setores vê a ação */
  setores?: SetorId[];
};

export type Recurso = {
  id: string;
  tabela: string;
  titulo: string;
  singular: string;
  eyebrow: string;
  descricao: string;
  ler: SetorId[];
  escrever: SetorId[];
  campos: Campo[];
  ordem: { coluna: string; asc?: boolean };
  /** coluna de status (abas de filtro e ações) */
  status?: { coluna: string; rotulos: Record<string, string>; abertos?: string[] };
  acoes?: Acao[];
  /** coluna de código mostrada antes do título */
  codigo?: string;
  /** coluna usada como título da linha */
  tituloColuna: string;
  /** coluna preenchida com quem criou */
  autorColuna?: string;
  /** permite excluir (senão só arquiva/cancela) */
  excluir?: boolean;
  /** busca por texto nestas colunas */
  busca?: string[];
};

export const DESPESA_STATUS: Record<string, string> = {
  pendente: "Aguardando aprovação", aprovada: "Aprovada, a pagar", reprovada: "Reprovada", paga: "Paga", cancelada: "Cancelada",
};
export const NF_STATUS: Record<string, string> = {
  rascunho: "Rascunho", enviada: "Enviada à prefeitura", emitida: "Emitida", cancelada: "Cancelada", erro: "Com erro",
};

export const RECURSOS: Recurso[] = [
  {
    id: "despesas", tabela: "despesas", titulo: "Despesas", singular: "despesa", eyebrow: "Financeiro",
    descricao: "Todo gasto entra aqui, passa pela aprovação e, quando pago, vira lançamento contábil sozinho. Acima da alçada, só a Diretoria aprova.",
    ler: ["financeiro", "diretoria"], escrever: ["financeiro", "diretoria"],
    codigo: "codigo", tituloColuna: "descricao", autorColuna: "solicitante",
    ordem: { coluna: "created_at" }, busca: ["descricao", "codigo", "documento"],
    status: { coluna: "status", rotulos: DESPESA_STATUS, abertos: ["pendente", "aprovada"] },
    campos: [
      { nome: "descricao", rotulo: "Descrição", tipo: "texto", obrigatorio: true },
      { nome: "valor", rotulo: "Valor", tipo: "dinheiro", obrigatorio: true, lista: true },
      { nome: "fornecedor_id", rotulo: "Fornecedor", tipo: "ref", ref: { tabela: "fornecedores", rotulo: "nome", filtroAtivo: true }, lista: true },
      { nome: "centro_custo_id", rotulo: "Centro de custo", tipo: "ref", ref: { tabela: "centros_custo", rotulo: "nome", filtroAtivo: true }, obrigatorio: true, lista: true },
      { nome: "conta_id", rotulo: "Conta", tipo: "ref", ref: { tabela: "plano_contas", rotulo: "nome", filtroAtivo: true } },
      { nome: "competencia", rotulo: "Competência", tipo: "data" },
      { nome: "vencimento", rotulo: "Vencimento", tipo: "data", lista: true },
      { nome: "forma_pagamento", rotulo: "Forma de pagamento", tipo: "select",
        opcoes: [["pix", "Pix"], ["boleto", "Boleto"], ["cartao", "Cartão"], ["transferencia", "Transferência"], ["dinheiro", "Dinheiro"]] },
      { nome: "documento", rotulo: "Nº da nota ou recibo do fornecedor", tipo: "texto" },
      { nome: "recorrente", rotulo: "Repete todo mês", tipo: "bool" },
      { nome: "observacoes", rotulo: "Observações", tipo: "textarea" },
    ],
    acoes: [
      { id: "aprovar", rotulo: "Aprovar", quando: ["pendente"], tom: "verde" },
      { id: "reprovar", rotulo: "Reprovar", quando: ["pendente"], pedeMotivo: true, tom: "critico" },
      { id: "pagar", rotulo: "Marcar como paga", quando: ["aprovada"], tom: "verde" },
      { id: "cancelar", rotulo: "Cancelar", quando: ["pendente", "aprovada"], pedeMotivo: true },
    ],
  },
  {
    id: "fornecedores", tabela: "fornecedores", titulo: "Fornecedores", singular: "fornecedor", eyebrow: "Financeiro",
    descricao: "Quem recebe os pagamentos da Arini.",
    ler: ["financeiro", "diretoria"], escrever: ["financeiro", "diretoria"],
    tituloColuna: "nome", ordem: { coluna: "nome", asc: true }, busca: ["nome", "cpf_cnpj"],
    campos: [
      { nome: "nome", rotulo: "Nome", tipo: "texto", obrigatorio: true },
      { nome: "cpf_cnpj", rotulo: "CPF ou CNPJ", tipo: "texto", lista: true },
      { nome: "email", rotulo: "E-mail", tipo: "email", lista: true },
      { nome: "telefone", rotulo: "Telefone", tipo: "telefone" },
      { nome: "pix", rotulo: "Chave Pix", tipo: "texto" },
      { nome: "observacoes", rotulo: "Observações", tipo: "textarea" },
      { nome: "ativo", rotulo: "Ativo", tipo: "bool", padrao: true, lista: true },
    ],
  },
  {
    id: "centros-custo", tabela: "centros_custo", titulo: "Centros de custo", singular: "centro de custo", eyebrow: "Financeiro",
    descricao: "Onde cada despesa pesa. Começa com um por setor.",
    ler: ["financeiro", "diretoria"], escrever: ["diretoria"],
    tituloColuna: "nome", ordem: { coluna: "nome", asc: true },
    campos: [
      { nome: "nome", rotulo: "Nome", tipo: "texto", obrigatorio: true },
      { nome: "setor", rotulo: "Setor", tipo: "select", lista: true, opcoes: [
        ["diretoria", "Diretoria"], ["operacoes", "Operações"], ["comercial", "Comercial"], ["financeiro", "Financeiro"],
        ["juridico", "Jurídico"], ["marketing", "Marketing"], ["cartografia", "Cartografia"], ["suporte", "Suporte"], ["seguranca", "Segurança"]] },
      { nome: "ativo", rotulo: "Ativo", tipo: "bool", padrao: true, lista: true },
    ],
  },
  {
    id: "plano-contas", tabela: "plano_contas", titulo: "Plano de contas", singular: "conta", eyebrow: "Financeiro",
    descricao: "As contas usadas nos lançamentos e no arquivo do contador.",
    ler: ["financeiro", "diretoria"], escrever: ["diretoria"],
    codigo: "codigo", tituloColuna: "nome", ordem: { coluna: "codigo", asc: true },
    campos: [
      { nome: "codigo", rotulo: "Código", tipo: "texto", obrigatorio: true },
      { nome: "nome", rotulo: "Nome", tipo: "texto", obrigatorio: true },
      { nome: "tipo", rotulo: "Tipo", tipo: "select", obrigatorio: true, lista: true,
        opcoes: [["receita", "Receita"], ["despesa", "Despesa"], ["ativo", "Ativo"], ["passivo", "Passivo"]] },
      { nome: "ativo", rotulo: "Ativa", tipo: "bool", padrao: true, lista: true },
    ],
  },
  {
    id: "lancamentos", tabela: "lancamentos_contabeis", titulo: "Lançamentos contábeis", singular: "lançamento", eyebrow: "Financeiro",
    descricao: "Despesas pagas, comissões recebidas e mensalidades pagas entram sozinhas. Aqui também cabe um lançamento avulso.",
    ler: ["financeiro", "diretoria"], escrever: ["financeiro", "diretoria"],
    tituloColuna: "historico", autorColuna: "criado_por", ordem: { coluna: "data" }, busca: ["historico"],
    status: { coluna: "natureza", rotulos: { entrada: "Entrada", saida: "Saída" } },
    campos: [
      { nome: "data", rotulo: "Data", tipo: "data", obrigatorio: true, lista: true },
      { nome: "historico", rotulo: "Histórico", tipo: "texto", obrigatorio: true },
      { nome: "natureza", rotulo: "Natureza", tipo: "select", obrigatorio: true, opcoes: [["entrada", "Entrada"], ["saida", "Saída"]] },
      { nome: "valor", rotulo: "Valor", tipo: "dinheiro", obrigatorio: true, lista: true },
      { nome: "conta_id", rotulo: "Conta", tipo: "ref", ref: { tabela: "plano_contas", rotulo: "nome" }, obrigatorio: true, lista: true },
      { nome: "centro_custo_id", rotulo: "Centro de custo", tipo: "ref", ref: { tabela: "centros_custo", rotulo: "nome" } },
      { nome: "origem", rotulo: "Origem", tipo: "texto", sistema: true, lista: true },
      { nome: "estornado", rotulo: "Estornado", tipo: "bool", sistema: true, lista: true },
    ],
    acoes: [{ id: "estornar", rotulo: "Estornar", quando: ["entrada", "saida"], pedeMotivo: true, tom: "critico" }],
  },
  {
    id: "notas-fiscais", tabela: "notas_fiscais", titulo: "Notas fiscais", singular: "nota fiscal", eyebrow: "Central fiscal",
    descricao: "Notas de serviço (NFS-e) da Arini. Com o Asaas configurado, \"Emitir\" manda a nota para a prefeitura; sem ele, a nota fica registrada para emissão manual.",
    ler: ["financeiro", "diretoria"], escrever: ["financeiro", "diretoria"],
    codigo: "codigo", tituloColuna: "tomador_nome", autorColuna: "criado_por", ordem: { coluna: "created_at" },
    busca: ["tomador_nome", "tomador_doc", "codigo", "numero"],
    status: { coluna: "status", rotulos: NF_STATUS, abertos: ["rascunho", "enviada", "erro"] },
    campos: [
      { nome: "tomador_nome", rotulo: "Tomador (quem recebe a nota)", tipo: "texto", obrigatorio: true },
      { nome: "tomador_doc", rotulo: "CPF ou CNPJ do tomador", tipo: "texto", obrigatorio: true, lista: true },
      { nome: "tomador_email", rotulo: "E-mail do tomador", tipo: "email" },
      { nome: "descricao", rotulo: "Descrição do serviço", tipo: "textarea", obrigatorio: true },
      { nome: "valor", rotulo: "Valor", tipo: "dinheiro", obrigatorio: true, lista: true },
      { nome: "origem", rotulo: "Origem", tipo: "select", opcoes: [["manual", "Avulsa"], ["comissao", "Comissão"], ["mensalidade", "Mensalidade"]], padrao: "manual" },
      { nome: "numero", rotulo: "Número", tipo: "texto", sistema: true, lista: true },
      { nome: "erro", rotulo: "Erro", tipo: "texto", sistema: true },
    ],
    acoes: [
      { id: "emitir", rotulo: "Emitir", quando: ["rascunho", "erro"], tom: "verde" },
      { id: "atualizar", rotulo: "Consultar situação", quando: ["enviada"] },
      { id: "cancelar", rotulo: "Cancelar nota", quando: ["rascunho", "enviada", "emitida", "erro"], pedeMotivo: true, tom: "critico" },
    ],
  },
];

export const PUBLICACAO_STATUS: Record<string, string> = {
  rascunho: "Rascunho", aprovacao: "Esperando aprovação", agendada: "Aprovada e agendada", publicada: "Publicada",
  erro: "Com erro", cancelada: "Cancelada ou retirada",
};
export const CANAIS_PUBLICACAO: [string, string][] = [
  ["instagram", "Instagram"], ["facebook", "Facebook"], ["portais", "Portais (feed XML)"], ["site", "Destaque no site"],
];

RECURSOS.push(
  {
    id: "publicacoes", tabela: "publicacoes", titulo: "Central de publicação", singular: "publicação", eyebrow: "Marketing",
    descricao: "A edição prepara a publicação e manda para aprovação; o tráfego aprova, agenda e publica. Instagram e Facebook saem pela Meta; portais recebem pelo feed XML.",
    ler: ["marketing", "diretoria"], escrever: ["marketing", "diretoria"],
    codigo: "codigo", tituloColuna: "legenda", autorColuna: "criado_por", ordem: { coluna: "created_at" }, busca: ["legenda", "codigo"],
    status: { coluna: "status", rotulos: PUBLICACAO_STATUS, abertos: ["rascunho", "aprovacao", "agendada", "erro"] },
    campos: [
      { nome: "property_id", rotulo: "Imóvel", tipo: "ref", obrigatorio: true, lista: true, soCriar: true,
        ref: { tabela: "properties", rotulo: "codigo", extra: "titulo", filtro: { coluna: "status", valores: ["publicado", "em_negociacao"] } } },
      { nome: "canal", rotulo: "Canal", tipo: "select", obrigatorio: true, lista: true, opcoes: CANAIS_PUBLICACAO },
      { nome: "legenda", rotulo: "Legenda", tipo: "textarea", ajuda: "Vazia: use \"Gerar legenda\" para a IA escrever a partir da ficha." },
      { nome: "agendada_para", rotulo: "Publicar em", tipo: "datahora", lista: true, ajuda: "Vazio: publica assim que for aprovada." },
      { nome: "link_externo", rotulo: "Link", tipo: "texto", sistema: true },
    ],
    acoes: [
      { id: "gerar_legenda", rotulo: "Gerar legenda", quando: ["rascunho", "erro"] },
      { id: "enviar", rotulo: "Enviar para aprovação", quando: ["rascunho", "erro"], tom: "verde" },
      { id: "aprovar", rotulo: "Aprovar", quando: ["aprovacao"], tom: "verde" },
      { id: "devolver", rotulo: "Devolver", quando: ["aprovacao"], pedeMotivo: true },
      { id: "publicar", rotulo: "Publicar agora", quando: ["agendada"], tom: "verde" },
      { id: "cancelar", rotulo: "Cancelar ou retirar", quando: ["rascunho", "aprovacao", "agendada", "publicada", "erro"], pedeMotivo: true, tom: "critico" },
    ],
  },
  {
    id: "campanhas", tabela: "campanhas", titulo: "Campanhas de tráfego", singular: "campanha", eyebrow: "Marketing",
    descricao: "Cada campanha paga com o seu utm_campaign. Os leads que chegam com esse código entram na conta dela em Tráfego e resultados.",
    ler: ["marketing", "diretoria", "financeiro"], escrever: ["marketing", "diretoria"],
    tituloColuna: "nome", autorColuna: "criado_por", ordem: { coluna: "created_at" }, busca: ["nome", "utm_campaign"],
    campos: [
      { nome: "nome", rotulo: "Nome", tipo: "texto", obrigatorio: true },
      { nome: "canal", rotulo: "Canal", tipo: "select", obrigatorio: true, lista: true, opcoes: [["meta", "Meta (Instagram/Facebook)"], ["google", "Google"], ["portal", "Portal"], ["outro", "Outro"]] },
      { nome: "utm_campaign", rotulo: "utm_campaign", tipo: "texto", lista: true, ajuda: "O mesmo código usado no link do anúncio (?utm_campaign=…)." },
      { nome: "property_id", rotulo: "Imóvel (se for de um só)", tipo: "ref", ref: { tabela: "properties", rotulo: "codigo", extra: "titulo", filtro: { coluna: "status", valores: ["publicado", "em_negociacao"] } } },
      { nome: "inicio", rotulo: "Início", tipo: "data", lista: true },
      { nome: "fim", rotulo: "Fim", tipo: "data" },
      { nome: "orcamento", rotulo: "Orçamento", tipo: "dinheiro" },
      { nome: "gasto", rotulo: "Gasto até agora", tipo: "dinheiro", lista: true },
      { nome: "observacoes", rotulo: "Observações", tipo: "textarea" },
      { nome: "ativa", rotulo: "Ativa", tipo: "bool", padrao: true, lista: true },
    ],
  },
);

export const recursoPorId = (id: string) => RECURSOS.find((r) => r.id === id) ?? null;
