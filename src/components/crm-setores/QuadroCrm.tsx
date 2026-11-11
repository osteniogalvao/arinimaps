"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Clock, Plus } from "lucide-react";
import type { CampoCrm, Etapa, ItemCrm } from "@/lib/crmSetores";
import { CAMPO_COMPACTO } from "@/components/admin/estilos";
import CampoDado from "./CampoDado";
import { crm } from "./api";

/** Quadro do funil: uma coluna por etapa, mover pelo seletor ou arrastando. */
export default function QuadroCrm({ pipelineId, etapas, campos, itens, equipe, souEu }: {
  pipelineId: string; etapas: Etapa[]; campos: CampoCrm[]; itens: ItemCrm[]; equipe: { user_id: string; nome: string }[]; souEu: string;
}) {
  const router = useRouter();
  const [erro, setErro] = useState("");
  const [novo, setNovo] = useState<{ titulo: string; responsavel: string; dados: Record<string, unknown> } | null>(null);
  const [arrastando, setArrastando] = useState<string | null>(null);
  const nome = new Map(equipe.map((m) => [m.user_id, m.nome]));
  const exigidosNaEntrada = campos.filter((c) => c.exigido_desde === etapas[0]?.id);

  async function mover(itemId: string, etapaId: string) {
    setErro("");
    const e = await crm({ acao: "mover_item", id: itemId, etapa_id: etapaId });
    if (e) setErro(e); else router.refresh();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        {!novo && <button type="button" onClick={() => setNovo({ titulo: "", responsavel: souEu, dados: {} })} className="btn-verde inline-flex items-center gap-1.5 px-4 py-2 text-sm"><Plus className="size-4" /> Novo item</button>}
        {erro && <p className="text-sm text-critico">{erro}</p>}
      </div>
      {novo && (
        <form className="cartao grid gap-3 p-4 sm:grid-cols-2" onSubmit={async (e) => {
          e.preventDefault(); setErro("");
          const r = await crm({ acao: "criar_item", pipeline_id: pipelineId, ...novo });
          if (r) { setErro(r); return; }
          setNovo(null); router.refresh();
        }}>
          <input required placeholder="Título" className={CAMPO_COMPACTO} value={novo.titulo} onChange={(e) => setNovo({ ...novo, titulo: e.target.value })} />
          <select className={CAMPO_COMPACTO} value={novo.responsavel} onChange={(e) => setNovo({ ...novo, responsavel: e.target.value })}>
            {equipe.map((m) => <option key={m.user_id} value={m.user_id}>{m.nome}</option>)}
          </select>
          {exigidosNaEntrada.map((c) => (
            <label key={c.id} className="text-sm"><span className="mb-1 block font-semibold">{c.rotulo} *</span>
              <CampoDado c={c} valor={novo.dados[c.chave]} onChange={(v) => setNovo({ ...novo, dados: { ...novo.dados, [c.chave]: v } })} /></label>
          ))}
          <div className="flex gap-2 sm:col-span-2">
            <button className="btn-verde px-4 py-2 text-sm">Criar</button>
            <button type="button" onClick={() => setNovo(null)} className="btn-contorno px-4 py-2 text-sm">Cancelar</button>
          </div>
        </form>
      )}
      <div className="flex gap-4 overflow-x-auto pb-3">
        {etapas.map((e) => {
          const daEtapa = itens.filter((i) => i.etapa_id === e.id);
          return (
            <section key={e.id} className="w-72 shrink-0 rounded-2xl border border-linha bg-superficie-2/50"
              onDragOver={(ev) => ev.preventDefault()}
              onDrop={() => { if (arrastando) void mover(arrastando, e.id); setArrastando(null); }}>
              <header className="flex items-center justify-between border-b border-linha px-4 py-3">
                <span className="font-semibold text-texto">{e.nome}</span>
                <span className="text-xs text-texto-2">{daEtapa.length}{e.sla_horas ? ` · ${e.sla_horas} h` : ""}</span>
              </header>
              <div className="space-y-2 p-3">
                {daEtapa.map((i) => {
                  const atrasado = !!i.prazo_etapa && +new Date(i.prazo_etapa) < Date.now();
                  return (
                    <div key={i.id} draggable onDragStart={() => setArrastando(i.id)}
                      className={"cartao space-y-1.5 p-3 text-sm " + (atrasado ? "border-critico/50" : "")}>
                      <Link href={`/admin/crm/item/${i.id}`} className="block font-medium text-texto hover:text-verde">{i.titulo}</Link>
                      <p className="flex items-center gap-1.5 text-xs text-texto-2">
                        <span className="font-mono">{i.codigo}</span> · {nome.get(i.responsavel ?? "") ?? "sem responsável"}
                      </p>
                      {i.prazo_etapa && <p className={"flex items-center gap-1 text-xs " + (atrasado ? "text-critico" : "text-texto-2")}><Clock className="size-3" /> {new Date(i.prazo_etapa).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}</p>}
                      <select aria-label="Mover para" value={e.id} onChange={(ev) => mover(i.id, ev.target.value)} className="w-full rounded-lg border border-linha bg-superficie px-2 py-1 text-xs">
                        {etapas.map((x) => <option key={x.id} value={x.id}>{x.id === e.id ? `Em: ${x.nome}` : `Mover para ${x.nome}`}</option>)}
                      </select>
                    </div>
                  );
                })}
                {!daEtapa.length && <p className="px-1 py-4 text-center text-xs text-texto-2">Vazio</p>}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
