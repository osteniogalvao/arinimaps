/**
 * Alteração de anúncio publicado (Fluxograma §9): os campos que o anunciante
 * pode propor mudar depois da publicação. Ficam em `property_revisions` até a
 * Matriz decidir; só então entram em `properties`. Compartilhado entre o
 * servidor (validação e aplicação) e os formulários.
 */
import { validarCampoTour } from "@/lib/imovel/tour";

export const CAMPOS_REVISAO = [
  "titulo", "descricao", "valor", "area_declarada", "condicoes_venda", "aceita_permuta", "aceita_financiamento",
] as const;
/**
 * Campos que não são coluna: vivem dentro de `properties.caracteristicas`
 * (jsonb). Ao aprovar, entram mesclados no jsonb, sem apagar o resto.
 * Item 9 da segunda etapa: link do tour virtual 360 / vídeo imersivo.
 */
export const CAMPOS_REVISAO_CARACTERISTICAS = ["tour_virtual_url"] as const;
export type CampoRevisao = (typeof CAMPOS_REVISAO)[number] | (typeof CAMPOS_REVISAO_CARACTERISTICAS)[number];

export const CAMPO_REVISAO_LABEL: Record<CampoRevisao, string> = {
  titulo: "Título", descricao: "Descrição", valor: "Valor", area_declarada: "Área declarada",
  condicoes_venda: "Condições de venda", aceita_permuta: "Aceita permuta", aceita_financiamento: "Aceita financiamento",
  tour_virtual_url: "Tour virtual 360 / vídeo",
};

export type DadosRevisao = Partial<{
  titulo: string; descricao: string; valor: number | null; area_declarada: number | null;
  condicoes_venda: string | null; aceita_permuta: boolean; aceita_financiamento: boolean;
  tour_virtual_url: string | null;
}>;

/** Valor de um campo da revisão em texto legível. */
export function valorRevisao(campo: string, v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? "Sim" : "Não";
  if (campo === "valor" && typeof v === "number") {
    return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
  }
  if (typeof v === "number") return v.toLocaleString("pt-BR");
  return String(v);
}

/**
 * Normaliza e valida o corpo enviado. Devolve só os campos reconhecidos, já
 * tipados, ou a mensagem do primeiro erro.
 */
export function validarDadosRevisao(b: Record<string, unknown>): { ok: true; dados: DadosRevisao } | { ok: false; erro: string } {
  const dados: DadosRevisao = {};
  const num = (v: unknown) => {
    if (v === null || v === "" || v === undefined) return null;
    const n = typeof v === "number" ? v : Number(String(v).replace(/\./g, "").replace(",", "."));
    return Number.isFinite(n) ? n : NaN;
  };
  if ("titulo" in b) {
    const t = String(b.titulo ?? "").trim();
    if (t.length < 3 || t.length > 120) return { ok: false, erro: "O título precisa ter entre 3 e 120 caracteres." };
    dados.titulo = t;
  }
  if ("descricao" in b) {
    const d = String(b.descricao ?? "").trim();
    if (d.length > 5000) return { ok: false, erro: "A descrição passa de 5.000 caracteres." };
    dados.descricao = d;
  }
  if ("valor" in b) {
    const v = num(b.valor);
    if (v !== null && (Number.isNaN(v) || v < 0)) return { ok: false, erro: "Valor inválido." };
    dados.valor = v;
  }
  if ("area_declarada" in b) {
    const v = num(b.area_declarada);
    if (v !== null && (Number.isNaN(v) || v < 0)) return { ok: false, erro: "Área declarada inválida." };
    dados.area_declarada = v;
  }
  if ("condicoes_venda" in b) {
    const c = String(b.condicoes_venda ?? "").trim();
    if (c.length > 2000) return { ok: false, erro: "As condições de venda passam de 2.000 caracteres." };
    dados.condicoes_venda = c || null;
  }
  if ("aceita_permuta" in b) dados.aceita_permuta = !!b.aceita_permuta;
  if ("aceita_financiamento" in b) dados.aceita_financiamento = !!b.aceita_financiamento;
  if ("tour_virtual_url" in b) {
    const t = validarCampoTour(b.tour_virtual_url);
    if (!t.ok) return { ok: false, erro: t.erro };
    dados.tour_virtual_url = t.url;
  }
  return { ok: true, dados };
}
