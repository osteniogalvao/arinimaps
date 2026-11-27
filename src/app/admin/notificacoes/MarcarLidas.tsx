"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { CheckCheck } from "lucide-react";

/** Marca todas as notificações da pessoa como lidas (mesma API do sino). */
export default function MarcarLidas() {
  const router = useRouter();
  const [ocupado, setOcupado] = useState(false);
  return (
    <button type="button" disabled={ocupado} className="btn-contorno inline-flex items-center gap-2 px-4 py-2 text-sm disabled:opacity-50"
      onClick={async () => {
        setOcupado(true);
        await fetch("/api/notificacoes", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: "{}" }).catch(() => undefined);
        setOcupado(false);
        router.refresh();
      }}>
      <CheckCheck className="size-4" /> Marcar todas como lidas
    </button>
  );
}
