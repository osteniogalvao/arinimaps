"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { TIPOS_CAMPO, type CampoCrm, type Etapa, type Pipeline } from "@/lib/crmSetores";
import { CAMPO_COMPACTO } from "@/components/admin/estilos";
import { crm } from "./api";

/** Configuração do funil (Diretoria): nome, etapas com prazo e campos com obrigatoriedade. */
export default function ConfigFunil({ pipeline, etapas, campos }: { pipeline: Pipeline; etapas: Etapa[]; campos: CampoCrm[] }) {
  const router = useRouter();
  const [erro, setErro] = useState("");
  const [ok, setOk] = useState("");
  const [p, setP] = useState({ nome: pipeline.nome, descricao: pipeline.descricao ?? "", ativo: pipeline.ativo });
  const [es, setEs] = useState(etapas.map((e) => ({ ...e, sla: e.sla_horas == null ? "" : String(e.sla_horas) })));
  const [cs, setCs] = useState(campos.map((c) => ({ ...c, opcoesTexto: c.opcoes.join(", ") })));
  const [novaEtapa, setNovaEtapa] = useState("");
  const [novoCampo, setNovoCampo] = useState({ rotulo: "", tipo: "texto" as CampoCrm["tipo"] });

  async function chamar(corpo: Record<string, unknown>, aviso = "Salvo.") {
    setErro(""); setOk("");
    const e = await crm(corpo);
    if (e) { setErro(e); return false; }
    setOk(aviso); router.refresh(); return true;
  }

  return (
    <div className="space-y-8">
      {(erro || ok) && <p className={"text-sm " + (erro ? "text-critico" : "text-verde")}>{erro || ok}</p>}

      <section className="cartao space-y-3 p-5">
        <h2 className="font-semibold text-texto">Funil</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <input className={CAMPO_COMPACTO} value={p.nome} onChange={(e) => setP({ ...p, nome: e.target.value })} />
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={p.ativo} onChange={(e) => setP({ ...p, ativo: e.target.checked })} /> Ativo</label>
          <textarea className={CAMPO_COMPACTO + " sm:col-span-2"} placeholder="Para que serve este funil" value={p.descricao} onChange={(e) => setP({ ...p, descricao: e.target.value })} />
        </div>
        <button type="button" className="btn-verde px-4 py-2 text-sm" onClick={() => chamar({ acao: "salvar_pipeline", id: pipeline.id, setor: pipeline.setor, ...p })}>Salvar funil</button>
      </section>

      <section className="cartao space-y-3 p-5">
        <h2 className="font-semibold text-texto">Etapas</h2>
        <p className="text-sm text-texto-2">O prazo (em horas) conta a partir da entrada do item na etapa. Vencido, vira tarefa para o responsável. A etapa final conclui o item.</p>
        <div className="space-y-2">
          {es.map((e, i) => (
            <div key={e.id} className="flex flex-wrap items-center gap-2">
              <input type="number" aria-label="Ordem" className={CAMPO_COMPACTO + " w-16"} value={e.ordem} onChange={(x) => setEs(es.map((y, j) => j === i ? { ...y, ordem: Number(x.target.value) } : y))} />
              <input aria-label="Nome" className={CAMPO_COMPACTO + " w-56"} value={e.nome} onChange={(x) => setEs(es.map((y, j) => j === i ? { ...y, nome: x.target.value } : y))} />
              <input type="number" aria-label="Prazo em horas" placeholder="Prazo (h)" className={CAMPO_COMPACTO + " w-28"} value={e.sla} onChange={(x) => setEs(es.map((y, j) => j === i ? { ...y, sla: x.target.value } : y))} />
              <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={e.final} onChange={(x) => setEs(es.map((y, j) => j === i ? { ...y, final: x.target.checked } : y))} /> Final</label>
              <button type="button" className="btn-contorno px-3 py-1.5 text-sm" onClick={() => chamar({ acao: "salvar_etapa", id: e.id, nome: e.nome, ordem: e.ordem, sla_horas: e.sla, final: e.final })}>Salvar</button>
              <button type="button" aria-label="Remover etapa" className="p-1.5 text-texto-2 hover:text-critico" onClick={() => { if (confirm(`Remover a etapa "${e.nome}"?`)) void chamar({ acao: "remover_etapa", id: e.id }, "Etapa removida."); }}><Trash2 className="size-4" /></button>
            </div>
          ))}
        </div>
        <form className="flex flex-wrap gap-2" onSubmit={async (ev) => {
          ev.preventDefault();
          if (await chamar({ acao: "salvar_etapa", pipeline_id: pipeline.id, nome: novaEtapa, ordem: Math.max(0, ...es.map((x) => x.ordem)) + 1 }, "Etapa criada.")) setNovaEtapa("");
        }}>
          <input required placeholder="Nova etapa" className={CAMPO_COMPACTO + " w-56"} value={novaEtapa} onChange={(e) => setNovaEtapa(e.target.value)} />
          <button className="btn-verde inline-flex items-center gap-1 px-3 py-1.5 text-sm"><Plus className="size-4" /> Etapa</button>
        </form>
      </section>

      <section className="cartao space-y-3 p-5">
        <h2 className="font-semibold text-texto">Campos</h2>
        <p className="text-sm text-texto-2">&quot;Obrigatório a partir de&quot; impede o item de entrar naquela etapa (ou nas seguintes) sem o campo preenchido.</p>
        <div className="space-y-2">
          {cs.map((c, i) => (
            <div key={c.id} className="flex flex-wrap items-center gap-2">
              <input type="number" aria-label="Ordem" className={CAMPO_COMPACTO + " w-16"} value={c.ordem} onChange={(x) => setCs(cs.map((y, j) => j === i ? { ...y, ordem: Number(x.target.value) } : y))} />
              <input aria-label="Rótulo" className={CAMPO_COMPACTO + " w-48"} value={c.rotulo} onChange={(x) => setCs(cs.map((y, j) => j === i ? { ...y, rotulo: x.target.value } : y))} />
              <select aria-label="Tipo" className={CAMPO_COMPACTO} value={c.tipo} onChange={(x) => setCs(cs.map((y, j) => j === i ? { ...y, tipo: x.target.value as CampoCrm["tipo"] } : y))}>
                {TIPOS_CAMPO.map(([v, r]) => <option key={v} value={v}>{r}</option>)}
              </select>
              {c.tipo === "select" && <input aria-label="Opções" placeholder="Opções separadas por vírgula" className={CAMPO_COMPACTO + " w-64"} value={c.opcoesTexto} onChange={(x) => setCs(cs.map((y, j) => j === i ? { ...y, opcoesTexto: x.target.value } : y))} />}
              <select aria-label="Obrigatório a partir de" className={CAMPO_COMPACTO} value={c.exigido_desde ?? ""} onChange={(x) => setCs(cs.map((y, j) => j === i ? { ...y, exigido_desde: x.target.value || null } : y))}>
                <option value="">Opcional</option>
                {etapas.map((e) => <option key={e.id} value={e.id}>Obrigatório a partir de {e.nome}</option>)}
              </select>
              <button type="button" className="btn-contorno px-3 py-1.5 text-sm" onClick={() => chamar({ acao: "salvar_campo", id: c.id, chave: c.chave, rotulo: c.rotulo, tipo: c.tipo, opcoes: c.opcoesTexto, exigido_desde: c.exigido_desde, ordem: c.ordem })}>Salvar</button>
              <button type="button" aria-label="Remover campo" className="p-1.5 text-texto-2 hover:text-critico" onClick={() => { if (confirm(`Remover o campo "${c.rotulo}"? Os valores já gravados ficam no histórico do item.`)) void chamar({ acao: "remover_campo", id: c.id }, "Campo removido."); }}><Trash2 className="size-4" /></button>
            </div>
          ))}
        </div>
        <form className="flex flex-wrap gap-2" onSubmit={async (ev) => {
          ev.preventDefault();
          if (await chamar({ acao: "salvar_campo", pipeline_id: pipeline.id, ...novoCampo, ordem: Math.max(0, ...cs.map((x) => x.ordem)) + 1 }, "Campo criado.")) setNovoCampo({ rotulo: "", tipo: "texto" });
        }}>
          <input required placeholder="Novo campo" className={CAMPO_COMPACTO + " w-48"} value={novoCampo.rotulo} onChange={(e) => setNovoCampo({ ...novoCampo, rotulo: e.target.value })} />
          <select className={CAMPO_COMPACTO} value={novoCampo.tipo} onChange={(e) => setNovoCampo({ ...novoCampo, tipo: e.target.value as CampoCrm["tipo"] })}>
            {TIPOS_CAMPO.map(([v, r]) => <option key={v} value={v}>{r}</option>)}
          </select>
          <button className="btn-verde inline-flex items-center gap-1 px-3 py-1.5 text-sm"><Plus className="size-4" /> Campo</button>
        </form>
      </section>
    </div>
  );
}
