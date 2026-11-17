"use client";

import { useEffect } from "react";

/**
 * Ao trocar de perfil (link com #planos), leva a vista direto aos pacotes do
 * perfil escolhido, sem rolagem manual (item 6 do PDF do Carlos, 17/11/2026).
 * Depois disso a página rola livre, para cima ou para baixo.
 */
export default function RolarParaPlanos() {
  useEffect(() => {
    if (window.location.hash !== "#planos") return;
    const quadro = requestAnimationFrame(() => {
      document.getElementById("planos")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    return () => cancelAnimationFrame(quadro);
  }, []);
  return null;
}
