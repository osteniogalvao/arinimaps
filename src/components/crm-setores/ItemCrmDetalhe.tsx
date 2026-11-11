"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { camposFaltando, type CampoCrm, type Etapa, type ItemCrm } from "@/lib/crmSetores";
import { CAMPO_COMPACTO } from "@/components/admin/estilos";
import CampoDado from "./CampoDado";
import { crm } from "./api";

/** Edição do item: campos do funil, responsável, etapa e situação. */
export default function ItemCrmDetalhe({ item, etapas, campos, equipe }: {
  item: ItemCrm; etapas: Etapa[]; campos: CampoCrm[]; equipe: { user_id: string; nome: string }[];
}) {
  const router = useRouter();
  const [f, setF] = useState({ titulo: item.titulo, descricao: item.descricao ?? "", responsavel: item.responsavel ?? "", dados: { ...(item.dados ?? {}) } });
  const [erro, setErro] = useState("");
  const [ok, setOk] = useState("");
  const aberto = item.status === "aberto";
  const atual = etapas.find((e) => e.id === item.etapa_id);
  const proxima = etapas.find((e) => e.ordem > (atual?.ordem ?? -1));
  const faltaProxima = proxima ? camposFaltando(campos, etapas, proxima.id, f.dados) : [];

  async function chamar(corpo: Record<string, unknown>, aviso: string) {
    setErro(""); setOk("");
    const e = await crm({ id: item.id, ...corpo });
    if (e) { setErro(e); return; }
    setOk(aviso); router.refresh();
  }

  return (
    <div className="space-y-4">
      {(erro || ok) && <p className={"text-sm " + (erro ? "text-critico" : "text-verde")}>{erro || ok}</p>}
      <form className="cartao grid gap-4 p-5 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); void chamar({ acao: "editar_item", ...f }, "Salvo."); }}>
        <label className="text-sm sm:col-span-2"><span className="mb-1 block font-semibold">Título</span>
          <input className={CAMPO_COMPACTO + " w-full"} value={f.titulo} onChange={(e) => setF({ ...f, titulo: e.target.value })} /></label>
        <label className="text-sm"><span className="mb-1 block font-semibold">Responsável</span>
          <select className={CAMPO_COMPACTO + " w-full"} value={f.responsavel} onChange={(e) => setF({ ...f, responsavel: e.target.value })}>
            <option value="">Sem responsável</option>
            {equipe.map((m) => <option key={m.user_id} value={m.user_id}>{m.nome}</option>)}
          </select></label>
        <div />
        {campos.map((c) => {
          const exigido = c.exigido_desde ? etapas.find((e) => e.id === c.exigido_desde) : null;
          return (
            <label key={c.id} className={"text-sm " + (c.tipo === "textarea" ? "sm:col-span-2" : "")}>
              <span className="mb-1 block font-semibold">{c.rotulo}{exigido && <span className="ml-1 font-normal text-texto-2">(obrigatório em {exigido.nome})</span>}</span>
              <CampoDado c={c} valor={f.dados[c.chave]} onChange={(v) => setF({ ...f, dados: { ...f.dados, [c.chave]: v } })} />
            </label>
          );
        })}
        <label className="text-sm sm:col-span-2"><span className="mb-1 block font-semibold">Descrição</span>
          <textarea className={CAMPO_COMPACTO + " min-h-24 w-full"} value={f.descricao} onChange={(e) => setF({ ...f, descricao: e.target.value })} /></label>
        <div className="sm:col-span-2"><button className="btn-verde px-4 py-2 text-sm">Salvar</button></div>
      </form>

      <div className="cartao flex flex-wrap items-center gap-2 p-5 text-sm">
        {aberto ? (
          <>
            <select aria-label="Mover para" className={CAMPO_COMPACTO} value={item.etapa_id ?? ""} onChange={(e) => void chamar({ acao: "mover_item", etapa_id: e.target.value }, "Etapa atualizada.")}>
              {etapas.map((e) => <option key={e.id} value={e.id}>{e.id === item.etapa_id ? `Em: ${e.nome}` : `Mover para ${e.nome}`}</option>)}
            </select>
            {proxima && (
              <button type="button" className="btn-verde px-4 py-2" disabled={faltaProxima.length > 0}
                title={faltaProxima.length ? `Falta: ${faltaProxima.map((c) => c.rotulo).join(", ")}` : undefined}
                onClick={() => void chamar({ acao: "mover_item", etapa_id: proxima.id }, "Etapa atualizada.")}>Avançar para {proxima.nome}</button>
            )}
            <button type="button" className="btn-contorno px-4 py-2" onClick={() => void chamar({ acao: "status_item", status: "concluido" }, "Item concluído.")}>Concluir</button>
            <button type="button" className="btn-contorno px-4 py-2 text-critico" onClick={() => {
              const motivo = prompt("Motivo do cancelamento:");
              if (motivo) void chamar({ acao: "status_item", status: "cancelado", motivo }, "Item cancelado.");
            }}>Cancelar</button>
            {faltaProxima.length > 0 && <span className="text-texto-2">Para avançar, preencha: {faltaProxima.map((c) => c.rotulo).join(", ")} (e salve).</span>}
          </>
        ) : (
          <button type="button" className="btn-contorno px-4 py-2" onClick={() => void chamar({ acao: "status_item", status: "aberto" }, "Item reaberto.")}>Reabrir</button>
        )}
      </div>
    </div>
  );
}
