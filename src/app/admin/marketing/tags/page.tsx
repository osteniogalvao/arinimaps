import { CodeXml } from "lucide-react";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { exigirSetor } from "@/lib/setores-servidor";
import { CabecalhoPagina, Vazio } from "@/components/ui/Pagina";
import type { TagMarketing } from "@/lib/tags-marketing";
import Editor from "./Editor";

export const metadata = { title: "Tags e pixels" };

/**
 * Marketing > Tags e pixels: códigos de terceiros (Tag Manager, Analytics,
 * Meta Pixel, TikTok, Hotjar…) num lugar só, cada um com a posição na página
 * e as páginas onde vale. Quem edita: Marketing (produção ou tráfego) e
 * Diretoria. As ações conferem de novo no servidor (acoes.ts).
 */
export default async function TagsEPixels() {
  await exigirSetor("marketing", "marketing_trafego");
  const { data, error } = await supabaseAdmin()
    .from("marketing_tags")
    .select("id, nome, codigo, posicao, ativo, todas_paginas, paginas, excluir, observacao, updated_at")
    .order("created_at");

  return (
    <div className="max-w-5xl">
      <CabecalhoPagina eyebrow="Marketing" titulo="Tags e pixels"
        subtitulo="Cole aqui os códigos do Google Tag Manager, Google Analytics, Meta Pixel, TikTok, Hotjar e outras ferramentas, e escolha em quais páginas do site cada um carrega." />
      {error
        ? <Vazio icone={CodeXml} titulo="Falta atualizar o banco" texto="Esta tela precisa da migration 0172 (tabela marketing_tags)." />
        : <Editor tags={(data ?? []) as TagMarketing[]} />}
    </div>
  );
}
