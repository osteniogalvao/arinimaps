/**
 * Tags e pixels do Marketing (migration 0172). Regras compartilhadas entre o
 * admin (cadastro e teste de endereço) e o site (qual código carrega em qual
 * página). Sem dependência de servidor.
 *
 * Caminhos aceitos:
 *   "/mapa"           só a página /mapa
 *   "/imovel/**"      /imovel e todas as subpáginas (/imovel/ABC, /imovel/ABC/tour…)
 *   "/imovel/*\/tour"  o * vale um trecho do endereço (qualquer código de imóvel)
 */

export type PosicaoTag = "head" | "body_inicio" | "body_fim";

export const POSICOES: { id: PosicaoTag; rotulo: string; ajuda: string }[] = [
  { id: "head", rotulo: "Dentro do <head>", ajuda: "Onde vão o Google Tag Manager (parte 1), o Google Analytics, o Meta Pixel e o TikTok." },
  { id: "body_inicio", rotulo: "Logo depois de abrir o <body>", ajuda: "Onde vai a parte 2 do Google Tag Manager (o <noscript>)." },
  { id: "body_fim", rotulo: "No fim do <body>", ajuda: "Para chats, widgets e scripts que podem carregar por último." },
];

/** O que o site recebe de cada código ativo (nome e auditoria ficam no admin). */
export type TagAtiva = {
  id: string;
  codigo: string;
  posicao: PosicaoTag;
  todas_paginas: boolean;
  paginas: string[];
  excluir: string[];
};

export type TagMarketing = TagAtiva & {
  nome: string;
  ativo: boolean;
  observacao: string;
  updated_at: string;
};

/** Páginas do sistema oferecidas na lista (o usuário ainda pode digitar outro caminho). */
export type PaginaSistema = { caminho: string; rotulo: string; subpaginas?: string; grupo: string };

export const PAGINAS_SISTEMA: PaginaSistema[] = [
  { grupo: "Site", caminho: "/", rotulo: "Página inicial" },
  { grupo: "Site", caminho: "/mapa", rotulo: "Mapa" },
  { grupo: "Site", caminho: "/imoveis", rotulo: "Lista de imóveis" },
  { grupo: "Site", caminho: "/imovel", rotulo: "Página de cada imóvel", subpaginas: "tour 3D, relatório, financiamento, espelho" },
  { grupo: "Site", caminho: "/vendidos", rotulo: "Vendidos", subpaginas: "página de cada venda" },
  { grupo: "Site", caminho: "/planos", rotulo: "Planos e preços", subpaginas: "solicitações" },
  { grupo: "Site", caminho: "/mercado", rotulo: "Mercado e cotações" },
  { grupo: "Site", caminho: "/relatorios", rotulo: "Relatórios" },
  { grupo: "Site", caminho: "/consulta", rotulo: "Consultas", subpaginas: "CAR, área desenhada, lote" },
  { grupo: "Site", caminho: "/ferramentas", rotulo: "Ferramentas", subpaginas: "matrícula" },
  { grupo: "Site", caminho: "/cartografia", rotulo: "Cartografia", subpaginas: "solicitar planta" },
  { grupo: "Site", caminho: "/divulgador", rotulo: "Programa de divulgadores" },
  { grupo: "Site", caminho: "/expansao", rotulo: "Expansão" },
  { grupo: "Site", caminho: "/balcao", rotulo: "Balcão" },
  { grupo: "Site", caminho: "/ajuda", rotulo: "Ajuda" },
  { grupo: "Site", caminho: "/suporte", rotulo: "Suporte" },
  { grupo: "Site", caminho: "/termos", rotulo: "Termos e políticas", subpaginas: "cada documento" },
  { grupo: "Site", caminho: "/contato-perfil", rotulo: "Contato do perfil" },
  { grupo: "Entrada", caminho: "/entrar", rotulo: "Entrar e criar conta" },
  { grupo: "Entrada", caminho: "/acesso", rotulo: "Escolha de acesso" },
  { grupo: "Entrada", caminho: "/redefinir-senha", rotulo: "Redefinir senha" },
  { grupo: "Área do cliente", caminho: "/painel", rotulo: "Painel do anunciante", subpaginas: "imóveis, CRM, cofre, território…" },
  { grupo: "Área do cliente", caminho: "/conta", rotulo: "Minha conta", subpaginas: "créditos, perfis, segurança…" },
];

