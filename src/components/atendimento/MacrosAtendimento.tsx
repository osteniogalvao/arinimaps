"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2, Zap } from "lucide-react";
import { CAMPO_COMPACTO } from "@/components/admin/estilos";
import { PASSO_LABEL, type Macro, type PassoMacro } from "@/lib/atendimento-macros";

const NOVA: Omit<Macro, "id" | "criado_por"> & { id?: string } = { nome: "", passos: [{ tipo: "mensagem", texto: "" }], publica: true, ativo: true };
const resumo = (p: PassoMacro, setores: { id: string; nome: string }[]) =>
  p.tipo === "mensagem" || p.tipo === "nota" ? `${PASSO_LABEL[p.tipo]}: “${p.texto.slice(0, 60)}${p.texto.length > 60 ? "…" : ""}”`
  : p.tipo === "etiqueta" ? `Etiqueta #${p.texto}`
  : p.tipo === "transferir" ? `Transferir para ${setores.find((s) => s.id === p.setor)?.nome ?? p.setor}`
  : PASSO_LABEL[p.tipo];

/** Lista e editor das macros (0179). */
export default function MacrosAtendimento({ setores }: { setores: { id: string; nome: string }[] }) {
  const [macros, setMacros] = useState<Macro[]>([]);
  const [eu, setEu] = useState("");
  const [diretoria, setDiretoria] = useState(false);
  const [editando, setEditando] = useState<typeof NOVA | null>(null);
  const [erro, setErro] = useState("");
  const [ocupado, setOcupado] = useState(false);

  const carregar = useCallback(async () => {
    const r = await fetch("/api/admin/atendimento/macros", { cache: "no-store" });
    const j = await r.json().catch(() => ({}));
    setMacros(j.macros ?? []); setEu(j.eu ?? ""); setDiretoria(!!j.diretoria);
    setErro(j.error ?? "");
  }, []);
  useEffect(() => { void carregar(); }, [carregar]);

  async function enviar(corpo: Record<string, unknown>) {
    setOcupado(true); setErro("");
    const r = await fetch("/api/admin/atendimento/macros", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(corpo) });
    const j = await r.json().catch(() => ({}));
    setOcupado(false);
    if (!r.ok) { setErro(j.error ?? "Falha."); return false; }
    await carregar();
    return true;
  }

  const mudarPasso = (i: number, p: PassoMacro) => editando && setEditando({ ...editando, passos: editando.passos.map((x, j) => (j === i ? p : x)) });
  const mover = (i: number, d: number) => {
    if (!editando) return;
    const l = [...editando.passos]; const [x] = l.splice(i, 1); l.splice(i + d, 0, x);
    setEditando({ ...editando, passos: l });
  };
  const novoPasso = (tipo: PassoMacro["tipo"]): PassoMacro =>
    tipo === "mensagem" || tipo === "nota" || tipo === "etiqueta" ? { tipo, texto: "" }
    : tipo === "transferir" ? { tipo, setor: setores[0]?.id ?? "" } : { tipo };

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <section className="cartao overflow-hidden !p-0">
        <header className="flex items-center justify-between border-b border-linha px-5 py-3">
          <h2 className="font-semibold text-texto">Macros</h2>
          <button type="button" onClick={() => setEditando({ ...NOVA, passos: [{ tipo: "mensagem", texto: "" }] })} className="btn-verde inline-flex items-center gap-1.5 px-3 py-1.5 text-sm"><Plus className="size-4" /> Nova macro</button>
        </header>
        <ul className="divide-y divide-linha">
          {macros.map((m) => (
            <li key={m.id}>
              <button type="button" onClick={() => setEditando({ id: m.id, nome: m.nome, passos: m.passos, publica: m.publica, ativo: m.ativo })}
                disabled={m.criado_por !== eu && !diretoria}
                className={"flex w-full items-start gap-3 px-5 py-3 text-left transition-colors hover:bg-superficie-2 disabled:cursor-default disabled:hover:bg-transparent " + (editando?.id === m.id ? "bg-verde/10" : "")}>
                <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-ouro/15 text-ouro"><Zap className="size-4" /></span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2 font-medium text-texto">{m.nome}
                    <span className="rounded-full border border-linha px-2 text-[10px] font-semibold text-texto-2">{m.publica ? "Pública" : "Pessoal"}</span>
                    {!m.ativo && <span className="rounded-full bg-superficie-2 px-2 text-[10px] text-texto-2">Desligada</span>}
                  </span>
                  <span className="mt-0.5 block text-xs text-texto-2">{m.passos.map((p) => resumo(p, setores)).join(" → ")}</span>
                </span>
              </button>
            </li>
          ))}
          {!macros.length && <li className="px-5 py-10 text-center text-sm text-texto-2">{erro || "Nenhuma macro ainda. Crie a primeira."}</li>}
        </ul>
      </section>

      {editando ? (
        <form className="cartao space-y-4 p-5" onSubmit={async (e) => {
          e.preventDefault();
          if (await enviar({ acao: "salvar", ...editando })) setEditando(null);
        }}>
          <h2 className="font-semibold text-texto">{editando.id ? "Editar macro" : "Nova macro"}</h2>
          <label className="block text-xs text-texto-2">Nome
            <input value={editando.nome} onChange={(e) => setEditando({ ...editando, nome: e.target.value })} maxLength={80} required
              placeholder="Ex.: Pedir documentos e passar ao Jurídico" className={CAMPO_COMPACTO + " mt-1 block w-full"} />
          </label>
          <ol className="space-y-2">
            {editando.passos.map((p, i) => (
              <li key={i} className="rounded-xl border border-linha p-3">
                <div className="flex items-center gap-2">
                  <span className="grid size-6 shrink-0 place-items-center rounded-full bg-verde text-xs font-bold text-white">{i + 1}</span>
                  <select value={p.tipo} onChange={(e) => mudarPasso(i, novoPasso(e.target.value as PassoMacro["tipo"]))} className={CAMPO_COMPACTO + " flex-1"} aria-label="Tipo do passo">
                    {Object.entries(PASSO_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                  <button type="button" disabled={i === 0} onClick={() => mover(i, -1)} aria-label="Subir" className="p-1 text-texto-2 disabled:opacity-30"><ArrowUp className="size-4" /></button>
                  <button type="button" disabled={i === editando.passos.length - 1} onClick={() => mover(i, 1)} aria-label="Descer" className="p-1 text-texto-2 disabled:opacity-30"><ArrowDown className="size-4" /></button>
                  <button type="button" disabled={editando.passos.length === 1} onClick={() => setEditando({ ...editando, passos: editando.passos.filter((_, j) => j !== i) })} aria-label="Remover passo" className="p-1 text-texto-2 hover:text-critico disabled:opacity-30"><Trash2 className="size-4" /></button>
                </div>
                {(p.tipo === "mensagem" || p.tipo === "nota") && (
                  <textarea value={p.texto} onChange={(e) => mudarPasso(i, { ...p, texto: e.target.value })} rows={3} maxLength={4000} required
                    placeholder={p.tipo === "mensagem" ? "Texto que o cliente recebe" : "Nota que só a equipe vê"} className={CAMPO_COMPACTO + " mt-2 block w-full resize-y"} />
                )}
                {p.tipo === "etiqueta" && (
                  <input value={p.texto} onChange={(e) => mudarPasso(i, { ...p, texto: e.target.value })} maxLength={40} required placeholder="Ex.: documentacao" className={CAMPO_COMPACTO + " mt-2 block w-full"} />
                )}
                {p.tipo === "transferir" && (
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    <select value={p.setor} onChange={(e) => mudarPasso(i, { ...p, setor: e.target.value })} className={CAMPO_COMPACTO} aria-label="Setor">
                      {setores.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
                    </select>
                    <input value={p.motivo ?? ""} onChange={(e) => mudarPasso(i, { ...p, motivo: e.target.value })} maxLength={200} placeholder="Motivo (opcional)" className={CAMPO_COMPACTO} />
                  </div>
                )}
              </li>
            ))}
          </ol>
          {editando.passos.length < 10 && (
            <button type="button" onClick={() => setEditando({ ...editando, passos: [...editando.passos, { tipo: "nota", texto: "" }] })}
              className="inline-flex items-center gap-1.5 text-sm font-semibold text-verde"><Plus className="size-4" /> Adicionar passo</button>
          )}
          <div className="flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2"><input type="checkbox" checked={editando.publica} onChange={(e) => setEditando({ ...editando, publica: e.target.checked })} /> Pública (a equipe toda usa)</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={editando.ativo} onChange={(e) => setEditando({ ...editando, ativo: e.target.checked })} /> Ligada</label>
          </div>
          {erro && <p className="text-sm text-critico" role="alert">{erro}</p>}
          <div className="flex flex-wrap gap-2">
            <button disabled={ocupado} className="btn-verde px-4 py-2 text-sm">Salvar</button>
            <button type="button" onClick={() => setEditando(null)} className="btn-contorno px-4 py-2 text-sm">Cancelar</button>
            {editando.id && (
              <button type="button" disabled={ocupado} onClick={async () => { if (await enviar({ acao: "remover", id: editando.id })) setEditando(null); }}
                className="ml-auto inline-flex items-center gap-1.5 px-3 py-2 text-sm text-critico"><Trash2 className="size-4" /> Excluir</button>
            )}
          </div>
        </form>
      ) : (
        <div className="cartao grid place-items-center p-10 text-center text-sm text-texto-2">
          <div><Zap className="mx-auto mb-3 size-8 opacity-40" />Escolha uma macro para editar ou crie uma nova.</div>
        </div>
      )}
    </div>
  );
}
