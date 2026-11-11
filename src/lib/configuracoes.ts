/**
 * Registro central das configurações do sistema.
 *
 * Uma configuração nova = uma linha aqui. A tela do admin e a rota de
 * gravação são geradas a partir deste registro, então rótulo, ajuda,
 * tipo e validação ficam num lugar só e nunca saem de sincronia.
 *
 * Regra: só entra aqui o que REALMENTE muda o comportamento do sistema.
 */

export type TipoCampo = "texto" | "textarea" | "numero" | "dinheiro" | "percentual" | "email" | "telefone" | "lista" | "coordenada" | "sim_nao";

export type Campo = {
  chave: string;
  rotulo: string;
  ajuda?: string;
  tipo: TipoCampo;
  padrao: string | number | string[] | boolean;
  min?: number;
  max?: number;
  sufixo?: string;
  somenteDiretoria?: boolean;
};

export type Grupo = {
  id: string;
  titulo: string;
  descricao: string;
  icone: string;
  campos: Campo[];
};

export const GRUPOS: Grupo[] = [
  {
    id: "marca",
    titulo: "Marca e contato",
    descricao: "Como o sistema se apresenta e por onde a Arini fala com o cliente.",
    icone: "🏷️",
    campos: [
      { chave: "nome_sistema", rotulo: "Nome do sistema", tipo: "texto", padrao: "Arini Imóveis Brasil",
        ajuda: "Aparece no topo do site, nos e-mails e no título das páginas." },
      { chave: "whatsapp_central", rotulo: "WhatsApp da central", tipo: "telefone", padrao: "553499745140",
        ajuda: "Botão “Chamar no WhatsApp” em cada anúncio. Use DDI+DDD+número, só dígitos." },
      { chave: "notify_email", rotulo: "E-mail que recebe os leads", tipo: "email", padrao: "",
        ajuda: "Toda demonstração de interesse chega neste endereço." },
      { chave: "email_contato", rotulo: "E-mail público de contato", tipo: "email", padrao: "",
        ajuda: "Exibido no rodapé do site." },
      { chave: "telefone_contato", rotulo: "Telefone público", tipo: "texto", padrao: "",
        ajuda: "Exibido no rodapé do site." },
    ],
  },
  {
    id: "site",
    titulo: "Página inicial",
    descricao: "Os textos que o visitante lê antes de entrar no mapa.",
    icone: "🖥️",
    campos: [
      { chave: "hero_eyebrow", rotulo: "Linha de topo", tipo: "texto", padrao: "Pontal do Triângulo Mineiro",
        ajuda: "Texto pequeno acima do título principal." },
      { chave: "hero_titulo", rotulo: "Título principal", tipo: "texto", padrao: "Seu próximo negócio imobiliário,",
        ajuda: "Primeira parte do título (fica em branco)." },
      { chave: "hero_destaque", rotulo: "Destaque do título", tipo: "texto", padrao: "começa no mapa.",
        ajuda: "Segunda parte, exibida em dourado." },
      { chave: "hero_subtitulo", rotulo: "Texto de apoio", tipo: "textarea",
        padrao: "Encontre imóveis urbanos e rurais e explore suas localizações no mapa, com os limites reais das propriedades sobre imagens de satélite, áreas medidas, tours 3D e pontos de interesse ao redor. Viva a experiência ARINI." },
      { chave: "sobre_titulo", rotulo: "Sobre a empresa — título", tipo: "texto", padrao: "Conheça a Arini",
        ajuda: "Título da seção institucional da página inicial." },
      { chave: "sobre_texto", rotulo: "Sobre a empresa — texto", tipo: "textarea",
        padrao: "A ARINI nasceu da experiência com o mercado imobiliário e da vontade de fazer diferente. Acreditamos que encontrar um imóvel vai muito além de uma negociação. Envolve sonhos, decisões importantes, investimentos e novos caminhos.\nPor isso, conectamos tecnologia, informação e conhecimento imobiliário para aproximar pessoas de oportunidades, tornando cada experiência mais simples, transparente e segura.\nEstamos construindo uma nova forma de explorar o mercado imobiliário, conectando territórios, pessoas e possibilidades.",
        ajuda: "Parágrafo institucional. Quebra de linha vira parágrafo novo." },
      { chave: "sobre_site", rotulo: "Site institucional", tipo: "texto", padrao: "https://arininegociosimobiliarios.com.br",
        ajuda: "Link exibido na seção institucional e no rodapé. Deixe vazio para ocultar." },
    ],
  },
  {
    id: "comercial",
    titulo: "Regras comerciais",
    descricao: "Comissão, mensalidade do anúncio e prazo de inadimplência.",
    icone: "💰",
    campos: [
      { chave: "comissao_percentual_padrao", rotulo: "Comissão padrão", tipo: "percentual", padrao: 1.9, min: 0, max: 100, sufixo: "%",
        ajuda: "Sugerida ao registrar uma venda; pode ser ajustada caso a caso.", somenteDiretoria: true },
      { chave: "mensalidade_valor_padrao", rotulo: "Mensalidade do anúncio", tipo: "dinheiro", padrao: 0, min: 0, sufixo: "R$",
        ajuda: "Cobrada por imóvel publicado. Zero = anúncio gratuito.", somenteDiretoria: true },
      { chave: "suspensao_dias", rotulo: "Tolerância de atraso", tipo: "numero", padrao: 15, min: 1, max: 180, sufixo: "dias",
        ajuda: "Depois disso, “Processar inadimplência” marca a fatura como vencida." },
      { chave: "regra_comissao_texto", rotulo: "Regra contratual da comissão", tipo: "textarea",
        padrao: "1,9% sobre o valor da operação, conforme contrato de intermediação.",
        ajuda: "Texto gravado junto de cada comissão registrada." },
      { chave: "demandas_tolerancia_pct", rotulo: "Folga ao casar demandas", tipo: "percentual", padrao: 10, min: 0, max: 100, sufixo: "%",
        ajuda: "Quando um imóvel é publicado, ele casa com uma demanda aberta se o valor e a área estiverem na faixa pedida, com esta folga para cada lado." },
    ],
  },
  {
    id: "central",
    titulo: "Central operacional",
    descricao: "Prazos das tarefas entre setores, do rodízio de leads e das automações (migration 0065).",
    icone: "🧭",
    campos: [
      { chave: "tarefa_aceite_horas", rotulo: "Prazo para assumir uma tarefa encaminhada", tipo: "numero", padrao: 24, min: 1, max: 720, sufixo: "horas",
        ajuda: "Se ninguém do setor aceitar nesse prazo, a tarefa sobe para a Diretoria." },
      { chave: "rodizio_minutos", rotulo: "Prazo do primeiro atendimento do lead", tipo: "numero", padrao: 30, min: 5, max: 1440, sufixo: "min",
        ajuda: "Sem primeiro contato nesse prazo, o lead passa para o próximo corretor do rodízio." },
      { chave: "rodizio_max_repasses", rotulo: "Repasses antes de chamar a gerência", tipo: "numero", padrao: 3, min: 1, max: 10, sufixo: "vezes",
        ajuda: "Depois disso, o lead vira tarefa de alta prioridade do Comercial." },
      { chave: "visita_relatorio_horas", rotulo: "Prazo do relatório depois da visita", tipo: "numero", padrao: 3, min: 1, max: 72, sufixo: "horas",
        ajuda: "Passado esse tempo sem relatório, o sistema cria a tarefa para o corretor." },
      { chave: "cadastro_parado_dias", rotulo: "Cadastro parado em análise", tipo: "numero", padrao: 2, min: 1, max: 60, sufixo: "dias",
        ajuda: "Imóvel aguardando análise por mais tempo que isso vira tarefa de Operações." },
    ],
  },
  {
    id: "juridico",
    titulo: "Dados jurídicos",
    descricao: "Qualificação da empresa e prazos que entram nos termos de uso, na autorização de venda e na regra de remuneração.",
    icone: "⚖️",
    campos: [
      { chave: "juridico_razao_social", rotulo: "Razão social", tipo: "texto", padrao: "Arini Negócios Imobiliários",
        ajuda: "Exatamente como no CNPJ. Aparece como parte nos termos." },
      { chave: "juridico_cnpj", rotulo: "CNPJ", tipo: "texto", padrao: "", somenteDiretoria: true,
        ajuda: "Enquanto vazio, os termos publicados mostram um aviso de campo a preencher." },
      { chave: "juridico_creci", rotulo: "CRECI da empresa (CRECI-J)", tipo: "texto", padrao: "", somenteDiretoria: true },
      { chave: "juridico_endereco", rotulo: "Endereço da sede", tipo: "texto", padrao: "", somenteDiretoria: true,
        ajuda: "Rua, número, bairro, cidade/UF e CEP." },
      { chave: "juridico_foro", rotulo: "Comarca do foro", tipo: "texto", padrao: "", somenteDiretoria: true,
        ajuda: "Ex.: Iturama/MG. Em geral, a comarca da sede." },
      { chave: "juridico_encarregado_email", rotulo: "E-mail do encarregado de dados (LGPD)", tipo: "email", padrao: "",
        ajuda: "Canal para pedidos de acesso, correção e exclusão de dados. Vazio = usa o e-mail público de contato." },
      { chave: "juridico_selfie_exclusividade", rotulo: "Selfie no aceite da exclusividade", tipo: "sim_nao", padrao: true, somenteDiretoria: true,
        ajuda: "Com “Sim”, o proprietário tira uma selfie ao aceitar a exclusividade. A foto fica no cofre de documentos, só para conferência — não há reconhecimento facial." },
      { chave: "juridico_prazo_autorizacao_dias", rotulo: "Prazo da autorização de venda", tipo: "numero", padrao: 180, min: 30, max: 730, sufixo: "dias",
        ajuda: "Vale para a autorização e para a exclusividade. Renova automaticamente enquanto o anúncio estiver ativo.", somenteDiretoria: true },
      { chave: "juridico_protecao_meses", rotulo: "Proteção contra venda por fora", tipo: "numero", padrao: 12, min: 0, max: 36, sufixo: "meses",
        ajuda: "Por quanto tempo depois do fim da autorização a comissão continua devida se o imóvel for vendido a um interessado apresentado pela Arini.", somenteDiretoria: true },
    ],
  },
  {
    id: "seguranca",
    titulo: "Segurança",
    descricao: "Regras de acesso da equipe. As contas de clientes escolhem o segundo fator por conta própria.",
    icone: "⛨",
    campos: [
      { chave: "seguranca_mfa_equipe", rotulo: "Exigir segundo fator da equipe", tipo: "sim_nao", padrao: false, somenteDiretoria: true,
        ajuda: "Com “Sim”, ninguém da equipe entra na Central sem o código do aplicativo autenticador. Ative o seu próprio em Minha segurança antes de ligar." },
      { chave: "seguranca_sessao_equipe_horas", rotulo: "Sessão da equipe expira em", tipo: "numero", padrao: 12, min: 1, max: 720, sufixo: "horas", somenteDiretoria: true,
        ajuda: "Depois desse tempo desde o login, a Central pede a senha de novo. Evita sessão administrativa aberta para sempre num computador." },
      // Retenção e descarte (item 6.4). Os prazos dependem da decisão 8.9 (Carlos + jurídico):
      // até lá ficam em 0 = não descartar, e a rotina só simula.
      { chave: "retencao_selfie_dias", rotulo: "Guardar a selfie do aceite por", tipo: "numero", padrao: 0, min: 0, max: 3650, sufixo: "dias", somenteDiretoria: true,
        ajuda: "Contados a partir do fim da autorização de venda. 0 = não descartar. Aguarda a decisão 8.9 (Carlos e jurídico) sobre finalidade e prazo de guarda." },
      { chave: "retencao_docs_reprovados_dias", rotulo: "Guardar documentos de anúncio reprovado por", tipo: "numero", padrao: 0, min: 0, max: 3650, sufixo: "dias", somenteDiretoria: true,
        ajuda: "Matrícula, edital e demais documentos de anúncios reprovados, contados da reprovação. 0 = não descartar. Aguarda a decisão 8.9." },
      { chave: "retencao_logs_acesso_dias", rotulo: "Guardar registros de acesso por", tipo: "numero", padrao: 0, min: 0, max: 3650, sufixo: "dias", somenteDiretoria: true,
        ajuda: "Entradas e tentativas de login, aberturas de documentos, tentativas bloqueadas, consultas de área e alertas. O Marco Civil da Internet (art. 15) exige no mínimo 6 meses (180 dias). 0 = não descartar. Aguarda a decisão 8.9." },
      { chave: "retencao_executar", rotulo: "Descartar de verdade", tipo: "sim_nao", padrao: false, somenteDiretoria: true,
        ajuda: "Com “Não”, a rotina diária só simula e registra o que seria apagado (Segurança › Retenção). Ligue só depois de conferir a simulação: arquivo descartado não volta." },
    ],
  },
  {
    id: "inteligencia",
    titulo: "Inteligência (IA e avaliação)",
    descricao: "Assistente de IA, pré-avaliação de valor e aptidão territorial. A metodologia está em docs/PRE-AVALIACAO.md e depende da aprovação da Arini (decisão 8.4).",
    icone: "✦",
    campos: [
      { chave: "ia_chat_ativo", rotulo: "Assistente de IA no site", tipo: "sim_nao", padrao: true, somenteDiretoria: true,
        ajuda: "Liga o botão do assistente nas páginas públicas e no painel. Ele só funciona com a chave ANTHROPIC_API_KEY no servidor; sem ela aparece “Assistente em configuração”." },
      { chave: "pre_avaliacao_ativa", rotulo: "Pré-avaliação de valor para clientes", tipo: "sim_nao", padrao: false, somenteDiretoria: true,
        ajuda: "Com “Sim”, contas cujo plano tem “Pré-avaliação” veem a estimativa na ficha do imóvel. A equipe da Matriz sempre pode testar na ficha da Central." },
      { chave: "aptidao_ativa", rotulo: "Aptidão territorial para clientes", tipo: "sim_nao", padrao: false, somenteDiretoria: true,
        ajuda: "Indicação qualitativa (lavoura / pecuária / restrições) para imóveis rurais, com os fatores e os dados que faltam. Sem números de rentabilidade." },
      { chave: "pre_avaliacao_min_comparaveis", rotulo: "Mínimo de comparáveis", tipo: "numero", padrao: 5, min: 3, max: 30, sufixo: "imóveis", somenteDiretoria: true,
        ajuda: "Abaixo disso a pré-avaliação responde “dados insuficientes” em vez de estimar." },
      { chave: "pre_avaliacao_raio_km", rotulo: "Raio para comparáveis de municípios vizinhos", tipo: "numero", padrao: 60, min: 10, max: 200, sufixo: "km", somenteDiretoria: true,
        ajuda: "Distância entre as sedes municipais. Os do mesmo município têm prioridade." },
    ],
  },
  {
    id: "mapa",
    titulo: "Mapa e território",
    descricao: "Onde o mapa abre e o alcance da busca de pontos de interesse.",
    icone: "🗺️",
    campos: [
      { chave: "mapa_centro_lng", rotulo: "Longitude inicial", tipo: "coordenada", padrao: -50.196,
        ajuda: "Centro do mapa quando alguém abre o site." },
      { chave: "mapa_centro_lat", rotulo: "Latitude inicial", tipo: "coordenada", padrao: -19.728 },
      { chave: "mapa_zoom_inicial", rotulo: "Zoom inicial", tipo: "numero", padrao: 9, min: 3, max: 18,
        ajuda: "9 mostra a região inteira; 13 mostra uma cidade." },
      { chave: "poi_raio_rural_m", rotulo: "Raio de busca — rural", tipo: "numero", padrao: 15000, min: 1000, max: 60000, sufixo: "m",
        ajuda: "Distância para procurar postos, escolas e acessos ao redor de imóveis rurais." },
      { chave: "poi_raio_urbano_m", rotulo: "Raio de busca — urbano", tipo: "numero", padrao: 4000, min: 500, max: 20000, sufixo: "m" },
      { chave: "poi_categorias", rotulo: "Categorias de ponto de interesse", tipo: "lista",
        padrao: ["combustivel", "farmacia", "supermercado", "hospital", "escola", "centro", "acesso_rodovia"],
        ajuda: "Uma por linha. Vale para os próximos imóveis publicados." },
      { chave: "poi_atualizar_dias", rotulo: "Atualizar pontos de interesse a cada", tipo: "numero", padrao: 90, min: 7, max: 730, sufixo: "dias",
        ajuda: "Anúncios ativos com pontos de interesse mais antigos que isso voltam para a fila de atualização (OpenStreetMap)." },
    ],
  },
];

