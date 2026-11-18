import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { comPadroes } from "@/lib/configuracoes";

/** Configurações do sistema já com os padrões aplicados. Nunca lança.
 *  Tem tempo-limite: a página 404 (que vai junto em toda página) lê isto, e se o
 *  banco travar a página inteira ficava "carregando" sem fim. Com o limite, cai
 *  nos padrões e a tela termina de carregar. */
export async function lerConfiguracoes(): Promise<Record<string, unknown>> {
  try {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return comPadroes([]);
    const { data } = await supabaseAdmin()
      .from("settings")
      .select("chave, valor")
      .abortSignal(AbortSignal.timeout(4000));
    return comPadroes(data ?? []);
  } catch {
    return comPadroes([]);
  }
}

export const texto = (cfg: Record<string, unknown>, chave: string, alt = "") =>
  typeof cfg[chave] === "string" && cfg[chave] ? (cfg[chave] as string) : alt;

export const numero = (cfg: Record<string, unknown>, chave: string, alt: number) => {
  const n = Number(cfg[chave]);
  return Number.isFinite(n) ? n : alt;
};
