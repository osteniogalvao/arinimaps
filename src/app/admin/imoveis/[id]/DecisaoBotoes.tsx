"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { enviarJson } from "@/lib/api/enviar";

const ACOES: { acao: string; label: string; classe: string; pedirMotivo?: boolean }[] = [
  { acao: "em_analise", label: "Iniciar análise", classe: "btn-contorno" },
  { acao: "aprovado", label: "Aprovar", classe: "btn-verde" },
  { acao: "publicado", label: "Publicar no mapa", classe: "btn-ouro" },
  { acao: "correcao", label: "Pedir correção", classe: "btn-contorno !text-alerta !border-alerta/50", pedirMotivo: true },
  // Fluxograma §7: faltam dados (não há erro) — o anunciante vê "Aguardando complemento"
  { acao: "complementar", label: "Pedir complemento", classe: "btn-contorno !text-ouro !border-ouro/50", pedirMotivo: true },
  { acao: "reprovado", label: "Reprovar", classe: "btn-perigo", pedirMotivo: true },
  { acao: "suspenso", label: "Suspender", classe: "btn-contorno" },
];

export default function DecisaoBotoes({ propertyId }: { propertyId: string }) {
  const router = useRouter();
  const [erro, setErro] = useState("");
  const [ocupado, setOcupado] = useState(false);

  async function decidir(acao: string, pedirMotivo?: boolean) {
    let motivo: string | null = null;
    if (pedirMotivo) {
      motivo = prompt(acao === "complementar" ? "O que falta informar? (o anunciante vai ver):" : "Motivo (o anunciante vai ver):");
      if (motivo === null) return;
    }
    setOcupado(true);
    setErro("");
    const r = await enviarJson("/api/admin/decisao", "POST", { alvo: "imovel", id: propertyId, acao, motivo });
    setOcupado(false);
    if (!r.ok) {
      setErro([r.erro.mensagem, r.erro.motivo].filter(Boolean).join(" — "));
      return;
    }
    router.refresh();
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2.5">
        {ACOES.map((a) => (
          <button key={a.acao} disabled={ocupado}
            onClick={() => decidir(a.acao, a.pedirMotivo)}
            className={`px-4 py-2.5 text-sm disabled:opacity-50 ${a.classe}`}>
            {a.label}
          </button>
        ))}
      </div>
      {erro && <p className="text-sm text-critico">{erro}</p>}
      <p className="text-sm text-texto-2">
        Transições inválidas são bloqueadas pelo banco (máquina de estados).
      </p>
    </div>
  );
}
