"use client";

import { useCallback, useEffect, useState } from "react";
import { QrCode, RefreshCw, Webhook } from "lucide-react";

type Estado = { provedor: "evolution" | "meta" | null; estado: string | null; erro: string | null; numero: string | null; pendentes: string[]; cotacoes: string | null };

const ROTULO: Record<string, string> = { open: "Conectado", connecting: "Aguardando leitura do QR Code", close: "Desconectado" };

/** Conexão do número da ARINI na Evolution API: estado, QR Code e webhook. */
export default function ConexaoWhatsapp() {
  const [e, setE] = useState<Estado | null>(null);
  const [qr, setQr] = useState<{ qr: string | null; pareamento: string | null } | null>(null);
  const [aviso, setAviso] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const carregar = useCallback(async () => {
    const r = await fetch("/api/admin/whatsapp/conexao", { cache: "no-store" }).catch(() => null);
    if (r?.ok) setE(await r.json());
  }, []);
  useEffect(() => {
    void carregar();
    const t = setInterval(carregar, 8_000);
    return () => clearInterval(t);
  }, [carregar]);
  async function acao(nome: "preparar" | "qr", linha?: "cotacoes") {
    setOcupado(true); setAviso("");
    const r = await fetch("/api/admin/whatsapp/conexao", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ acao: nome, linha }) }).catch(() => null);
    const j = await r?.json().catch(() => ({}));
    setOcupado(false);
    if (!r?.ok) return setAviso(j?.error ?? "Não foi possível falar com a Evolution.");
    if (nome === "qr") setQr(j); else setAviso((j.criada ? "Instância criada" : "Webhook atualizado") + " · " + j.webhook);
    void carregar();
  }
  if (!e) return <p className="text-sm text-texto-2">Carregando a conexão…</p>;
  return (
    <section className="cartao space-y-3 p-5">
      <h2 className="text-xl font-semibold">Conexão do WhatsApp</h2>
      <p className="text-sm">
        Provedor: <strong>{e.provedor === "evolution" ? "Evolution API" : e.provedor === "meta" ? "Meta (Cloud API)" : "nenhum"}</strong>
        {e.provedor === "evolution" && <> · Estado: <strong>{ROTULO[e.estado ?? ""] ?? e.estado ?? "sem resposta"}</strong></>}
        {e.numero && <> · Número: <strong>+{e.numero}</strong></>}
      </p>
      {e.erro && <p role="alert" className="text-sm text-red-700">{e.erro}</p>}
      {e.pendentes.length > 0 && (
        <p className="text-sm">Falta configurar na VPS: {e.pendentes.join(", ")}.</p>
      )}
      {e.provedor === "evolution" && (
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={ocupado} onClick={() => acao("preparar")} className="btn-verde inline-flex items-center gap-2 px-4 py-2">
            <Webhook className="size-4" /> Criar instância e ligar webhook
          </button>
          {e.estado !== "open" && (
            <button type="button" disabled={ocupado} onClick={() => acao("qr")} className="btn-verde inline-flex items-center gap-2 px-4 py-2">
              <QrCode className="size-4" /> Gerar QR Code
            </button>
          )}
          {e.cotacoes && (
            <button type="button" disabled={ocupado} onClick={() => acao("preparar", "cotacoes")} className="inline-flex items-center gap-2 rounded-xl border border-linha px-4 py-2">
              <Webhook className="size-4" /> Número de cotações ({e.cotacoes})
            </button>
          )}
          <button type="button" onClick={() => void carregar()} className="inline-flex items-center gap-2 rounded-xl border border-linha px-4 py-2">
            <RefreshCw className="size-4" /> Atualizar
          </button>
        </div>
      )}
      {qr?.qr && e.estado !== "open" && (
        <div className="space-y-2">
          <p className="text-sm">No celular do número da ARINI: WhatsApp &gt; Aparelhos conectados &gt; Conectar aparelho, e leia o código.</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qr.qr} alt="QR Code para conectar o WhatsApp" className="size-64 rounded-xl border border-linha bg-white p-2" />
        </div>
      )}
      {qr?.pareamento && e.estado !== "open" && <p className="text-sm">Código de pareamento: <strong className="tracking-widest">{qr.pareamento}</strong></p>}
      <p role="status" className="text-sm">{aviso}</p>
    </section>
  );
}
