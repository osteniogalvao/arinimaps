import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { segredoWhatsapp } from "@/lib/meta";

/**
 * Link assinado do PDF que o atendimento manda pelo WhatsApp. Quem baixa o
 * arquivo é o servidor da Meta ou da Evolution, sem a sessão do cliente; a
 * assinatura prova que o atendimento já conferiu o plano da conta. Vale 24 h.
 */
const VALIDADE_S = 24 * 3600;

function assinatura(cod: string, modelo: string, exp: number) {
  const segredo = segredoWhatsapp();
  if (!segredo) return null;
  return createHmac("sha256", segredo).update(`relatorio-wa-v1|${cod}|${modelo}|${exp}`).digest("hex").slice(0, 32);
}

/** Parâmetros a acrescentar ao link do relatório (vazio se o WhatsApp não estiver configurado). */
export function parametrosLinkWhatsapp(cod: string, modelo: string) {
  const exp = Math.floor(Date.now() / 1000) + VALIDADE_S;
  const sig = assinatura(cod.toUpperCase(), modelo, exp);
  return sig ? `&exp=${exp}&sig=${sig}` : "";
}

export function linkWhatsappValido(url: URL, cod: string, modelo: string) {
  const exp = Number(url.searchParams.get("exp")), sig = url.searchParams.get("sig") ?? "";
  if (!Number.isInteger(exp) || exp < Date.now() / 1000 || exp > Date.now() / 1000 + VALIDADE_S + 60 || !/^[a-f0-9]{32}$/.test(sig)) return false;
  const esperado = assinatura(cod.toUpperCase(), modelo, exp);
  return !!esperado && timingSafeEqual(Buffer.from(esperado), Buffer.from(sig));
}
