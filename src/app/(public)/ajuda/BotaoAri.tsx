"use client";

import { abrirAssistente } from "@/components/ia/ChatIA";
import MarcaArini from "@/components/marca/MarcaArini";

/** "Pergunte à Ari" da Central de ajuda: abre o mesmo painel do assistente. */
export default function BotaoAri({ rotulo = "Pergunte à Ari" }: { rotulo?: string }) {
  return (
    <button type="button" onClick={abrirAssistente}
      className="inline-flex items-center gap-2 rounded-full bg-[#124431] py-1.5 pl-1.5 pr-4 text-sm font-bold text-[#F2F2EC] ring-2 ring-[#D9BD6F]/70 transition hover:ring-[#D9BD6F]">
      <span className="grid size-8 place-items-center rounded-full bg-[#0B2A1E]" aria-hidden>
        <MarcaArini variante="radar" titulo="" className="size-4" />
      </span>
      {rotulo}
    </button>
  );
}