export const TODOS_CAMPOS: Campo[] = GRUPOS.flatMap((g) => g.campos);
export const CHAVES_VALIDAS = new Set(TODOS_CAMPOS.map((c) => c.chave));

/** Normaliza e valida um valor conforme o tipo declarado. Erro = string. */
export function validarCampo(campo: Campo, bruto: unknown): { valor: unknown } | { erro: string } {
  if (campo.tipo === "lista") {
    const itens = Array.isArray(bruto)
      ? bruto.map(String)
      : String(bruto ?? "").split("\n").map((s) => s.trim()).filter(Boolean);
    return { valor: itens };
  }

  if (campo.tipo === "sim_nao") {
    return { valor: bruto === true || bruto === "true" || bruto === "sim" };
  }

  if (["numero", "dinheiro", "percentual", "coordenada"].includes(campo.tipo)) {
    const n = typeof bruto === "number" ? bruto : Number(String(bruto ?? "").replace(",", "."));
    if (!Number.isFinite(n)) return { erro: `${campo.rotulo}: informe um número.` };
    if (campo.min != null && n < campo.min) return { erro: `${campo.rotulo}: mínimo ${campo.min}.` };
    if (campo.max != null && n > campo.max) return { erro: `${campo.rotulo}: máximo ${campo.max}.` };
    return { valor: n };
  }

  const s = String(bruto ?? "").trim();
  if (campo.tipo === "email" && s && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) {
    return { erro: `${campo.rotulo}: e-mail inválido.` };
  }
  if (campo.tipo === "telefone" && s && !/^\d{10,15}$/.test(s.replace(/\D/g, ""))) {
    return { erro: `${campo.rotulo}: use DDI+DDD+número, só dígitos (ex.: 553499745140).` };
  }
  return { valor: campo.tipo === "telefone" ? s.replace(/\D/g, "") : s };
}

/** Lê settings do banco aplicando os padrões do registro. */
export function comPadroes(linhas: { chave: string; valor: unknown }[]): Record<string, unknown> {
  const mapa = Object.fromEntries(linhas.map((l) => [l.chave, l.valor]));
  const saida: Record<string, unknown> = {};
  for (const campo of TODOS_CAMPOS) {
    const v = mapa[campo.chave];
    saida[campo.chave] = v === undefined || v === null || v === "" ? campo.padrao : v;
  }
  return saida;
}
