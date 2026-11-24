import "server-only";
import { unstable_cache } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { TagAtiva } from "@/lib/tags-marketing";

/** Etiqueta do cache: o admin invalida ao salvar, e o site vê a mudança na hora. */
export const CACHE_TAGS_MARKETING = "marketing-tags";

const temBanco = () => !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;

const ativasCache = unstable_cache(async (): Promise<TagAtiva[]> => {
  const { data, error } = await supabaseAdmin()
    .from("marketing_tags")
    .select("id, codigo, posicao, todas_paginas, paginas, excluir")
    .eq("ativo", true)
    .order("created_at")
    .limit(100);
  if (error) throw new Error(error.message);
  return (data ?? []) as TagAtiva[];
}, ["marketing-tags-ativas"], { revalidate: 600, tags: [CACHE_TAGS_MARKETING] });

/**
 * Códigos ativos para o layout do site. Lidos uma vez e guardados em cache
 * (uma consulta a cada 10 min, não uma por visita); falha do banco ou tabela
 * ainda não criada (migration 0172) só deixa o site sem os códigos.
 */
export async function tagsMarketingAtivas(): Promise<TagAtiva[]> {
  if (!temBanco()) return [];
  try {
    return await ativasCache();
  } catch (e) {
    console.error("tags de marketing não carregaram:", e);
    return [];
  }
}
