"use client";

import { useCallback, useEffect, useState } from "react";
import { Upload, FileText, ExternalLink, Check, History } from "lucide-react";
import { CAMPO, Etiqueta } from "@/components/ui/Pagina";
import { enviarJson } from "@/lib/api/enviar";

type Doc = {
  id: string; tipo: string; nome_arquivo: string | null; verificado: boolean;
  verificado_em: string | null; created_at: string; url: string | null;
  versao?: number; substituido_em?: string | null; enviado_por_nome?: string | null;
};

const TIPOS = [
  ["matricula", "Matrícula / escritura"], ["edital", "Edital do leilão"], ["ccir_itr", "CCIR / ITR"], ["car", "CAR"], ["itr", "ITR"],
  ["dwg", "Planta / DWG"], ["autorizacao", "Autorização de venda"], ["outro", "Outro"],
] as const;

const rotuloTipo = (t: string) => TIPOS.find(([v]) => v === t)?.[1] ?? t;
const data = (d: string) => new Date(d).toLocaleDateString("pt-BR");

/**
 * Documentos do imóvel. `podeConferir` (equipe Arini) mostra o botão de
 * conferência — aprovar e publicar exigem a matrícula conferida.
 *
 * Histórico de versões (5.8): reenviar um documento do mesmo tipo (menos
 * "Outro") cria a versão seguinte; a anterior não é apagada e aparece em
 * "Versões anteriores". A conferência vale para a versão vigente — versão
 * nova precisa ser conferida de novo.
 */
