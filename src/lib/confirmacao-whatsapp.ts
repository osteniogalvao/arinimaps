import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { telefoneWhatsapp } from "@/lib/meta";

const prefixo = "Confirmo que este é o WhatsApp da minha conta ARINI. Código ";
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
function assinatura(numero: string, token: string) {
  return createHmac("sha256", process.env.WHATSAPP_APP_SECRET!)
    .update("confirmacao-v1|" + numero + "|" + token)
    .digest("hex")
    .slice(0, 32);
}
export function desafioNumero(numero: string, titular: string, versao: string) {
  const token = [titular, versao, Math.floor(Date.now() / 1000)].join(".");
  return prefixo + token + "." + assinatura(numero, token);
}
export function dataWhatsapp(timestamp: unknown): string | null {
  if (typeof timestamp !== "string" || !/^\d{10}$/.test(timestamp)) return null;
  const ms = Number(timestamp) * 1000;
  return ms > Date.now() + 60_000 ? null : new Date(ms).toISOString();
}
export async function confirmarMensagemWhatsapp(numero: string, texto: string, recebido: string | null) {
  if (!texto.startsWith(prefixo)) return false;
  const tel = telefoneWhatsapp(numero),
    partes = texto.slice(prefixo.length).trim().split(".");
  if (
    !tel ||
    !recebido ||
    !process.env.WHATSAPP_APP_SECRET ||
    partes.length !== 4 ||
    !uuid.test(partes[0]) ||
    !uuid.test(partes[1]) ||
    !/^\d{10}$/.test(partes[2]) ||
    !/^[a-f0-9]{32}$/.test(partes[3])
  )
    return true;
  const idade = Date.now() / 1000 - Number(partes[2]);
  if (
    idade < 0 ||
    idade > 900 ||
    !timingSafeEqual(Buffer.from(partes[3]), Buffer.from(assinatura(tel, partes.slice(0, 3).join("."))))
  )
    return true;
  const { error } = await supabaseAdmin().rpc("assinatura_whatsapp_confirmar", {
    p_titular: partes[0],
    p_versao: partes[1],
    p_tel: tel,
    p_recebido: recebido,
  });
  if (error) throw Error("Falha ao verificar a confirmação.");
  return true;
}
export async function canalDoTitular(titular: string) {
  const { data, error } = await supabaseAdmin().rpc("assinatura_whatsapp_canal", { p_titular: titular });
  if (error) throw Error("Falha ao conferir o número da conta.");
  return (
    (data?.[0] as
      { telefone: string; versao: string; verificado: boolean; janela_ate: string | null } | undefined) ??
    null
  );
}
