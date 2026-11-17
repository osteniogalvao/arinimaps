"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarDays, Clock, Plus, Search } from "lucide-react";
import { PRIORIDADES, PRIORIDADE_CRM_LABEL, type CampoCrm, type Etapa, type ItemCrm, type Prioridade } from "@/lib/crmSetores";
import { CAMPO_COMPACTO } from "@/components/admin/estilos";
import CampoDado from "./CampoDado";
import { crm } from "./api";

/** Quadro do funil: uma coluna por etapa, mover pelo seletor ou arrastando. */
const COR_PRIORIDADE: Record<Prioridade, string> = {
  baixa: "bg-superficie-2 text-texto-2", normal: "", alta: "bg-ouro/14 text-ouro", urgente: "bg-critico/12 text-critico",
};

export default function QuadroCrm({ pipelineId, etapas, campos, itens, equipe, souEu, comExtras = false }: {
  pipelineId: string; etapas: Etapa[]; campos: CampoCrm[]; itens: ItemCrm[]; equipe: { user_id: string; nome: string }[]; souEu: string;
  /** a migration 0148 já rodou (prioridade, prazo final e etiquetas) */
  comExtras?: boolean;
}) {
  const router = useRouter();
  const [erro, setErro] = useState("");
  const [novo, setNovo] = useState<{ titulo: string; responsavel: string; dados: Record<string, unknown>; prioridade: string; prazo_final: string } | null>(null);
  const [arrastando, setArrastando] = useState<string | null>(null);
  const [agora] = useState(() => Date.now());
  const [busca, setBusca] = useState("");
  const [quem, setQuem] = useState("");
  const [prioridade, setPrioridade] = useState("");
  const termo = busca.trim().toLowerCase();
  const visiveis = itens.filter((i) =>
    (!termo || i.titulo.toLowerCase().includes(termo) || i.codigo.toLowerCase().includes(termo) || (i.etiquetas ?? []).some((t) => t.includes(termo))
      || Object.values(i.dados ?? {}).some((v) => typeof v === "string" && v.toLowerCase().includes(termo)))
    && (!quem || (quem === "sem" ? !i.responsavel : i.responsavel === quem))
    && (!prioridade || (i.prioridade ?? "normal") === prioridade));
  const atrasados = itens.filter((i) => (i.prazo_etapa && +new Date(i.prazo_etapa) < agora) || (i.prazo_final && new Date(`${i.prazo_final}T23:59:59-03:00`).getTime() < agora)).length;
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
        {!novo && <button type="button" onClick={() => setNovo({ titulo: "", responsavel: souEu, dados: {}, prioridade: "normal", prazo_final: "" })} className="btn-verde inline-flex items-center gap-1.5 px-4 py-2 text-sm"><Plus className="size-4" /> Novo item</button>}
        <label className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-texto-2" />
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar título, código, campo" aria-label="Buscar" className={CAMPO_COMPACTO + " w-60 pl-8"} />
        </label>
        <select value={quem} onChange={(e) => setQuem(e.target.value)} className={CAMPO_COMPACTO} aria-label="Responsável">
          <option value="">Todos</option>
          <option value={souEu}>Meus itens</option>
          <option value="sem">Sem responsável</option>
          {equipe.filter((m) => m.user_id !== souEu).map((m) => <option key={m.user_id} value={m.user_id}>{m.nome}</option>)}
        </select>
        {comExtras && (
          <select value={prioridade} onChange={(e) => setPrioridade(e.target.value)} className={CAMPO_COMPACTO} aria-label="Prioridade">
            <option value="">Qualquer prioridade</option>
            {PRIORIDADES.map((x) => <option key={x} value={x}>{PRIORIDADE_CRM_LABEL[x]}</option>)}
          </select>
        )}
        <span className="text-sm text-texto-2">{itens.length} em aberto{atrasados ? <b className="text-critico"> · {atrasados} com prazo vencido</b> : null}</span>
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
          {comExtras && <>
            <select className={CAMPO_COMPACTO} value={novo.prioridade} onChange={(e) => setNovo({ ...novo, prioridade: e.target.value })} aria-label="Prioridade">
              {PRIORIDADES.map((x) => <option key={x} value={x}>Prioridade {PRIORIDADE_CRM_LABEL[x].toLowerCase()}</option>)}
            </select>
            <label className="flex items-center gap-2 text-sm">Prazo final
              <input type="date" className={CAMPO_COMPACTO} value={novo.prazo_final} onChange={(e) => setNovo({ ...novo, prazo_final: e.target.value })} /></label>
          </>}
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
          const daEtapa = visiveis.filter((i) => i.etapa_id === e.id);
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
                  const atrasado = !!i.prazo_etapa && +new Date(i.prazo_etapa) < agora;
                  const vencido = !!i.prazo_final && new Date(`${i.prazo_final}T23:59:59-03:00`).getTime() < agora;
                  const pr = (i.prioridade ?? "normal") as Prioridade;
                  return (
                    <div key={i.id} draggable onDragStart={() => setArrastando(i.id)}
                      className={"cartao space-y-1.5 p-3 text-sm " + (atrasado ? "border-critico/50" : "")}>
                      {pr !== "normal" && <span className={"inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold " + COR_PRIORIDADE[pr]}>{PRIORIDADE_CRM_LABEL[pr]}</span>}
                      <Link href={`/admin/crm/item/${i.id}`} className="block font-medium text-texto hover:text-verde">{i.titulo}</Link>
                      <p className="flex items-center gap-1.5 text-xs text-texto-2">
                        <span className="font-mono">{i.codigo}</span> · {nome.get(i.responsavel ?? "") ?? "sem responsável"}
                      </p>
                      {i.prazo_final && <p className={"flex items-center gap-1 text-xs " + (vencido ? "font-semibold text-critico" : "text-texto-2")}><CalendarDays className="size-3" /> entrega até {new Date(`${i.prazo_final}T12:00:00`).toLocaleDateString("pt-BR")}</p>}
                      {!!i.etiquetas?.length && <p className="flex flex-wrap gap-1">{i.etiquetas.map((t) => <span key={t} className="rounded-full bg-superficie-2 px-1.5 py-0.5 text-[10px] text-texto-2">{t}</span>)}</p>}
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