export default function DocumentosImovel({ propertyId, podeConferir = false }: { propertyId: string; podeConferir?: boolean }) {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [anteriores, setAnteriores] = useState<Doc[] | null>(null);
  const [verAnteriores, setVerAnteriores] = useState(false);
  const [tipo, setTipo] = useState("matricula");
  const [ocupado, setOcupado] = useState(false);
  // mensagem com tom: sucesso em verde, falha em vermelho
  const [msg, setMsg] = useState<{ texto: string; erro: boolean } | null>(null);

  const carregar = useCallback(async (versoes: boolean) => {
    const res = await fetch(`/api/imoveis/${propertyId}/documentos${versoes ? "?versoes=1" : ""}`);
    if (!res.ok) return;
    const d = await res.json().catch(() => ({}));
    setDocs(d.documentos ?? []);
    setAnteriores(versoes ? d.anteriores ?? [] : null);
  }, [propertyId]);

  useEffect(() => { carregar(verAnteriores); }, [carregar, verAnteriores]);

  const jaTem = docs.some((d) => d.tipo === tipo) && tipo !== "outro";
  const temHistorico = docs.some((d) => (d.versao ?? 1) > 1);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <select className={`${CAMPO} !w-auto min-w-52`}
          value={tipo} onChange={(e) => setTipo(e.target.value)}>
          {TIPOS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <label className={`inline-flex cursor-pointer items-center gap-2 px-5 py-3 text-sm ${ocupado ? "rounded-[10px] bg-superficie-2 font-semibold text-texto-2" : "btn-verde"}`}>
          <Upload className="size-4" />
          {ocupado ? "Enviando…" : jaTem ? "Enviar nova versão" : "Anexar arquivo"}
          <input type="file" className="hidden" disabled={ocupado} onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (!f) return;
            setOcupado(true);
            setMsg(null);
            const fd = new FormData();
            fd.set("arquivo", f);
            fd.set("tipo", tipo);
            try {
              const res = await fetch(`/api/imoveis/${propertyId}/documentos`, { method: "POST", body: fd });
              const r = await res.json().catch(() => ({}));
              if (res.ok) {
                setMsg({
                  erro: false,
                  texto: r.versao > 1
                    ? `Versão ${r.versao} anexada. A anterior ficou guardada em “Versões anteriores”${podeConferir ? "" : " e a nova aguarda conferência da Arini"}.`
                    : "Documento anexado.",
                });
                carregar(verAnteriores);
              } else {
                setMsg({ erro: true, texto: r.error ?? `Falha no envio (${res.status}).` });
              }
            } catch {
              setMsg({ erro: true, texto: "O servidor não respondeu. Confira a internet e tente de novo." });
            } finally {
              setOcupado(false);
            }
          }} />
        </label>
        {jaTem && <span className="text-sm text-texto-2">Já existe {rotuloTipo(tipo).toLowerCase()}: o envio vira a próxima versão.</span>}
      </div>
      {msg && <p role={msg.erro ? "alert" : "status"} className={`text-sm ${msg.erro ? "text-critico" : "text-verde"}`}>{msg.texto}</p>}
      <ul className="divide-y divide-linha rounded-xl border border-linha">
        {docs.map((d) => (
          <li key={d.id} className="flex flex-wrap items-center gap-3 px-4 py-3.5 transition-colors hover:bg-superficie-2/60">
            <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-superficie-2 text-texto-2">
              <FileText className="size-4" />
            </span>
            <span className="min-w-40 flex-1">
              <span className="flex flex-wrap items-center gap-2 text-[0.95rem] font-semibold text-texto">
                {rotuloTipo(d.tipo)}
                {(d.versao ?? 1) > 1 && <Etiqueta>versão {d.versao}</Etiqueta>}
              </span>
              {d.nome_arquivo && <span className="block truncate text-xs text-texto-2">{d.nome_arquivo}</span>}
            </span>
            <span className="text-xs tabular-nums text-texto-2">{data(d.created_at)}</span>
            {d.url && (
              <a href={d.url} target="_blank" className="inline-flex items-center gap-1 text-sm font-semibold text-verde hover:underline">
                abrir <ExternalLink className="size-3.5" />
              </a>
            )}
            {podeConferir ? (
              <button type="button" disabled={ocupado}
                onClick={async () => {
                  setOcupado(true); setMsg(null);
                  const r = await enviarJson(`/api/imoveis/${propertyId}/documentos`, "PATCH",
                    { documento_id: d.id, verificado: !d.verificado });
                  setOcupado(false);
                  if (r.ok) carregar(verAnteriores); else setMsg({ erro: true, texto: r.erro.mensagem });
                }}
                className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${d.verificado ? "border-verde/40 bg-verde/10 text-verde" : "border-linha-forte text-texto-2 hover:border-verde hover:text-texto"}`}>
                {d.verificado ? <>conferido <Check className="size-3.5" /></> : "marcar como conferido"}
              </button>
            ) : d.verificado ? (
              <Etiqueta tom="verde"><Check className="size-3.5" /> conferido pela Arini</Etiqueta>
            ) : (
              <Etiqueta>aguardando conferência</Etiqueta>
            )}
          </li>
        ))}
        {!docs.length && <li className="px-4 py-5 text-sm text-texto-2">Nenhum documento ainda.</li>}
      </ul>

      {(temHistorico || verAnteriores) && (
        <div className="space-y-2">
          <button type="button" onClick={() => setVerAnteriores(!verAnteriores)}
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-verde hover:underline">
            <History className="size-4" />
            {verAnteriores ? "Ocultar versões anteriores" : "Ver versões anteriores"}
          </button>
          {verAnteriores && (
            <ul className="divide-y divide-linha rounded-xl border border-linha bg-superficie-2 px-4 text-sm">
              {(anteriores ?? []).map((d) => (
                <li key={d.id} className="flex flex-wrap items-center gap-3 py-3 text-texto-2">
                  <span className="min-w-40 flex-1">
                    <span className="block text-texto">
                      {rotuloTipo(d.tipo)} <span className="text-xs">· versão {d.versao ?? 1}</span>
                    </span>
                    <span className="block truncate text-xs">
                      {d.nome_arquivo ?? "arquivo"} · enviada em {data(d.created_at)}
                      {d.substituido_em && ` · substituída em ${data(d.substituido_em)}`}
                      {d.enviado_por_nome && ` · por ${d.enviado_por_nome}`}
                      {d.verificado && " · tinha sido conferida"}
                    </span>
                  </span>
                  {d.url && <a href={d.url} target="_blank" className="text-sm font-semibold text-verde hover:underline">abrir</a>}
                </li>
              ))}
              {anteriores && !anteriores.length && <li className="py-3 text-xs">Nenhuma versão anterior.</li>}
              {!anteriores && <li className="py-3 text-xs">Carregando…</li>}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
