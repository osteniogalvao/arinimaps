"use client";

import { useState } from "react";
import { BadgeCheck, Save } from "lucide-react";
import { enviarJson } from "@/lib/api/enviar";

type Atual = { numero: string; cartorio: string | null; conferida_em: string | null } | null;

/**
 * Número da matrícula na ficha da Matriz: confere com o documento enviado
 * (bloco "Documentos" logo abaixo) e marca como conferida. Só a equipe vê.
 */
export default function MatriculaAdmin({ propertyId, atual }: { propertyId: string; atual: Atual }) {
  const [numero, setNumero] = useState(atual?.numero ?? "");
  const [cartorio, setCartorio] = useState(atual?.cartorio ?? "");
  const [conferidaEm, setConferidaEm] = useState(atual?.conferida_em ?? null);
  const [salvo, setSalvo] = useState({ numero: atual?.numero ?? "", cartorio: atual?.cartorio ?? "" });
  const [ocupado, setOcupado] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);

  const mudou = numero.trim() !== salvo.numero || cartorio.trim() !== (salvo.cartorio ?? "");

  async function gravar(conferir: boolean) {
    setOcupado(true); setMsg(null);
    const r = await enviarJson<{ matricula: { numero: string; cartorio: string | null; conferida_em: string | null } }>(
      "/api/admin/matricula", "POST", { property_id: propertyId, numero, cartorio, conferir });
    setOcupado(false);
    if (!r.ok) { setMsg({ ok: false, texto: r.erro.mensagem }); return; }
    const j = r.dados;
    setSalvo({ numero: j.matricula.numero, cartorio: j.matricula.cartorio ?? "" });
    setConferidaEm(j.matricula.conferida_em);
    setMsg({ ok: true, texto: conferir ? "Matrícula conferida." : "Matrícula gravada." });
  }

  const campo = "w-full rounded-lg border border-linha-forte bg-superficie-2 px-3 py-2 text-sm text-texto focus:border-verde focus:outline-none focus:ring-2 focus:ring-verde/30";
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-sm text-texto-2">
          <span>Número da matrícula</span>
          <input className={campo} value={numero} maxLength={120} onChange={(e) => setNumero(e.target.value)} placeholder="Não informado pelo anunciante" />
        </label>
        <label className="space-y-1 text-sm text-texto-2">
          <span>Cartório de registro</span>
          <input className={campo} value={cartorio} maxLength={200} onChange={(e) => setCartorio(e.target.value)} placeholder="Ex.: CRI de Iturama" />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {conferidaEm && !mudou ? (
          <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-verde">
            <BadgeCheck className="size-4" /> Conferida em {new Date(conferidaEm).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}
          </span>
        ) : (
          <button type="button" disabled={ocupado || !numero.trim()} onClick={() => gravar(true)}
            className="btn-verde inline-flex items-center gap-1.5 px-4 py-2 text-sm disabled:opacity-50">
            <BadgeCheck className="size-4" /> Conferi com o documento
          </button>
        )}
        {mudou && (
          <button type="button" disabled={ocupado || !numero.trim()} onClick={() => gravar(false)}
            className="btn-contorno inline-flex items-center gap-1.5 px-4 py-2 text-sm disabled:opacity-50">
            <Save className="size-4" /> Gravar sem conferir
          </button>
        )}
        {msg && <span className={`text-sm ${msg.ok ? "text-verde" : "text-critico"}`} role="status">{msg.texto}</span>}
      </div>
      <p className="text-xs text-texto-2 leading-relaxed">
        Confira o número com o documento da matrícula no bloco Documentos. No site aparece só o selo
        “Matrícula conferida pela Arini”; o número fica com a equipe.
      </p>
    </div>
  );
}
