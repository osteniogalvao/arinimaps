/**
 * Compartilhamento (segunda etapa do cliente, item 6): links do WhatsApp e a
 * prévia (OpenGraph) que o WhatsApp mostra quando alguém cola um link nosso.
 *
 * Funções puras: valem no servidor (metadata das páginas) e no navegador
 * (botão "Enviar pelo WhatsApp").
 */

/** Imagem padrão da prévia (1600×900, ~250 KB: o WhatsApp mostra até ~300 KB). */
export const OG_IMAGEM_PADRAO = "/img/hero-fazenda.jpg";
export const OG_NOME_SITE = "Arini Imóveis Brasil";

/** Endereço público do site (base dos links compartilhados e das imagens OG). */
export function urlDoSite() {
  return (process.env.NEXT_PUBLIC_SITE_URL || "https://arinibrasil.com.br").replace(/\/+$/, "");
}

/**
 * Telefone do perfil → número no formato do wa.me (só dígitos, com DDI).
 * O perfil guarda como a pessoa digitou ("(34) 99999-0000"); sem DDI, vale o 55.
 */
export function numeroWhatsApp(telefone: string | null | undefined): string | null {
  const d = String(telefone ?? "").replace(/\D/g, "").replace(/^0+/, "");
  if (d.length === 10 || d.length === 11) return `55${d}`;
  if (d.length >= 12 && d.length <= 15) return d;
  return null;
}

/** Link do wa.me com o texto pronto; sem número, o WhatsApp pergunta para quem enviar. */
export function linkWhatsApp(texto: string, numero?: string | null) {
  return `https://wa.me/${numero ?? ""}?text=${encodeURIComponent(texto)}`;
}
