/**
 * Roteiros do tour guiado (2ª etapa do cliente, item 14), um por perfil.
 *
 * Cada passo procura o alvo pelo atributo `data-tour` e, enquanto ele não
 * existir no componente, por um seletor de reserva (aria-label, href ou o
 * texto do botão). Quem quiser fixar o alvo só acrescenta `data-tour="<id>"`
 * no elemento: o seletor de reserva deixa de ser usado.
 *
 * Passo `opcional` some quando o alvo não está na tela (ex.: item de menu de
 * outro setor); passo não opcional sem alvo aparece centralizado. Alvo
 * escondido (largura zero, cortado por um pai, fora da janela) não conta: o
 * tour tenta o próximo da lista e nunca destaca um retângulo vazio.
 */
export type PerfilTour = "mapa" | "painel" | "parceiro" | "central";

export type Alvo = string | { seletor: string; texto: string };

export type PassoTour = {
  id: string;
  titulo: string;
  texto: string;
  alvos: Alvo[];
  opcional?: boolean;
  acao?: { rotulo: string; href: string };
};

const dt = (id: string) => `[data-tour="${id}"]`;

const ARI_TOPO = 'button[aria-label^="Pergunte à Ari"]';

const PAINEL_BASE: PassoTour[] = [
  {
    id: "abas", titulo: "Seu painel",
    texto: "Aqui ficam os seus imóveis, as solicitações ao mapa, a organização e a sua conta. Cada anúncio mostra em que ponto está a análise da Arini.",
    alvos: [dt("abas-painel"), 'nav[aria-label="Área do cliente"]'],
  },
  {
    id: "anunciar", titulo: "Anunciar um imóvel",
    texto: "O cadastro é em etapas. Para ir mais rápido, use o cadastro com a Ari: cole a descrição, anexe fotos e documentos, e o formulário abre preenchido para você conferir.",
    alvos: [dt("anunciar"), 'nav[aria-label="Área do cliente"] a[href="/painel/novo"]', 'a[href="/painel/novo"]'],
  },
  {
    id: "mapa", titulo: "Mapa interativo",
    texto: "No mapa você busca imóveis, liga camadas (CAR, embargos, queimadas), desenha e mede áreas. Use para marcar a divisa do seu imóvel.",
    alvos: [dt("mapa"), 'aside a[href="/mapa"]', 'a[href="/mapa"]'], opcional: true,
  },
  {
    id: "ari", titulo: "Pergunte à Ari",
    texto: "A Ari é a assistente da Arini. Pergunte sobre imóveis publicados, o CAR, documentos e como usar o sistema.",
    alvos: [dt("ari"), ARI_TOPO],
  },
  {
    id: "suporte", titulo: "Ajuda e suporte",
    texto: "Dúvidas? A Central de ajuda tem o passo a passo de cada ferramenta, e o Suporte fala com a equipe. Este tour volta pelo botão Ajuda.",
    alvos: [dt("ajuda"), dt("suporte"), 'nav[aria-label="Área do cliente"] a[href="/suporte"]'],
  },
];

export const PASSOS_TOUR: Record<PerfilTour, PassoTour[]> = {
  mapa: [
    {
      id: "busca", titulo: "Busca",
      texto: "Procure por município, código do anúncio (AIB-000000) ou nome do imóvel. Os resultados aparecem na lista e no mapa.",
      // no celular a lista começa recolhida e o campo não aparece: vale o chip
      // "Buscar imóveis" e, se ele estiver no menu, o botão "Mais"
      alvos: [dt("busca"), 'input[aria-label="Buscar imóveis"]', 'form[role="search"] input',
        'button[title^="Abrir a lista com a busca"]', dt("mais")],
    },
    {
      id: "camadas", titulo: "Camadas e dados",
      texto: "Ligue as camadas oficiais: CAR, embargos ambientais, focos de queimada, processos minerários, biomas. Clique numa área para ver o que há nela.",
      alvos: [dt("camadas"), { seletor: "button", texto: "Camadas e Dados" }],
    },
    {
      id: "medir", titulo: "Desenhar e medir",
      texto: "Meça área e distância com precisão de campo, importe um KML ou desenhe uma área para consultar as fontes oficiais.",
      alvos: [dt("medir"), { seletor: "button", texto: "Medir Área" }],
    },
    {
      id: "ari", titulo: "Pergunte à Ari",
      texto: "Peça em linguagem natural: \"fazendas acima de 50 ha em Iturama\" ou \"o CAR comprova a propriedade?\". A Ari responde com os dados publicados.",
      alvos: [dt("ari"), { seletor: "button", texto: "pergunte à IA" }, ARI_TOPO],
    },
    {
      id: "anunciar", titulo: "Anuncie o seu imóvel",
      texto: "Tem um imóvel na região? Clique na área do CAR ou no lote e escolha \"Esta área é minha\", ou comece o anúncio pelo painel. A Arini confere tudo antes de publicar.",
      alvos: [dt("anunciar"), 'a[href="/painel/novo"]'],
      acao: { rotulo: "Anunciar meu imóvel", href: "/painel/novo" },
    },
  ],
  painel: PAINEL_BASE,
  parceiro: [
    ...PAINEL_BASE.slice(0, 2),
    {
      id: "oportunidades", titulo: "Oportunidades",
      texto: "Os interessados que a Arini encaminha para você aparecem aqui, com o histórico de visitas e propostas.",
      alvos: [dt("oportunidades"), 'nav[aria-label="Área do cliente"] a[href="/painel/oportunidades"]'], opcional: true,
    },
    ...PAINEL_BASE.slice(2),
  ],
  central: [
    {
      id: "menu", titulo: "Menu da Central",
      texto: "Os setores em que você atua ficam agrupados aqui. O número ao lado de cada item mostra o que está esperando.",
      alvos: [dt("menu-central"), 'nav[aria-label="Menu da Central"]'],
    },
    {
      id: "tarefas", titulo: "Tarefas",
      texto: "Tudo o que precisa de alguém da equipe vira tarefa: análise de anúncio, demanda casada, solicitação do mapa.",
      alvos: [dt("tarefas"), 'nav[aria-label="Menu da Central"] a[href="/admin/tarefas"]'], opcional: true,
    },
    {
      id: "imoveis", titulo: "Análise de anúncios",
      texto: "Cada anúncio passa pelo checklist: documentos, divisa e consulta territorial. Daqui sai a decisão de aprovar, pedir correção ou publicar.",
      alvos: [dt("imoveis"), 'nav[aria-label="Menu da Central"] a[href="/admin/imoveis"]'], opcional: true,
    },
    {
      id: "conhecimento", titulo: "Base de conhecimento da Ari",
      texto: "O que a Ari sabe responder vem daqui. As perguntas que ela não soube aparecem na fila para virar artigo.",
      alvos: [dt("conhecimento"), 'nav[aria-label="Menu da Central"] a[href="/admin/conhecimento"]'], opcional: true,
    },
    {
      id: "mapa", titulo: "Mapa público",
      texto: "Veja o mapa como o cliente vê: busca, camadas, desenho e medição.",
      alvos: [dt("mapa"), 'a[href="/mapa"][title="Ver mapa público"]'], opcional: true,
    },
  ],
};
