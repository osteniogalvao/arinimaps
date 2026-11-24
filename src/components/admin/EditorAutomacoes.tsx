"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { SETORES } from "@/lib/setores";

export type RegraAutomacao = {
  id?: string; versao?: number; nome: string; gatilho: string; evento: string | null;
  condicao_campo: string | null; condicao_valor: string | null; setor: string; titulo: string;
  descricao: string; prazo_dias: number; prioridade: string; intervalo_dias: number | null;
  proxima_data: string | null; ativa: boolean;
};
type Catalogo = { evento: string; nome: string; campos: string[] };
const campoNome: Record<string, string> = { entidade: "Tipo de registro", tipo: "Tipo do documento", role: "Papel do cadastro", nicho: "Perfil do cadastro", para: "Setor de destino do atendimento" };
const nova = (): RegraAutomacao => ({ nome: "", gatilho: "evento", evento: "cadastro_criado", condicao_campo: "", condicao_valor: "", setor: "operacoes", titulo: "", descricao: "", prazo_dias: 2, prioridade: "normal", intervalo_dias: 1, proxima_data: new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" }), ativa: true });

export default function EditorAutomacoes({ regras, catalogo, pronto }: { regras: RegraAutomacao[]; catalogo: Catalogo[]; pronto: boolean }) {
  const router = useRouter();
  const [regra, setRegra] = useState<RegraAutomacao | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [aviso, setAviso] = useState("");
  const campo = "mt-1 w-full rounded-lg border border-borda bg-fundo px-3 py-2 text-texto";
  const mudar = (dados: Partial<RegraAutomacao>) => setRegra(r => r && ({ ...r, ...dados }));
  async function salvar(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!regra) return;
    setSalvando(true); setAviso("");
    try {
      const response = await fetch("/api/admin/automacoes/regras", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...regra, condicao_campo: regra.condicao_campo ?? "", condicao_valor: regra.condicao_valor ?? "" }) });
      const out = await response.json();
      if (!response.ok) { setAviso(out.error ?? "Não foi possível salvar."); return; }
      setRegra(null); setAviso("Regra salva. Vale para os próximos eventos ou para a próxima data configurada."); router.refresh();
    } catch { setAviso("Falha de conexão. Tente novamente."); } finally { setSalvando(false); }
  }
  if (!pronto) return <p className="text-sm text-texto-2">Editor de regras disponível depois da migration 0168.</p>;
  return <section className="space-y-4" aria-labelledby="regras-configuraveis">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 id="regras-configuraveis" className="lp-display text-xl text-texto">Regras da Diretoria</h2>
      <button type="button" className="btn-ouro" onClick={() => { setRegra(nova()); setAviso(""); }}>Nova regra</button>
    </div>
    <p className="text-sm text-texto-2">Escolha um evento já registrado pelo sistema ou uma tarefa recorrente. Cada ocorrência cria uma tarefa no setor escolhido, com histórico e cobrança pelos prazos da Matriz. As regras não enviam mensagens, não cobram valores e não apagam registros.</p>
    {aviso && <p role="status" className="rounded-lg border border-borda p-3 text-sm">{aviso}</p>}
    <ul className="divide-y divide-borda rounded-xl border border-borda">
      {regras.map(r => <li key={r.id} className="flex flex-wrap items-center gap-3 p-4">
        <div className="min-w-48 flex-1"><p className="font-medium">{r.nome}</p><p className="text-sm text-texto-2">{r.gatilho === "recorrente" ? `A cada ${r.intervalo_dias} dia(s), próxima data ${r.proxima_data}` : catalogo.find(c => c.evento === r.evento)?.nome} · {SETORES.find(s => s.id === r.setor)?.nome} · {r.ativa ? "Ativa" : "Inativa"}</p></div>
        <button type="button" className="btn-outline" onClick={() => { setRegra({ ...r }); setAviso(""); }}>Editar {r.nome}</button>
      </li>)}
      {!regras.length && <li className="p-4 text-sm text-texto-2">Nenhuma regra personalizada. As regras gerais do sistema continuam funcionando.</li>}
    </ul>
    {regra && <form onSubmit={salvar} className="grid gap-4 rounded-xl border border-borda p-5 sm:grid-cols-2">
      <label className="text-sm">Nome da regra<input required minLength={3} maxLength={100} className={campo} value={regra.nome} onChange={e => mudar({ nome: e.target.value })} /></label>
      <label className="text-sm">Gatilho<select className={campo} value={regra.gatilho} onChange={e => mudar({ gatilho: e.target.value, evento: catalogo[0]?.evento ?? "cadastro_criado", condicao_campo: "", condicao_valor: "", intervalo_dias: regra.intervalo_dias ?? 1, proxima_data: regra.proxima_data ?? nova().proxima_data })}><option value="evento">Evento do sistema</option><option value="recorrente">Tarefa recorrente</option></select></label>
      {regra.gatilho === "evento" ? <>
        <label className="text-sm">Evento<select className={campo} value={regra.evento ?? ""} onChange={e => mudar({ evento: e.target.value, condicao_campo: "", condicao_valor: "" })}>{catalogo.map(c => <option key={c.evento} value={c.evento}>{c.nome}</option>)}</select></label>
        <label className="text-sm">Condição<select className={campo} value={regra.condicao_campo ?? ""} onChange={e => mudar({ condicao_campo: e.target.value, condicao_valor: "" })}><option value="">Todo evento desse tipo</option>{catalogo.find(c => c.evento === regra.evento)?.campos.map(c => <option key={c} value={c}>{campoNome[c] ?? c} igual a</option>)}</select></label>
        {regra.condicao_campo && <label className="text-sm">Valor exato da condição<input required maxLength={200} className={campo} value={regra.condicao_valor ?? ""} onChange={e => mudar({ condicao_valor: e.target.value })} /><span className="text-xs text-texto-2">Use o valor registrado no evento. Ex.: matricula, proprietario ou comercial, conforme o campo escolhido.</span></label>}
      </> : <>
        <label className="text-sm">Repetir a cada quantos dias<input required type="number" min={1} max={365} className={campo} value={regra.intervalo_dias ?? 1} onChange={e => mudar({ intervalo_dias: Number(e.target.value) })} /></label>
        <label className="text-sm">Próxima data<input required type="date" className={campo} value={regra.proxima_data ?? ""} onChange={e => mudar({ proxima_data: e.target.value })} /></label>
      </>}
      <label className="text-sm">Setor de destino<select className={campo} value={regra.setor} onChange={e => mudar({ setor: e.target.value })}>{SETORES.map(s => <option key={s.id} value={s.id}>{s.nome}</option>)}</select></label>
      <label className="text-sm">Título da tarefa<input required minLength={3} maxLength={180} className={campo} value={regra.titulo} onChange={e => mudar({ titulo: e.target.value })} /></label>
      <label className="text-sm sm:col-span-2">Orientação para a equipe<textarea maxLength={2000} className={campo} value={regra.descricao} onChange={e => mudar({ descricao: e.target.value })} /></label>
      <label className="text-sm">Prazo da tarefa em dias<input required type="number" min={0} max={365} className={campo} value={regra.prazo_dias} onChange={e => mudar({ prazo_dias: Number(e.target.value) })} /></label>
      <label className="text-sm">Prioridade<select className={campo} value={regra.prioridade} onChange={e => mudar({ prioridade: e.target.value })}>{["baixa", "normal", "alta", "urgente"].map(p => <option key={p} value={p}>{p}</option>)}</select></label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={regra.ativa} onChange={e => mudar({ ativa: e.target.checked })} />Regra ativa</label>
      <p className="text-xs text-texto-2 sm:col-span-2">Somente próximos eventos após salvar. Recorrências usam a data de São Paulo e não recriam períodos perdidos. Desativar preserva tarefas já criadas. O motor verifica a cada 10 minutos; “Rodar agora” antecipa a verificação.</p>
      <div className="flex gap-3 sm:col-span-2"><button disabled={salvando} className="btn-ouro" type="submit">{salvando ? "Salvando…" : "Salvar regra"}</button><button disabled={salvando} className="btn-outline" type="button" onClick={() => setRegra(null)}>Cancelar</button></div>
    </form>}
  </section>;
}
