/** Tipos e rótulos do espelho de vendas (servidor e navegador). */

export type StatusEspelho = "disponivel" | "reservado" | "vendido";

export const STATUS_ESPELHO: StatusEspelho[] = ["disponivel", "reservado", "vendido"];

export const STATUS_ESPELHO_LABEL: Record<StatusEspelho, string> = {
  disponivel: "Disponível",
  reservado: "Reservado",
  vendido: "Vendido",
};

/**
 * Cores do espelho na paleta do manual (as mesmas do mapa: Verde Mapa para o
 * que está à venda, Amarelo Claro para o que está segurado, cinza-verde para o
 * vendido). Indisponível, na versão pública, usa o cinza.
 */
export const COR_ESPELHO: Record<StatusEspelho | "indisponivel", string> = {
  disponivel: "#6FB08F",
  reservado: "#FFE299",
  vendido: "#7E9187",
  indisponivel: "#7E9187",
};

export type EventoEspelho = {
  id: string;
  de: string | null;
  para: StatusEspelho;
  motivo: string | null;
  cliente_nome: string | null;
  reserva_ate: string | null;
  autor: string | null;
  created_at: string;
};

export type OportunidadeLote = { id: string; codigo: string; etapa: string; cliente: string | null };

export type UnidadeEspelho = {
  id: string;
  codigo: string;
  titulo: string;
  quadra: string | null;
  numero: string | null;
  area_m2: number | null;
  valor: number | null;
  /** status do anúncio (properties.status) */
  status_anuncio: string;
  status: StatusEspelho;
  reserva_ate: string | null;
  cliente_nome: string | null;
  valor_venda: number | null;
  observacao: string | null;
  opportunity_id: string | null;
  alterado_por: string | null;
  alterado_em: string | null;
  oportunidades: OportunidadeLote[];
  eventos: EventoEspelho[];
};

/** Versão pública: só disponível/indisponível, sem cliente nem negociação. */
export type UnidadePublica = {
  id: string;
  codigo: string;
  titulo: string;
  quadra: string | null;
  numero: string | null;
  area_m2: number | null;
  valor: number | null;
  disponivel: boolean;
};

export type TotaisEspelho = {
  unidades: number;
  disponivel: number;
  reservado: number;
  vendido: number;
  /** soma do preço de tabela de todas as unidades */
  vgv: number;
  vgvVendido: number;
  vgvDisponivel: number;
};

export function totaisDoEspelho(unidades: Pick<UnidadeEspelho, "status" | "valor" | "valor_venda">[]): TotaisEspelho {
  const t: TotaisEspelho = { unidades: unidades.length, disponivel: 0, reservado: 0, vendido: 0, vgv: 0, vgvVendido: 0, vgvDisponivel: 0 };
  for (const u of unidades) {
    t[u.status]++;
    t.vgv += u.valor ?? 0;
    if (u.status === "vendido") t.vgvVendido += u.valor_venda ?? u.valor ?? 0;
    if (u.status === "disponivel") t.vgvDisponivel += u.valor ?? 0;
  }
  return t;
}

/** "Q 3 · L 12" — rótulo curto do lote para grade e mapa. */
export function rotuloLote(u: { quadra: string | null; numero: string | null; codigo: string }) {
  if (u.quadra || u.numero) return [u.quadra && `Q ${u.quadra}`, u.numero && `L ${u.numero}`].filter(Boolean).join(" · ");
  return u.codigo;
}

/** Ordena quadra/número como gente: "2" antes de "10", "A" antes de "B". */
export function compararLote(a: { quadra: string | null; numero: string | null }, b: { quadra: string | null; numero: string | null }) {
  const c = new Intl.Collator("pt-BR", { numeric: true, sensitivity: "base" });
  return c.compare(a.quadra ?? "~", b.quadra ?? "~") || c.compare(a.numero ?? "~", b.numero ?? "~");
}
