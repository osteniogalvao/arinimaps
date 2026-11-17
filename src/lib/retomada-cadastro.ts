import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { segredoWhatsapp, telefoneWhatsapp } from "@/lib/meta";

const prefixo =
  "Autorizo até dois lembretes da ARINI no WhatsApp para concluir este cadastro. Posso cancelar com PARAR LEMBRETES. Código ";
function assinatura(telefone: string, dados: string) {
  return createHmac("sha256", segredoWhatsapp()!)
    .update(telefone + "|" + dados)
    .digest("hex")
    .slice(0, 32);
}
export function textoOptIn(telefone: string, plano: string, perfil: string) {
  const dados = [plano, perfil, Math.floor(Date.now() / 1000)].join(".");
  return prefixo + dados + "." + assinatura(telefone, dados);
}
/** Só a mensagem inbound autenticada da Meta confirma posse do telefone e autorização. */
export async function receberOptIn(numero: string, texto: string, waId: string, nome: string) {
  const tel = telefoneWhatsapp(numero);
  if (!tel || !segredoWhatsapp()) return false;
  const parar = /^PARAR LEMBRETES[.!]?$/i.test(texto.trim());
  const partes = texto.trim().startsWith(prefixo) ? texto.trim().slice(prefixo.length).split(".") : [];
  if (!parar) {
    if (partes.length !== 4 || !/^\d{10}$/.test(partes[2]) || !/^[a-f0-9]{32}$/.test(partes[3])) return false;
    const idade = Date.now() / 1000 - Number(partes[2]);
    if (
      idade < 0 ||
      idade > 86400 ||
      !timingSafeEqual(Buffer.from(partes[3]), Buffer.from(assinatura(tel, partes.slice(0, 3).join("."))))
    )
      return false;
  }
  const { error } = await supabaseAdmin().rpc("retomada_registrar", {
    p_tel: tel,
    p_plano: partes[0] ?? null,
    p_perfil: partes[1] ?? null,
    p_nome: nome,
    p_wa: waId,
    p_parar: parar,
  });
  if (error) throw Error("Falha ao registrar a opção de contato.");
  return true;
}
