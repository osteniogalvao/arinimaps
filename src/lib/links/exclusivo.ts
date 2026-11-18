/**
 * Link exclusivo do Tour 3D (áudio do Carlos, 18/11/2026, 9h25): "liberar o
 * link para encaminhar para uma pessoa apenas (...) para a outra pessoa não tem
 * como encaminhar". O link /x/<token> fica com o primeiro aparelho que o abre
 * (tabela links_exclusivos, migration 0152). Esse aparelho recebe um passe
 * assinado, num cookie só dele, que abre o tour daquele imóvel sem conta.
 * Repassar o endereço do tour não adianta: sem o cookie, pede login.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export const COOKIE_APARELHO = "arini_aparelho";
export const cookiePasse = (codigo: string) => `arini_ex_${codigo.replace(/[^\w-]/g, "")}`;

function segredo() {
  return process.env.LINK_EXCLUSIVO_SEGREDO || process.env.SAUDE_TOKEN || "";
}

const mac = (codigo: string, token: string, exp: number) =>
  createHmac("sha256", segredo()).update(`exclusivo:${codigo}:${token}:${exp}`).digest("hex");

/** Passe do aparelho: token.validade.assinatura */
export function assinarPasse(codigo: string, token: string, exp: number): string | null {
  if (!segredo()) return null;
  return `${token}.${exp}.${mac(codigo, token, exp)}`;
}

/** Confere o passe do cookie; devolve o token do link quando vale. */
export function conferirPasse(codigo: string, valor: string | undefined | null): string | null {
  if (!valor || !segredo()) return null;
  const [token, expTxt, assinatura] = valor.split(".");
  const exp = Number(expTxt);
  if (!/^[0-9a-f-]{36}$/.test(token ?? "") || !/^\d{13}$/.test(expTxt ?? "") || exp < Date.now()) return null;
  if (!/^[a-f0-9]{64}$/.test(assinatura ?? "")) return null;
  const esperado = mac(codigo, token, exp);
  return timingSafeEqual(Buffer.from(assinatura), Buffer.from(esperado)) ? token : null;
}
