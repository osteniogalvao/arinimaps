"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { enviarJson, type ErroApi } from "@/lib/api/enviar";
import { RefreshCw } from "lucide-react";

type Resultado = { fonte_id: string; ok: boolean; status_http: number | null; ms: number; erro: string | null; situacao: string | null };
type Resumo = { total: number; no_ar: number; resultados: Resultado[] };

/** "Verificar agora": sonda cada fonte ativa e grava disponibilidade e latência. */
export default function VerificarFontes() {
  const router = useRouter();
  const [rodando, setRodando] = useState(false);
  const [resumo, setResumo] = useState<Resumo | null>(null);
  const [erro, setErro] = useState<ErroApi | null>(null);

  async function verificar() {
    setRodando(true); setErro(null); setResumo(null);
    const r = await enviarJson<Resumo>("/api/admin/fontes/verificar", "POST");
    setRodando(false);
    if (!r.ok) { setErro(r.erro); return; }
    setResumo(r.dados);
    router.refresh();
  }

  const fora = resumo?.resultados.filter((x) => !x.ok) ?? [];
  return (
    <div className="space-y-2 sm:text-right">
      <button onClick={verificar} disabled={rodando} className="btn-ouro inline-flex items-center gap-2 px-5 py-3 text-sm disabled:opacity-60">
        <RefreshCw className="size-4" />
        {rodando ? "Verificando as fontes… (até 30 s)" : "Verificar agora"}
      </button>
      {erro && (
        <p className="max-w-md text-sm text-critico">
          {erro.mensagem}{erro.motivo ? ` ${erro.motivo}` : ""}{erro.solucao ? ` ${erro.solucao}` : ""}
        </p>
      )}
      {resumo && (
        <p className={`max-w-md text-sm font-semibold ${fora.length ? "text-alerta" : "text-verde"}`}>
          {resumo.no_ar} de {resumo.total} fontes sondadas responderam com sucesso.
          {fora.length > 0 && <> Fora: {fora.map((f) => `${f.fonte_id} (${f.erro ?? "falha"})`).join(", ")}.</>}
        </p>
      )}
    </div>
  );
}
