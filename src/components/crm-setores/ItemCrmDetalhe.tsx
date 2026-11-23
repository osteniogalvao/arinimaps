"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PRIORIDADES, PRIORIDADE_CRM_LABEL, camposFaltando, type CampoCrm, type Etapa, type ItemCrm } from "@/lib/crmSetores";
import { CAMPO_COMPACTO } from "@/components/admin/estilos";
import CampoDado from "./CampoDado";
import { crm } from "./api";

/** Edição do item: campos do funil, responsável, etapa e situação. */
type Membro = { user_id: string; nome: string; setores?: string[] };
type Funil = { id: string; nome: string; setor: string; setorNome: string };

export default function ItemCrmDetalhe({ item, etapas, campos, equipe, setorDoFunil, funis = [] }: {
  item: ItemCrm; etapas: Etapa[]; campos: CampoCrm[]; equipe: Membro[];
  /** setor do funil: quem é dele aparece primeiro na lista de delegação */
  setorDoFunil?: string;
  /** funis de outros setores, para encaminhar */
  funis?: Funil[];
}) {
  const router = useRouter();
  const comExtras = item.prioridade !== undefined;
  const [f, setF] = useState({
    titulo: item.titulo, descricao: item.descricao ?? "", responsavel: item.responsavel ?? "", dados: { ...(item.dados ?? {}) },
    ...(comExtras ? { prioridade: item.prioridade ?? "normal", prazo_final: item.prazo_final ?? "", etiquetas: (item.etiquetas ?? []).join(", ") } : {}),
  });
  const [erro, setErro] = useState("");
  const [ok, setOk] = useState("");
  const aberto = item.status === "aberto";
  const [delegar, setDelegar] = useState({ para: "", nota: "" });
  const [encaminhar, setEncaminhar] = useState({ funil: "", para: "", motivo: "" });
  const doSetor = (m: Membro, setor?: string) => !setor || !m.setores || m.setores.includes(setor);
  const ordenar = (setor?: string) => [...equipe].sort((x, y) => Number(doSetor(y, setor)) - Number(doSetor(x, setor)) || x.nome.localeCompare(y.nome, "pt-BR"));
  const funilDestino = funis.find((x) => x.id === encaminhar.funil);
  const atual = etapas.find((e) => e.id === item.etapa_id);
  const proxima = etapas.find((e) => e.ordem > (atual?.ordem ?? -1));
  const faltaProxima = proxima ? camposFaltando(campos, etapas, proxima.id, f.dados) : [];

  async function chamar(corpo: Record<string, unknown>, aviso: string) {
    setErro(""); setOk("");
    const e = await crm({ id: item.id, ...corpo });
    if (e) { setErro(e); return false; }
    setOk(aviso); router.refresh();
    return true;
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
            {ordenar(setorDoFunil).map((m) => <option key={m.user_id} value={m.user_id}>{m.nome}{doSetor(m, setorDoFunil) ? "" : " (outro setor)"}</option>)}
          </select></label>
        {comExtras ? (
          <label className="text-sm"><span className="mb-1 block font-semibold">Prioridade</span>
            <select className={CAMPO_COMPACTO + " w-full"} value={f.prioridade} onChange={(e) => setF({ ...f, prioridade: e.target.value as typeof f.prioridade })}>
              {PRIORIDADES.map((x) => <option key={x} value={x}>{PRIORIDADE_CRM_LABEL[x]}</option>)}
            </select></label>
        ) : <div />}
        {comExtras && <>
          <label className="text-sm"><span className="mb-1 block font-semibold">Prazo final</span>
            <input type="date" className={CAMPO_COMPACTO + " w-full"} value={f.prazo_final} onChange={(e) => setF({ ...f, prazo_final: e.target.value })} /></label>
          <label className="text-sm"><span className="mb-1 block font-semibold">Etiquetas</span>
            <input className={CAMPO_COMPACTO + " w-full"} value={f.etiquetas} placeholder="separe por vírgula" onChange={(e) => setF({ ...f, etiquetas: e.target.value })} /></label>
        </>}
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

      {aberto && <div className="grid gap-4 md:grid-cols-2">
        <form className="cartao space-y-3 p-5 text-sm" onSubmit={(e) => {
          e.preventDefault();
          void chamar({ acao: "delegar_item", responsavel: delegar.para || null, nota: delegar.nota }, "Item delegado. A pessoa recebe o aviso na Central.")
            .then((feito) => { if (feito) setDelegar({ para: "", nota: "" }); });
        }}>
          <h3 className="font-semibold">Delegar</h3>
          <p className="text-texto-2">Passa o item para outra pessoa sem precisar preencher os campos da etapa. Quem é de outro setor também recebe e consegue abrir.</p>
          <select required aria-label="Delegar para" className={CAMPO_COMPACTO + " w-full"} value={delegar.para} onChange={(e) => setDelegar({ ...delegar, para: e.target.value })}>
            <option value="">Escolha a pessoa</option>
            {ordenar(setorDoFunil).filter((m) => m.user_id !== item.responsavel).map((m) => <option key={m.user_id} value={m.user_id}>{m.nome}{doSetor(m, setorDoFunil) ? "" : " (outro setor)"}</option>)}
          </select>
          <input className={CAMPO_COMPACTO + " w-full"} maxLength={1000} placeholder="Recado para quem recebe (opcional)" value={delegar.nota} onChange={(e) => setDelegar({ ...delegar, nota: e.target.value })} />
          <button className="btn-verde px-4 py-2" disabled={!delegar.para}>Delegar</button>
        </form>
        {funis.length > 0 && <form className="cartao space-y-3 p-5 text-sm" onSubmit={(e) => {
          e.preventDefault();
          void chamar({ acao: "encaminhar_item", pipeline_id: encaminhar.funil, responsavel: encaminhar.para || null, motivo: encaminhar.motivo },
            "Item encaminhado. Código, campos, conversa e histórico seguem com ele.").then((feito) => { if (feito) setEncaminhar({ funil: "", para: "", motivo: "" }); });
        }}>
          <h3 className="font-semibold">Encaminhar para outro setor</h3>
          <p className="text-texto-2">O item muda de funil e entra na primeira etapa do destino, com o mesmo código e todo o histórico.</p>
          <select required aria-label="Funil de destino" className={CAMPO_COMPACTO + " w-full"} value={encaminhar.funil} onChange={(e) => setEncaminhar({ ...encaminhar, funil: e.target.value, para: "" })}>
            <option value="">Escolha o setor e o funil</option>
            {funis.map((x) => <option key={x.id} value={x.id}>{x.setorNome} · {x.nome}</option>)}
          </select>
          <select aria-label="Aos cuidados de" className={CAMPO_COMPACTO + " w-full"} value={encaminhar.para} onChange={(e) => setEncaminhar({ ...encaminhar, para: e.target.value })}>
            <option value="">Sem responsável (o setor distribui)</option>
            {ordenar(funilDestino?.setor).map((m) => <option key={m.user_id} value={m.user_id}>{m.nome}{doSetor(m, funilDestino?.setor) ? "" : " (outro setor)"}</option>)}
          </select>
          <textarea required minLength={5} maxLength={1000} className={CAMPO_COMPACTO + " min-h-16 w-full"} placeholder="O que o outro setor precisa fazer"
            value={encaminhar.motivo} onChange={(e) => setEncaminhar({ ...encaminhar, motivo: e.target.value })} />
          <button className="btn-verde px-4 py-2" disabled={!encaminhar.funil || encaminhar.motivo.trim().length < 5}>Encaminhar</button>
        </form>}
      </div>}

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
