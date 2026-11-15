import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { lerConfiguracoes, numero } from "@/lib/settings";

export const COOKIE_VISITAS = "arini_fichas";
const segredo = () => process.env.SITE_BLOQUEIO_SEGREDO || process.env.SUPABASE_SERVICE_ROLE_KEY;
export function assinarVisitas(codigos: string[]) {
  const chave = segredo();
  if (!chave) throw new Error("Assinatura de acesso indisponível.");
  const dados = codigos.join(".");
  return dados + "~" + createHmac("sha256", chave).update("limite-fichas:" + dados).digest("base64url");
}
export function lerVisitas(cookie?: string) {
  if (!cookie || cookie.length > 1600) return [];
  const [dados, assinatura, extra] = cookie.split("~");
  if (!dados || !assinatura || extra !== undefined) return [];
  const lista = dados.split(".");
  if (lista.length > 30 || !lista.every(c => /^AIB-[0-9]{6,12}$/.test(c))) return [];
  const esperado = Buffer.from(assinarVisitas(lista));
  const recebido = Buffer.from(cookie);
  return esperado.length === recebido.length && timingSafeEqual(esperado, recebido) ? lista : [];
}
export async function visitasDoNavegador() {
  const [jar, cfg] = await Promise.all([cookies(), lerConfiguracoes()]);
  return { lista: lerVisitas(jar.get(COOKIE_VISITAS)?.value), limite: Math.min(30,Math.max(0,Math.floor(numero(cfg,"fichas_visitante",2)))) };
}
