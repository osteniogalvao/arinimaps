import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { lerConfiguracoes, numero } from "@/lib/settings";
import type { Acesso } from "@/lib/planos";

/**
 * Cota de armazenamento por conta (Anexo B E16.08). O limite vem da cota
 * "armazenamento_mb" do plano; conta sem plano usa a configuração
 * armazenamento_padrao_mb (0 = sem limite). A equipe da ARINI não tem limite.
 * O uso é somado no banco (função armazenamento_usado, migration 0149).
 */
const MB = 1024 * 1024;

export async function limiteArmazenamentoMb(acesso: Acesso): Promise<number | null> {
  if (acesso.equipe) return null;
  const doPlano = Number(acesso.cotas?.armazenamento_mb);
  if (Number.isFinite(doPlano) && doPlano > 0) return doPlano;
  if (acesso.planId) return null; // plano sem a cota: sem limite, como as outras cotas
  const padrao = numero(await lerConfiguracoes(), "armazenamento_padrao_mb", 500);
  return padrao > 0 ? padrao : null;
}

export async function armazenamentoDaConta(userId: string, acesso: Acesso) {
  const limiteMb = await limiteArmazenamentoMb(acesso);
  const { data, error } = await supabaseAdmin().rpc("armazenamento_usado", { p_titular: userId });
  // sem a migration 0149, o envio segue como antes
  const usadoBytes = error ? null : Number(data ?? 0);
  return { usadoBytes, limiteMb };
}

/** Confere se cabe mais `bytes` na conta. Devolve a mensagem de recusa ou null. */
export async function recusaPorArmazenamento(userId: string, acesso: Acesso, bytes: number): Promise<string | null> {
  const { usadoBytes, limiteMb } = await armazenamentoDaConta(userId, acesso);
  if (limiteMb === null || usadoBytes === null) return null;
  if (usadoBytes + Math.max(0, bytes) <= limiteMb * MB) return null;
  const usado = (usadoBytes / MB).toLocaleString("pt-BR", { maximumFractionDigits: 1 });
  return `O espaço de arquivos da sua conta acabou (${usado} MB de ${limiteMb.toLocaleString("pt-BR")} MB). Apague arquivos antigos ou troque de plano em /planos.`;
}
