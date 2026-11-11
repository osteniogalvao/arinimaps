"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LoaderCircle, RefreshCw, ScanSearch } from "lucide-react";

/**
 * Dispara o cruzamento da área com as fontes oficiais (CAR, lote ou área
 * desenhada — muda só a `url`). Quem decide se pode é o servidor (plano +
 * cota): aqui só mostramos o que ele responder, inclusive a `solucao` quando a
 * consulta é negada (sem plano, cota esgotada).
 *
 * Com muita gente consultando ao mesmo tempo o servidor responde 503
 * `consulta_na_fila` com a posição (src/lib/geo/consultaArea.ts): mostramos
 * "sua consulta está na fila (posição N)" e tentamos de novo sozinhos — a
 * volta da fila não gasta cota.
 */
/** Quantas vezes voltamos para a fila antes de pedir para a pessoa tentar mais tarde (~2 min). */
const MAX_VOLTAS_FILA = 12;

export default function BotaoConsultarArea({
  url, corpo, jaConsultou, planNome, cotaRestante,
}: {
  url: string;
  /** corpo JSON do POST, quando a rota precisa (área desenhada: a chave) */
  corpo?: unknown;
  jaConsultou: boolean; planNome?: string | null; cotaRestante?: number | null;
}) {
  const router = useRouter();
  const [rodando, setRodando] = useState(false);
  const [msg, setMsg] = useState("");
  const [solucao, setSolucao] = useState("");
  const [negado, setNegado] = useState(false);
  const [posicaoFila, setPosicaoFila] = useState<number | null>(null);

  async function consultar() {
    setRodando(true); setMsg(""); setSolucao(""); setNegado(false); setPosicaoFila(null);
    let r: Response | null = null;
    let data: Record<string, unknown> & { error?: string; solucao?: string; codigo?: string } = {};
    for (let volta = 0; ; volta++) {
      r = await fetch(url, corpo === undefined ? { method: "POST" } : {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo),
      }).catch(() => null);
      data = r ? await r.json().catch(() => ({})) : {};
      if (data.codigo !== "consulta_na_fila" || volta >= MAX_VOLTAS_FILA) break;
      setPosicaoFila(Number(data.posicao) || 1);
      setMsg(data.error ?? "Sua consulta está na fila.");
      setSolucao(data.solucao ?? "");
      await new Promise((ok) => setTimeout(ok, (Number(data.tentar_em) || 10) * 1000));
    }
    setRodando(false); setPosicaoFila(null); setMsg(""); setSolucao("");
    if (!r?.ok) {
      setMsg(data.error ?? "Não foi possível consultar agora.");
      if (typeof data.solucao === "string") setSolucao(data.solucao);
      if (data.codigo === "sem_plano" || data.codigo === "cota_esgotada") setNegado(true);
      if (data.codigo === "consulta_na_fila") setSolucao("O sistema segue muito movimentado. Tente de novo em alguns minutos.");
      return;
    }
    const semResposta = Array.isArray(data.falharam) ? data.falharam : [];
    setMsg(
      semResposta.length
        ? (semResposta.length === 1
          ? "1 fonte do governo não respondeu nem na segunda tentativa."
          : `${semResposta.length} fontes do governo não responderam nem na segunda tentativa.`) +
          " Onde havia um resultado anterior, ele continua valendo, com a data dele." +
          " Em alguns minutos, “Atualizar consulta” pergunta só a elas, sem gastar consulta do mês."
        : data.consultadas === 0 ? "Os dados já estavam atualizados." : ""
    );
    router.refresh();
  }

  const semCota = cotaRestante != null && cotaRestante <= 0;

  return (
    <div className="text-right space-y-1.5">
      <button onClick={consultar} disabled={rodando || semCota} className="btn-verde inline-flex items-center gap-2 px-5 py-3 text-sm disabled:opacity-60">
        {rodando ? <LoaderCircle className="size-4 animate-spin" /> : jaConsultou ? <RefreshCw className="size-4" /> : <ScanSearch className="size-4" />}
        {posicaoFila != null ? `Na fila (posição ${posicaoFila})…` : rodando ? "Consultando os órgãos…" : jaConsultou ? "Atualizar consulta" : "Consultar fontes oficiais"}
      </button>
      {cotaRestante != null && (
        <p className={"text-xs " + (semCota ? "text-alerta" : "text-texto-2")}>
          Consultas restantes no mês: {cotaRestante}{planNome ? ` · plano ${planNome}` : ""}
          {semCota && <> · <Link href="/planos" className="text-verde underline">ver planos</Link></>}
        </p>
      )}
      {msg && <p className={"text-xs max-w-72 ml-auto " + (negado ? "text-alerta" : "text-texto-2")}>{msg}</p>}
      {solucao && (
        <p className="text-xs text-texto max-w-72 ml-auto">
          {solucao}{negado && <> <Link href="/planos" className="text-verde underline">Ver planos</Link></>}
        </p>
      )}
    </div>
  );
}
