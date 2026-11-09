"use client";

import EnviarWhatsApp from "@/components/compartilhar/EnviarWhatsApp";

/**
 * Compartilhar a ficha do imóvel. O link é o curto (/i/AIB-…), que conta a
 * abertura como evento do imóvel e leva à ficha pública (prévia com a foto de
 * capa). O menu traz: outra pessoa, eu mesmo, apps do celular e copiar link.
 */
export default function BotaoCompartilhar({ codigo, titulo, resumo }: { codigo: string; titulo: string; resumo?: string }) {
  return (
    <EnviarWhatsApp
      caminho={`/i/${codigo}`}
      titulo={titulo}
      texto={`${titulo}${resumo ? ` · ${resumo}` : ""} — veja no mapa da Arini:`}
    />
  );
}
