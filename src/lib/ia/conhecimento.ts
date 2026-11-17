/**
 * Base de conhecimento (PENDÊNCIA 5.2): validação dos artigos. Sem
 * "server-only" — o editor usa os mesmos rótulos e limites.
 */

export const STATUS_ARTIGO = ["rascunho", "publicado", "arquivado"] as const;
export type StatusArtigo = (typeof STATUS_ARTIGO)[number];

export const STATUS_ARTIGO_LABEL: Record<StatusArtigo, string> = {
  rascunho: "Rascunho", publicado: "Publicado", arquivado: "Arquivado",
};
export const STATUS_ARTIGO_COR: Record<StatusArtigo, string> = {
  rascunho: "bg-alerta/15 text-alerta", publicado: "bg-verde/15 text-verde", arquivado: "bg-superficie-2 text-texto-2",
};

export type Artigo = {
  id: string; slug: string; titulo: string; conteudo: string; fonte: string;
  data_referencia: string; status: StatusArtigo; versao: number; updated_at: string;
};

/**
 * Pergunta que o assistente não soube responder (ferramenta registrar_lacuna,
 * tabela ia_lacunas). Agrupada pela forma normalizada; `ocorrencias` diz
 * quantas vezes foi feita. Vira "respondida" quando um artigo PUBLICADO é
 * ligado a ela — artigo em rascunho fica ligado, mas a pergunta segue pendente.
 */
export const STATUS_LACUNA = ["pendente", "respondida", "descartada"] as const;
export type StatusLacuna = (typeof STATUS_LACUNA)[number];
export type Lacuna = {
  id: string; pergunta: string; motivo: string | null; ocorrencias: number;
  primeira_em: string; ultima_em: string; status: StatusLacuna; artigo_id: string | null;
};

/** Tamanho máximo do conteúdo de um artigo. Era 20 mil; o Carlos pediu mais (áudio de 17/11/2026). */
export const CONTEUDO_MAX = 200_000;
/** Quanto do artigo o assistente recebe por consulta (os trechos que casam com a pergunta). */
export const LEITURA_ASSISTENTE = 8_000;

/**
 * Artigo curto vai inteiro. Artigo longo vai com o começo e os parágrafos que
 * citam os termos da pergunta, até LEITURA_ASSISTENTE caracteres.
 */
export function trechosParaAssistente(conteudo: string, consulta: string, max = LEITURA_ASSISTENTE): string {
  if (conteudo.length <= max) return conteudo;
  const sem = (t: string) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const termos = [...new Set(sem(consulta).split(/[^a-z0-9]+/).filter((t) => t.length >= 3))];
  const paragrafos = conteudo.split(/\n\s*\n/);
  const inicio = paragrafos[0].slice(0, 1_500);
  const pontuados = paragrafos.slice(1).map((p, i) => {
    const n = sem(p);
    return { i, p, pontos: termos.reduce((s, t) => s + (n.includes(t) ? 1 : 0), 0) };
  }).filter((x) => x.pontos > 0).sort((a, b) => b.pontos - a.pontos || a.i - b.i);
  const escolhidos: typeof pontuados = [];
  let usado = inicio.length;
  for (const x of pontuados) {
    const p = x.p.length > 3_000 ? x.p.slice(0, 3_000) + " …" : x.p;
    if (usado + p.length + 5 > max) continue;
    escolhidos.push({ ...x, p }); usado += p.length + 5;
  }
  if (!escolhidos.length) return conteudo.slice(0, max) + " …";
  return [inicio, ...escolhidos.sort((a, b) => a.i - b.i).map((x) => x.p)].join("\n\n[…]\n\n");
}

export const slugDe =(titulo: string) =>
  titulo.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);

/** Valida e normaliza um artigo vindo do formulário. Erro = string. */
export function validarArtigo(b: Record<string, unknown>): { dados: Omit<Artigo, "id" | "versao" | "updated_at"> } | { erro: string } {
  const titulo = String(b.titulo ?? "").trim();
  const conteudo = String(b.conteudo ?? "").trim();
  const fonte = String(b.fonte ?? "").trim();
  const data = String(b.data_referencia ?? "").trim();
  const status = String(b.status ?? "rascunho") as StatusArtigo;
  const slug = (String(b.slug ?? "").trim() || slugDe(titulo)).slice(0, 80);
  if (titulo.length < 3 || titulo.length > 200) return { erro: "Título: entre 3 e 200 caracteres." };
  if (!/^[a-z0-9][a-z0-9-]{2,80}$/.test(slug)) return { erro: "Identificador: só letras minúsculas, números e hífen (mínimo 3)." };
  if (conteudo.length > CONTEUDO_MAX) return { erro: `Conteúdo: no máximo ${CONTEUDO_MAX.toLocaleString("pt-BR")} caracteres.` };
  if (!STATUS_ARTIGO.includes(status)) return { erro: "Situação inválida." };
  if (status === "publicado" && (!conteudo || !fonte)) return { erro: "Para publicar, preencha o conteúdo e a fonte." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return { erro: "Data de referência inválida." };
  return { dados: { slug, titulo, conteudo, fonte, data_referencia: data, status } };
}
