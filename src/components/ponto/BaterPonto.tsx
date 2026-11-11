"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Fingerprint } from "lucide-react";
import { enviarOuGuardar } from "@/lib/filaOffline";

/** Botão de bater o ponto, com localização (se permitida) e comprovante. */
export default function BaterPonto({ proxima }: { proxima: "entrada" | "saída" }) {
  const router = useRouter();
  const [ocupado, setOcupado] = useState(false);
  const [msg, setMsg] = useState<{ tipo: "ok" | "erro"; texto: string } | null>(null);

  async function posicao(): Promise<GeolocationPosition | null> {
    if (!navigator.geolocation) return null;
    return new Promise((ok) => navigator.geolocation.getCurrentPosition(ok, () => ok(null), { timeout: 6000, maximumAge: 60_000 }));
  }

  return (
    <div className="space-y-2">
      <button type="button" disabled={ocupado}
        className="btn-verde inline-flex items-center gap-2 px-6 py-3.5 text-base disabled:opacity-60"
        onClick={async () => {
          setOcupado(true); setMsg(null);
          const p = await posicao();
          const corpo = { latitude: p?.coords.latitude, longitude: p?.coords.longitude, precisao: p?.coords.accuracy };
          const r = await enviarOuGuardar("/api/admin/ponto", "POST", corpo, "Ponto", { ...corpo, offline_em: new Date().toISOString() });
          setOcupado(false);
          if (r.offline) { setMsg({ tipo: "ok", texto: "Sem internet: a marcação ficou guardada no aparelho e será enviada quando a conexão voltar." }); return; }
          const j = await r.resposta.json().catch(() => ({}));
          if (!r.resposta.ok) { setMsg({ tipo: "erro", texto: j.error ?? "Não foi possível marcar." }); return; }
          const c = j.comprovante;
          setMsg({ tipo: "ok", texto: `Marcado às ${new Date(c.marcado_em).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}. Comprovante: NSR ${c.nsr} · ${String(c.hash).slice(0, 16)}…` });
          router.refresh();
        }}>
        <Fingerprint className="size-5" /> {ocupado ? "Marcando…" : `Bater ponto (${proxima})`}
      </button>
      {msg && <p className={"text-sm " + (msg.tipo === "ok" ? "text-verde" : "text-critico")}>{msg.texto}</p>}
    </div>
  );
}
