"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function CancelarPedido({ id }: { id: string }) {
  const router = useRouter();
  const [ocupado,setOcupado] = useState(false);
  const [erro,setErro] = useState("");
  async function cancelar() {
    if (!window.confirm("Cancelar este pedido de plano?")) return;
    setOcupado(true);
    setErro("");
    try {
      const r = await fetch("/api/planos/solicitacoes",{ method:"PATCH", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ id, status:"cancelado" }) });
      if (!r.ok) throw new Error((await r.json()).error || "Falha ao cancelar o pedido.");
      router.refresh();
    } catch (e) { setErro(e instanceof Error ? e.message : "Falha de conexão."); setOcupado(false); }
  }
  return <div><button type="button" className="lp-btn lp-btn-contorno" disabled={ocupado} onClick={cancelar}>Cancelar pedido</button>{erro && <p role="alert">{erro}</p>}</div>;
}
