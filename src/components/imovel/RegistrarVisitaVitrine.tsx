"use client";

import { useEffect } from "react";

/**
 * Conta a ficha aberta sem login no limite do navegador (cookie assinado em
 * /api/vitrine/abrir). Fica no cliente porque página de servidor não grava
 * cookie, e assim robô de busca sem JavaScript não gasta o limite de ninguém.
 */
export default function RegistrarVisitaVitrine({ codigo }: { codigo: string }) {
  useEffect(() => {
    void fetch("/api/vitrine/abrir", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ codigo }), keepalive: true,
    }).catch(() => null);
  }, [codigo]);
  return null;
}