/** Prefixos que nunca recebem código de terceiros (dados da equipe e APIs). */
export const CAMINHOS_PROIBIDOS = ["/admin", "/api"];

export const LIMITE_CODIGO = 20_000;
export const LIMITE_CAMINHOS = 60;

const RE_CAMINHO = /^\/(?:[A-Za-z0-9._~*-]+(?:\/[A-Za-z0-9._~*-]+)*)?$/;

/** Limpa o que o usuário digitou: tira domínio, ?busca, #âncora e a barra final. null = inválido. */
export function normalizarRegra(entrada: string): string | null {
  let s = entrada.trim();
  if (!s) return null;
  s = s.replace(/^https?:\/\/[^/]+/i, "").replace(/[?#].*$/, "");
  if (!s.startsWith("/")) s = "/" + s;
  const sub = s.endsWith("/**");
  let base = sub ? s.slice(0, -3) : s;
  if (base.length > 1) base = base.replace(/\/+$/, "");
  if (base === "") base = "/";
  if (base.length > 200 || !RE_CAMINHO.test(base) || base.includes("**")) return null;
  return sub ? (base === "/" ? "/**" : base + "/**") : base;
}

/** Endereço da página, sem ?busca, #âncora e barra final. */
export function normalizarCaminho(caminho: string) {
  const s = caminho.replace(/[?#].*$/, "");
  return s.length > 1 ? s.replace(/\/+$/, "") || "/" : s || "/";
}

const cacheRegex = new Map<string, RegExp>();
function regexDe(regra: string) {
  let re = cacheRegex.get(regra);
  if (!re) {
    const sub = regra.endsWith("/**");
    const base = sub ? regra.slice(0, -3) : regra;
    const corpo = base.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]+");
    re = new RegExp("^" + (sub ? (corpo === "" ? "(?:/.*)?" : corpo + "(?:/.*)?") : corpo) + "$");
    cacheRegex.set(regra, re);
  }
  return re;
}

/** A regra vale para este endereço? */
export function regraCasa(regra: string, caminho: string) {
  return regexDe(regra).test(normalizarCaminho(caminho));
}

export function caminhoProibido(caminho: string) {
  const c = normalizarCaminho(caminho);
  return CAMINHOS_PROIBIDOS.some((p) => c === p || c.startsWith(p + "/"));
}

/** O código carrega nesta página? Exclusão sempre vence. */
export function tagValeEm(tag: Pick<TagAtiva, "todas_paginas" | "paginas" | "excluir">, caminho: string) {
  if (caminhoProibido(caminho)) return false;
  if (tag.excluir.some((r) => regraCasa(r, caminho))) return false;
  return tag.todas_paginas || tag.paginas.some((r) => regraCasa(r, caminho));
}

/** Resumo para a lista do admin: "Todas as páginas, menos /entrar". */
export function resumoOnde(tag: Pick<TagAtiva, "todas_paginas" | "paginas" | "excluir">) {
  const nomes = (lista: string[]) => lista.map(rotuloRegra).join(", ");
  const base = tag.todas_paginas ? "Todas as páginas" : `Só em: ${nomes(tag.paginas)}`;
  return tag.excluir.length ? `${base} · menos ${nomes(tag.excluir)}` : base;
}

export function rotuloRegra(regra: string) {
  const sub = regra.endsWith("/**");
  const base = sub ? regra.slice(0, -3) || "/" : regra;
  const p = PAGINAS_SISTEMA.find((x) => x.caminho === base);
  const nome = p ? p.rotulo : base;
  return sub ? `${nome} (e subpáginas)` : nome;
}

/**
 * Problemas que impedem salvar o código. document.write depois que a página
 * já carregou apaga a tela inteira, e os códigos aqui entram depois do
 * carregamento (é o que permite valer também na navegação entre páginas).
 */
export function problemaNoCodigo(codigo: string): string | null {
  if (!codigo.trim()) return "Cole o código fornecido pela ferramenta.";
  if (codigo.length > LIMITE_CODIGO) return `O código passa de ${LIMITE_CODIGO.toLocaleString("pt-BR")} caracteres.`;
  if (/document\s*\.\s*write(ln)?\s*\(/.test(codigo))
    return "Este código usa document.write, que apaga a página quando carrega depois dela. Peça à ferramenta a versão assíncrona (async) do código.";
  if (!/<[a-z!]/i.test(codigo))
    return "Cole o código completo, com as tags <script>, <noscript>, <meta> ou <link> como a ferramenta entrega.";
  return null;
}
