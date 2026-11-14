"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Fingerprint } from "lucide-react";
import { assumirPontoLegado, enviarOuGuardar, pontosPendentes, sincronizar, type ItemFila } from "@/lib/filaOffline";

/** Botão de bater o ponto, com localização (se permitida) e comprovante. */
export default function BaterPonto({ proxima, userId }: { proxima: "entrada" | "saída"; userId: string }) {
  const router = useRouter();
  const [ocupado, setOcupado] = useState(false);
  const [msg, setMsg] = useState<{ tipo: "ok" | "erro"; texto: string } | null>(null);
  const [pendentes, setPendentes] = useState<ItemFila[]>([]);
  useEffect(() => {
    function atualizar() { setPendentes(pontosPendentes(userId)); }
    atualizar();
    window.addEventListener("arini-fila", atualizar);
    window.addEventListener("storage", atualizar);
    return () => { window.removeEventListener("arini-fila", atualizar); window.removeEventListener("storage", atualizar); };
  }, [userId]);

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
          const instante = new Date().toISOString();
          try {
          const p = await posicao();
          const corpo = { registro_cliente: crypto.randomUUID(), user_id: userId, latitude: p?.coords.latitude, longitude: p?.coords.longitude, precisao: p?.coords.accuracy };
          const r = await enviarOuGuardar("/api/admin/ponto", "POST", corpo, "Ponto", { ...corpo, offline_em: instante });
          if (r.offline) { setMsg({ tipo: "ok", texto: "Marcação guardada neste aparelho para sincronizar com a sua conta." }); return; }
          const j = await r.resposta.json().catch(() => ({}));
          if (!r.resposta.ok) { setMsg({ tipo: "erro", texto: j.error ?? "Não foi possível marcar." }); return; }
          const c = j.comprovante;
          setMsg({ tipo: "ok", texto: `Marcado às ${new Date(c.marcado_em).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}. Comprovante: NSR ${c.nsr} · ${String(c.hash).slice(0, 16)}…` });
          router.refresh();
          } catch { setMsg({ tipo: "erro", texto: "Não foi possível confirmar nem guardar a marcação no aparelho. Confira o espelho e solicite um ajuste se necessário." }); }
          finally { setOcupado(false); }
        }}>
        <Fingerprint className="size-5" /> {ocupado ? "Marcando…" : `Bater ponto (${proxima})`}
      </button>
      {msg && <p className={"text-sm " + (msg.tipo === "ok" ? "text-verde" : "text-critico")}>{msg.texto}</p>}
      {pendentes.map((item) => (
        <div key={item.id} className="text-sm text-texto-2">
          <span>{new Date(String(item.corpo.offline_em ?? item.criado_em)).toLocaleString("pt-BR")} · </span>
          {!item.corpo.user_id ? <button className="underline" onClick={async () => {
            if (!window.confirm("Você reconhece esse horário como uma marcação sua? Ela será vinculada à sua conta.")) return;
            try { assumirPontoLegado(item.id, userId); if (navigator.onLine) await sincronizar(userId); router.refresh(); }
            catch { setMsg({ tipo: "erro", texto: "Não foi possível recuperar a marcação. Confira novamente neste aparelho." }); }
          }}>Reconhecer marcação antiga sem titular</button> : String(item.corpo.erro_local ?? "Aguardando envio")}
        </div>
      ))}
    </div>
  );
}
