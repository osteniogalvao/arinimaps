import "server-only";
import type { Ator } from "@/lib/authz";
import { asaasConfigurado } from "@/lib/asaas";
import { permiteItem, type NivelItem } from "@/lib/direitos-persona";
import { iaConfigurada } from "@/lib/ia/config";
import { lerConfiguracoes } from "@/lib/settings";
import { supabaseAdmin } from "@/lib/supabase/admin";

export async function pacoteDaAri(a: Ator) {
  if (a.nicho !== "comprador_investidor" || a.ehArini) return null;
  const db = supabaseAdmin();
  const [cfg, oferta, matriz] = await Promise.all([lerConfiguracoes(),
    db.from("ofertas_perfis").select("preco_centavos").eq("id", "comprar_creditos").eq("ativo", true).maybeSingle(),
    db.rpc("fn_niveis_itens_persona", { p_persona: "comprador_investidor", p_plano: a.acesso.vencido ? null : a.acesso.planId, p_itens: [472] }),
  ]);
  if (!permiteItem((matriz.data as NivelItem[] | null)?.[0], "operar", true) || !oferta.data?.preco_centavos) return null;
  return { preco: Number(oferta.data.preco_centavos), comprados: Number(cfg.ari_pacote_comprados), cortesia: Number(cfg.ari_pacote_cortesia),
    meses: Number(cfg.ari_validade_meses), ativo: cfg.ia_chat_ativo !== false && iaConfigurada() && asaasConfigurado() && !!process.env.ASAAS_WEBHOOK_TOKEN };
}

export function linkFaturaAri(valor: unknown) {
  try {
    const url = new URL(String(valor));
    return url.protocol === "https:" && (url.hostname === "asaas.com" || url.hostname.endsWith(".asaas.com")) ? url.href : null;
  } catch { return null; }
}