"use client";
import { CAMPO_COMPACTO } from "@/components/admin/estilos";

import Image from "next/image";
import ConfirmarWhatsapp from "@/components/conta/ConfirmarWhatsapp";
import { useEffect, useRef, useState } from "react";
export default function Pix({ id, abrir = false }: { id: string; abrir?: boolean }) {
  const [pix, setPix] = useState<{
    codigo: string;
    imagem: string;
    canal: "indisponivel" | "confirmar" | "livre" | "modelo" | "link";
  } | null>(null);
  const [ocupado, setOcupado] = useState(false),
    [aviso, setAviso] = useState("");
  async function consultar(envio = false) {
    setOcupado(true);
    setAviso("");
    try {
      const r = await fetch("/api/planos/pix?fatura=" + encodeURIComponent(id), {
        method: envio ? "POST" : "GET",
        headers: envio ? { "Content-Type": "application/json" } : undefined,
        body: envio ? JSON.stringify({ acao: pix?.canal === "link" ? "link" : "pix" }) : undefined,
        cache: "no-store",
      });
      const j = await r.json();
      if (!r.ok) throw Error(j.error || "Pix indisponível.");
      if (envio)
        setAviso(
          pix?.canal === "link"
            ? "Link enviado ao WhatsApp da conta."
            : "Pix e QR Code enviados ao WhatsApp da conta.",
        );
      else setPix(j);
    } catch (e) {
      setAviso((e instanceof Error ? e.message : "Falha de conexão.") + " Você também pode pagar pelo link “Abrir fatura no Asaas”.");
    } finally {
      setOcupado(false);
    }
  }
  // a primeira fatura em aberto já mostra o QR Code e o copia e cola, sem clique
  const aberto = useRef(false);
  useEffect(() => {
    if (!abrir || aberto.current) return;
    aberto.current = true;
    void consultar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abrir]);
  return (
    <div className="mt-2 space-y-2">
      <button
        type="button"
        disabled={ocupado}
        className="underline"
        onClick={() => (pix ? setPix(null) : consultar())}
      >
        {pix ? "Ocultar Pix" : ocupado ? "Gerando o Pix…" : "Pagar com Pix (QR Code e copia e cola)"}
      </button>
      {pix && (
        <div className="space-y-2">
          <Image
            unoptimized
            src={"data:image/png;base64," + pix.imagem}
            width={220}
            height={220}
            alt="QR Code Pix da fatura"
          />
          <label className="block">
            Pix copia e cola
            <textarea
              readOnly
              className={CAMPO_COMPACTO + " mt-1 block w-full"}
              value={pix.codigo}
              onFocus={(e) => e.target.select()}
            />
          </label>
          <button
            type="button"
            className="btn-primario mr-4 px-4 py-2"
            onClick={() =>
              navigator.clipboard
                .writeText(pix.codigo)
                .then(() => setAviso("Código copiado."))
                .catch(() => setAviso("Selecione o código para copiar."))
            }
          >
            Copiar código
          </button>
          {["livre", "modelo", "link"].includes(pix.canal) && (
            <button type="button" disabled={ocupado} className="underline" onClick={() => consultar(true)}>
              {pix.canal === "link"
                ? "Receber link privado da fatura no WhatsApp"
                : "Receber Pix e QR Code no meu WhatsApp"}
            </button>
          )}
          {["confirmar", "link"].includes(pix.canal) && (
            <>
              <ConfirmarWhatsapp />
              <button type="button" disabled={ocupado} className="underline" onClick={() => consultar()}>
                Atualizar opções de envio
              </button>
            </>
          )}
        </div>
      )}
      <p role="status" className="text-sm">
        {aviso}
      </p>
    </div>
  );
}
