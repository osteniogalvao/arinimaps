"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { CAMPO_COMPACTO } from "@/components/admin/estilos";
import { FLUXO_STATUS, type Material } from "@/lib/fluxo-imovel";

type Evento = { id: string; acao: string; para_status: string | null; texto: string | null; autor_nome: string | null; created_at: string };

const PASSOS = [
  ["enviado", "Operações envia"], ["em_producao", "Marketing produz"], ["aguardando_aprovacao", "Diretoria aprova"], ["aprovado", "Pronto para divulgar"],
] as const;
const ACAO: Record<string, string> = {
  enviar: "Enviado ao Marketing", iniciar: "Produção iniciada", material: "Material adicionado", remover_material: "Material removido",
  enviar_aprovacao: "Enviado para aprovação", aprovar: "Aprovado pela Diretoria", ajustes: "Ajustes pedidos",
};

/** Painel do fluxo captação → Marketing → Diretoria de um imóvel. */
export default function FluxoImovel({ propertyId, status, material, eventos, pode }: {
  propertyId: string; status: string | null; material: Material[]; eventos: Evento[];
  pode: { operacoes: boolean; marketing: boolean; diretoria: boolean };
}) {
  const router = useRouter();
  const [texto, setTexto] = useState("");
  const [mat, setMat] = useState({ titulo: "", url: "" });
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState("");

  async function agir(corpo: Record<string, unknown>) {
    setOcupado(true); setErro("");
    const r = await fetch("/api/admin/imoveis/fluxo", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ property_id: propertyId, ...corpo }) }).catch(() => null);
    setOcupado(false);
    if (!r?.ok) { setErro((await r?.json().catch(() => ({})))?.error ?? "Não foi possível salvar."); return false; }
    setTexto(""); router.refresh();
    return true;
  }
  const idx = status === "ajustes" ? 1 : PASSOS.findIndex(([s]) => s === status);
  const btn = "btn-contorno px-3 py-1.5 text-sm disabled:opacity-50";

  return (
    <div className="space-y-4">
      <ol className="flex flex-wrap gap-2 text-xs">
        {PASSOS.map(([s, rotulo], i) => (
          <li key={s} className={"rounded-full border px-3 py-1 " + (i < idx || status === "aprovado" ? "border-verde bg-verde/12 text-verde" : i === idx ? "border-ouro bg-ouro/15 font-semibold" : "border-linha text-texto-2")}>
            {i + 1}. {rotulo}
          </li>
        ))}
      </ol>
      <p className="text-sm">Situação: <strong>{status ? FLUXO_STATUS[status] : "Ainda não enviado ao Marketing"}</strong></p>

      {!!material.length && (
        <ul className="space-y-1 text-sm">
          {material.map((m) => (
            <li key={m.url} className="flex items-center justify-between gap-2">
              <a href={m.url} target="_blank" rel="noreferrer" className="truncate text-verde underline">{m.titulo}</a>
              {pode.marketing && status !== "aprovado" && <button disabled={ocupado} onClick={() => agir({ acao: "remover_material", url: m.url })} className="text-xs text-critico underline">remover</button>}
            </li>
          ))}
        </ul>
      )}

      {pode.marketing && status && status !== "aprovado" && (
        <form className="flex flex-wrap gap-2" onSubmit={async (e) => { e.preventDefault(); if (await agir({ acao: "material", ...mat })) setMat({ titulo: "", url: "" }); }}>
          <input value={mat.titulo} onChange={(e) => setMat({ ...mat, titulo: e.target.value })} placeholder="Ex.: Fotos editadas" className={CAMPO_COMPACTO + " w-44"} />
          <input value={mat.url} onChange={(e) => setMat({ ...mat, url: e.target.value })} placeholder="https://… (Drive, Canva, vídeo)" className={CAMPO_COMPACTO + " min-w-0 flex-1"} />
          <button disabled={ocupado} className={btn}>Adicionar material</button>
        </form>
      )}

      <div className="space-y-2">
        <textarea value={texto} onChange={(e) => setTexto(e.target.value)} rows={2} placeholder="Observação para o próximo setor (opcional; obrigatória ao pedir ajustes)" className={CAMPO_COMPACTO + " w-full"} />
        <div className="flex flex-wrap gap-2">
          {pode.operacoes && (!status || status === "aprovado") && <button disabled={ocupado} onClick={() => agir({ acao: "enviar", texto })} className="btn-verde px-3 py-1.5 text-sm">{status ? "Enviar de novo ao Marketing" : "Enviar ao Marketing"}</button>}
          {pode.marketing && ["enviado", "ajustes"].includes(status ?? "") && <button disabled={ocupado} onClick={() => agir({ acao: "iniciar", texto })} className={btn}>Iniciar produção</button>}
          {pode.marketing && ["enviado", "em_producao", "ajustes"].includes(status ?? "") && <button disabled={ocupado} onClick={() => agir({ acao: "enviar_aprovacao", texto })} className="btn-verde px-3 py-1.5 text-sm">Enviar para a Diretoria aprovar</button>}
          {pode.diretoria && status === "aguardando_aprovacao" && <>
            <button disabled={ocupado} onClick={() => agir({ acao: "aprovar", texto })} className="btn-verde px-3 py-1.5 text-sm">Aprovar</button>
            <button disabled={ocupado} onClick={() => agir({ acao: "ajustes", texto })} className={btn}>Pedir ajustes</button>
          </>}
        </div>
        {erro && <p className="text-xs text-critico" role="alert">{erro}</p>}
      </div>

      {!!eventos.length && (
        <ul className="space-y-1 border-t border-linha pt-3 text-xs text-texto-2">
          {eventos.map((e) => (
            <li key={e.id}>
              {new Date(e.created_at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })} · {ACAO[e.acao] ?? e.acao}
              {e.autor_nome ? ` · ${e.autor_nome}` : ""}{e.texto ? ` · ${e.texto}` : ""}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
