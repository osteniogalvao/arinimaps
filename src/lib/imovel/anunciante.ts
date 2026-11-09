import "server-only";
import { cache } from "react";
import { notFound } from "next/navigation";
import { ator } from "@/lib/authz";
import { supabaseAdmin } from "@/lib/supabase/admin";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Páginas de /painel/imoveis/[id]: só o anunciante do imóvel (proprietário ou
 * parceiro que anunciou) entra. A RLS de leitura libera anúncio publicado para
 * todo mundo, então ela sozinha NÃO serve para saber quem é o dono (auditoria
 * de 09/11/2026). Qualquer outro caso vira 404. `cache` evita repetir a
 * consulta entre o layout e a página no mesmo pedido.
 */
export const exigirAnunciante = cache(async (propertyId: string) => {
  if (!UUID.test(propertyId)) notFound();
  const a = await ator();
  if (!a || (!a.ownerId && !a.partnerId)) notFound();
  const { data: p } = await supabaseAdmin().from("properties")
    .select("id, codigo, titulo, tipo, status, owner_id, partner_id")
    .eq("id", propertyId).maybeSingle();
  if (!p) notFound();
  const dono = (!!a.ownerId && p.owner_id === a.ownerId) || (!!a.partnerId && p.partner_id === a.partnerId);
  if (!dono) notFound();
  return {
    ator: a,
    imovel: p as { id: string; codigo: string; titulo: string; tipo: "urbano" | "rural"; status: string; owner_id: string | null; partner_id: string | null },
  };
});
