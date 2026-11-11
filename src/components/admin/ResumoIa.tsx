"use client";

import { useEffect, useState } from "react";
import { RefreshCw, Sparkles } from "lucide-react";

/**
 * Resumo do dia pela IA (escopo "eu" ou "setor:<id>"), ou a próxima ação de
 * uma oportunidade (`oportunidade`). Some quando a IA não está configurada.
 */
export default function ResumoIa({ escopo, oportunidade, titulo }: { escopo?: string; oportunidade?: string; titulo?: string }) {
  const [texto, setTexto] = useState<string | null>(null);
  const [estado, setEstado] = useState<"carregando" | "ok" | "desligada" | "erro" | "parado">(oportunidade ? "parado" : "carregando");
  const [erro, setErro] = useState("");

  async function carregar(novo = false) {
    setEstado("carregando");
    const url = oportunidade ? `/api/admin/ia/proxima-acao?id=${oportunidade}` : `/api/admin/ia/resumo?escopo=${escopo}${novo ? "&novo=1" : ""}`;
    const r = await fetch(url).catch(() => null);
    const j = await r?.json().catch(() => ({}));
    if (j?.desligada) { setEstado("desligada"); return; }
    if (!r?.ok) { setErro(j?.error ?? "A IA não respondeu."); setEstado("erro"); return; }
    setTexto(j.texto); setEstado("ok");
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (!oportunidade) void carregar(); }, [escopo]);

  if (estado === "desligada") return null;
  return (
    <section className="cartao space-y-3 border-l-4 border-l-ouro p-5">
      <div className="flex items-center justify-between gap-3">
        <p className="flex items-center gap-2 font-semibold text-texto"><Sparkles className="size-4 text-ouro" /> {titulo ?? (oportunidade ? "Próxima ação sugerida" : "Resumo do dia")}</p>
        {estado !== "parado" && (
          <button type="button" onClick={() => carregar(true)} disabled={estado === "carregando"} aria-label="Refazer"
            className="text-texto-2 hover:text-texto disabled:opacity-50"><RefreshCw className={"size-4 " + (estado === "carregando" ? "animate-spin" : "")} /></button>
        )}
      </div>
      {estado === "parado" && <button type="button" onClick={() => carregar()} className="btn-contorno px-4 py-2 text-sm">Pedir sugestão à IA</button>}
      {estado === "carregando" && <p className="text-sm text-texto-2">Lendo o que está em aberto…</p>}
      {estado === "erro" && <p className="text-sm text-critico">{erro}</p>}
      {estado === "ok" && texto && (
        <div className="space-y-1.5 text-sm leading-relaxed text-texto">
          {texto.split("\n").filter(Boolean).map((l, i) => <p key={i} className={l.startsWith("- ") ? "pl-3 -indent-3" : ""}>{l.startsWith("- ") ? "• " + l.slice(2) : l}</p>)}
        </div>
      )}
      <p className="text-[11px] text-texto-2">Gerado por IA a partir dos dados da Central. Confira antes de agir.</p>
    </section>
  );
}
