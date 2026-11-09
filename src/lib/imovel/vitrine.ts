import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * A consulta da vitrine pública: o que qualquer visitante vê em /imoveis.
 *
 * Mora aqui (e não dentro da página) porque o assistente de IA busca imóveis
 * com ESTA mesma consulta — assim ele nunca enxerga um anúncio que a busca
 * pública não mostraria (rascunho, em análise, suspenso…).
 */
export const STATUS_VITRINE = ["publicado", "em_negociacao", "vendido"] as const;

export function imoveisDaVitrine() {
  return supabaseAdmin().from("properties")
    .select(`
      codigo, titulo, tipo, status, valor, published_at, modalidade,
      municipality:municipalities!properties_municipality_id_fkey(id, nome, uf),
      geo:property_geometries(area_m2),
      media:property_media(storage_path, capa)
    `)
    .in("status", [...STATUS_VITRINE]);
}
