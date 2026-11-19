"use client";

import { useState, useSyncExternalStore } from "react";
import { Construction } from "lucide-react";
import { BotaoFechar } from "./UiMapa";

/**
 * Aviso de cartografia urbana em manutenção (pedido do Carlos, 19/11/2026).
 * Faixa no topo do mapa, para visitante e logado. Fechar vale só para esta
 * visita (sessionStorage): quem volta outro dia vê o aviso de novo.
 * Texto e liga/desliga em Admin > Configurações > Mapa e território.
 */
const CHAVE = "arini:aviso-cartografia-fechado";

const lerFechado = (): string | null => {
  try { return sessionStorage.getItem(CHAVE); } catch { return null; } // navegação privada
};
const semAssinatura = () => () => {};

export default function AvisoCartografia({ texto }: { texto: string }) {
  // o que já estava fechado nesta visita; no servidor, nada (o aviso sai no HTML)
  const fechadoAntes = useSyncExternalStore(semAssinatura, lerFechado, () => null);
  const [fechadoAgora, setFechadoAgora] = useState(false);

  if (!texto || fechadoAgora || fechadoAntes === texto) return null;

  const fechar = () => {
    try { sessionStorage.setItem(CHAVE, texto); } catch { /* navegação privada */ }
    setFechadoAgora(true);
  };

  return (
    <div role="status" className="flex shrink-0 items-start gap-2.5 border-b border-alerta/40 bg-alerta/12 px-3 py-2 text-xs leading-snug text-texto sm:items-center sm:px-4 sm:text-sm">
      <Construction aria-hidden className="mt-0.5 size-4 shrink-0 text-alerta sm:mt-0" />
      <p className="flex-1">{texto}</p>
      <BotaoFechar onClick={fechar} rotulo="Fechar aviso" />
    </div>
  );
}
