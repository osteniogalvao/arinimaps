"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { CAMPO_COMPACTO } from "@/components/admin/estilos";
import { nomeSetor, SETORES_ATENDIMENTO } from "@/lib/atendimento-rotulos";
import { DIAS_SEMANA, type HorarioSetor } from "@/lib/atendimento-horario";

type Menu = {
  ativo: boolean; saudacao: string; confirmacao: string; nao_entendi: string; fora_expediente: string;
  max_tentativas: number; setor_escape: string | null; expira_minutos: number; reenviar_apos_horas: number;
  // 0170 (Ari no WhatsApp): ausentes antes da migration
  ari_ativo?: boolean; ari_limite_dia?: number;
};
type Opcao = { id: string; ordem: number; chave: string; rotulo: string; setor: string | null; responsavel: string | null; etiqueta: string | null; confirmacao: string | null; ativo: boolean; acao?: "setor" | "ari" };
type Resposta = { id: string; atalho: string; titulo: string; texto: string; setor: string | null };
type Pessoa = { user_id: string; nome: string; diretoria: boolean; recepcao: boolean; setores: string[] };

const CAMPO = CAMPO_COMPACTO + " mt-1 w-full";

export default function ConfigAtendimento({ menu, opcoes, respostas, equipe, prazo, horarios, chatSite, telegram }: {
  menu: Menu; opcoes: Opcao[]; respostas: Resposta[]; equipe: Pessoa[]; prazo: number;
  horarios: HorarioSetor[] | null; chatSite: boolean; telegram: boolean;
}) {
  const router = useRouter();
  const [m, setM] = useState(menu);
  const [novaOpcao, setNovaOpcao] = useState({ chave: "", rotulo: "", setor: "", etiqueta: "", ordem: opcoes.length + 1 });
  const [novaResp, setNovaResp] = useState({ atalho: "", titulo: "", texto: "", setor: "" });
  const [minutos, setMinutos] = useState(prazo);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function salvar(corpo: Record<string, unknown>, ok = "Salvo.") {
    setOcupado(true); setAviso(null);
    const r = await fetch("/api/admin/atendimento/configuracao", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) }).catch(() => null);
    setOcupado(false);
    const j = await r?.json().catch(() => ({}));
    if (!r?.ok) { setAviso({ ok: false, texto: j?.error ?? "Não foi possível salvar." }); return false; }
    setAviso({ ok: true, texto: ok }); router.refresh();
    return true;
  }

  const previa = `${m.saudacao.replaceAll("{{nome}}", ", Maria")}\n\n${opcoes.filter((o, i, t) => o.ativo && t.findIndex((x) => x.ativo && x.rotulo.trim().toLowerCase() === o.rotulo.trim().toLowerCase()) === i).map((o) => `*${o.chave}* - ${o.rotulo}`).join("\n")}`;

  return (
    <div className="space-y-6">
      {aviso && <p role="status" className={"cartao px-4 py-3 text-sm " + (aviso.ok ? "text-verde" : "text-critico")}>{aviso.texto}</p>}

      <section className="cartao space-y-3 p-5">
        <h2 className="text-lg font-semibold">Menu automático</h2>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={m.ativo} onChange={(e) => setM({ ...m, ativo: e.target.checked })} /> Menu ligado (desligado: toda conversa nova cai na caixa central)</label>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="text-xs">Saudação (use {"{{nome}}"} para o primeiro nome)
            <textarea rows={3} value={m.saudacao} onChange={(e) => setM({ ...m, saudacao: e.target.value })} className={CAMPO} />
          </label>
          <label className="text-xs">Confirmação (use {"{{setor}}"})
            <textarea rows={3} value={m.confirmacao} onChange={(e) => setM({ ...m, confirmacao: e.target.value })} className={CAMPO} />
          </label>
          <label className="text-xs">Quando a resposta não é uma opção
            <textarea rows={2} value={m.nao_entendi} onChange={(e) => setM({ ...m, nao_entendi: e.target.value })} className={CAMPO} />
          </label>
          <label className="text-xs">Aviso fora do expediente (mesmo horário do rodízio; vazio = não avisa)
            <textarea rows={2} value={m.fora_expediente} onChange={(e) => setM({ ...m, fora_expediente: e.target.value })} className={CAMPO} />
          </label>
          <label className="text-xs">Tentativas antes de desistir
            <input type="number" min={1} max={5} value={m.max_tentativas} onChange={(e) => setM({ ...m, max_tentativas: Number(e.target.value) })} className={CAMPO} />
          </label>
          <label className="text-xs">Quem errou todas as tentativas vai para
            <select value={m.setor_escape ?? ""} onChange={(e) => setM({ ...m, setor_escape: e.target.value || null })} className={CAMPO}>
              <option value="">Caixa central</option>
              {SETORES_ATENDIMENTO.map((s) => <option key={s} value={s}>{nomeSetor(s)}</option>)}
            </select>
          </label>
          <label className="text-xs">Menu aberto expira em (minutos)
            <input type="number" min={5} value={m.expira_minutos} onChange={(e) => setM({ ...m, expira_minutos: Number(e.target.value) })} className={CAMPO} />
          </label>
          <label className="text-xs">Conversa resolvida recebe o menu de novo depois de (horas)
            <input type="number" min={1} value={m.reenviar_apos_horas} onChange={(e) => setM({ ...m, reenviar_apos_horas: Number(e.target.value) })} className={CAMPO} />
          </label>
        </div>
        {m.ari_ativo !== undefined && (
          <div className="space-y-2 rounded-xl border border-linha p-3">
            <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={m.ari_ativo} onChange={(e) => setM({ ...m, ari_ativo: e.target.checked })} /> Ari no WhatsApp: consulta de imóveis pela IA</label>
            <p className="text-xs text-texto-2">
              Entra pela opção do menu marcada como &quot;Ari&quot; ou quando a primeira mensagem já é uma busca clara (ex.: &quot;fazenda de 100 ha em Iturama&quot;).
              O cliente responde <strong>0</strong>, &quot;corretor&quot; ou &quot;quero visitar&quot; para ir ao Comercial (com lead no rodízio se houver imóvel de interesse).
              A Ari para assim que alguém da equipe responde a conversa.
            </p>
            <label className="block max-w-xs text-xs">Respostas da Ari por cliente por dia (depois passa para o Comercial)
              <input type="number" min={1} max={500} value={m.ari_limite_dia ?? 40} onChange={(e) => setM({ ...m, ari_limite_dia: Number(e.target.value) })} className={CAMPO} />
            </label>
          </div>
        )}
        <details className="text-sm"><summary className="cursor-pointer text-texto-2">Como o cliente vê</summary>
          <pre className="mt-2 whitespace-pre-wrap rounded-xl bg-superficie-2 p-3 font-sans">{previa}</pre>
        </details>
        <button disabled={ocupado} onClick={() => salvar({ acao: "menu", ...m }, "Menu salvo.")} className="btn-verde px-4 py-2 text-sm">Salvar menu</button>
      </section>

      <section className="cartao space-y-3 p-5">
        <h2 className="text-lg font-semibold">Opções do menu (ramais)</h2>
        <div className="space-y-2">
          {opcoes.map((o) => <LinhaOpcao key={o.id} o={o} equipe={equipe} ocupado={ocupado} salvar={salvar} />)}
        </div>
        <form className="grid gap-2 rounded-xl border border-dashed border-linha p-3 md:grid-cols-[70px_1fr_200px_140px_auto]" onSubmit={async (e) => {
          e.preventDefault();
          if (await salvar({ acao: "opcao", ...novaOpcao }, "Opção criada.")) setNovaOpcao({ chave: "", rotulo: "", setor: "", etiqueta: "", ordem: novaOpcao.ordem + 1 });
        }}>
          <input value={novaOpcao.chave} onChange={(e) => setNovaOpcao({ ...novaOpcao, chave: e.target.value })} placeholder="Tecla" className={CAMPO_COMPACTO} />
          <input value={novaOpcao.rotulo} onChange={(e) => setNovaOpcao({ ...novaOpcao, rotulo: e.target.value })} placeholder="Texto da opção" className={CAMPO_COMPACTO} />
          <select value={novaOpcao.setor} onChange={(e) => setNovaOpcao({ ...novaOpcao, setor: e.target.value })} className={CAMPO_COMPACTO}>
            <option value="">Caixa central</option>
            {SETORES_ATENDIMENTO.map((s) => <option key={s} value={s}>{nomeSetor(s)}</option>)}
          </select>
          <input value={novaOpcao.etiqueta} onChange={(e) => setNovaOpcao({ ...novaOpcao, etiqueta: e.target.value })} placeholder="Etiqueta" className={CAMPO_COMPACTO} />
          <button disabled={ocupado} className="btn-verde px-3 py-2 text-sm">Adicionar</button>
        </form>
      </section>

      <section className="cartao space-y-3 p-5">
        <h2 className="text-lg font-semibold">Respostas prontas</h2>
        <p className="text-sm text-texto-2">No campo de resposta, digite <strong>/</strong> e o atalho.</p>
        <ul className="divide-y divide-linha">
          {respostas.map((r) => (
            <li key={r.id} className="flex flex-wrap items-start justify-between gap-2 py-2 text-sm">
              <span className="min-w-0 flex-1"><strong>/{r.atalho}</strong> · {r.titulo} <span className="text-xs text-texto-2">({r.setor ? nomeSetor(r.setor) : "todos os setores"})</span>
                <span className="block whitespace-pre-wrap text-texto-2">{r.texto}</span></span>
              <button disabled={ocupado} onClick={() => salvar({ acao: "remover_resposta", id: r.id }, "Resposta removida.")} className="text-xs text-critico underline">Remover</button>
            </li>
          ))}
        </ul>
        <form className="grid gap-2 md:grid-cols-[140px_1fr_200px]" onSubmit={async (e) => {
          e.preventDefault();
          if (await salvar({ acao: "resposta", ...novaResp }, "Resposta criada.")) setNovaResp({ atalho: "", titulo: "", texto: "", setor: "" });
        }}>
          <input value={novaResp.atalho} onChange={(e) => setNovaResp({ ...novaResp, atalho: e.target.value })} placeholder="atalho" className={CAMPO_COMPACTO} />
          <input value={novaResp.titulo} onChange={(e) => setNovaResp({ ...novaResp, titulo: e.target.value })} placeholder="Título" className={CAMPO_COMPACTO} />
          <select value={novaResp.setor} onChange={(e) => setNovaResp({ ...novaResp, setor: e.target.value })} className={CAMPO_COMPACTO}>
            <option value="">Todos os setores</option>
            {SETORES_ATENDIMENTO.map((s) => <option key={s} value={s}>{nomeSetor(s)}</option>)}
          </select>
          <textarea rows={2} value={novaResp.texto} onChange={(e) => setNovaResp({ ...novaResp, texto: e.target.value })} placeholder="Texto da resposta" className={CAMPO_COMPACTO + " md:col-span-3"} />
          <button disabled={ocupado} className="btn-verde px-3 py-2 text-sm md:col-span-3 md:justify-self-start">Adicionar resposta</button>
        </form>
      </section>

      <section className="cartao space-y-3 p-5">
        <h2 className="text-lg font-semibold">Horário e prazo por setor</h2>
        {horarios === null ? (
          <p className="text-sm text-texto-2">Disponível depois da migration 0171.</p>
        ) : (
          <>
            <p className="text-sm text-texto-2">
              Cada setor pode ter dias, horário e prazo de primeira resposta próprios. A conversa que passa do prazo vira tarefa do setor,
              e fora do horário o cliente recebe a mensagem do setor. Setor sem horário próprio segue o expediente geral e o prazo de
              {" "}{prazo} min.
            </p>
            <div className="space-y-2">
              {SETORES_ATENDIMENTO.map((s) => (
                <LinhaHorario key={s} setor={s} atual={horarios.find((h) => h.setor === s) ?? null} prazoGeral={prazo} ocupado={ocupado} salvar={salvar} />
              ))}
            </div>
          </>
        )}
      </section>

      <section className="cartao space-y-3 p-5">
        <h2 className="text-lg font-semibold">Outros canais</h2>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1" checked={chatSite} disabled={ocupado || horarios === null}
            onChange={(e) => salvar({ acao: "chat_site", ativo: e.target.checked }, e.target.checked ? "Chat do site ligado." : "Chat do site desligado.")} />
          <span>
            <strong>Chat do site.</strong> Aparece como a aba &quot;Falar com a equipe&quot; no botão da Ari, em todas as páginas do site.
            As mensagens entram aqui no atendimento, com o mesmo menu e as mesmas filas do WhatsApp.
          </span>
        </label>
        <p className="text-sm">
          <strong>Telegram.</strong>{" "}
          {telegram
            ? "Bot configurado: as conversas com o bot entram no atendimento."
            : "Ainda sem bot. Crie um bot no @BotFather e coloque TELEGRAM_BOT_TOKEN e TELEGRAM_WEBHOOK_SECRET no servidor; depois aponte o webhook para /api/webhooks/telegram."}
        </p>
      </section>

      <section className="cartao space-y-3 p-5">
        <h2 className="text-lg font-semibold">Quem atende</h2>
        <p className="text-sm text-texto-2">
          Cada pessoa vê a fila dos setores em que atua (definidos em Equipe e usuários) e o que foi atribuído a ela. A recepção também
          vê a caixa central e faz a triagem. A diretoria vê tudo.
        </p>
        <ul className="divide-y divide-linha">
          {equipe.map((p) => (
            <li key={p.user_id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
              <span><strong>{p.nome}</strong> <span className="text-xs text-texto-2">{p.diretoria ? "Diretoria (vê tudo)" : p.setores.map(nomeSetor).join(", ") || "sem setor"}</span></span>
              {!p.diretoria && (
                <label className="flex items-center gap-2 text-xs">
                  <input type="checkbox" checked={p.recepcao} disabled={ocupado} onChange={(e) => salvar({ acao: "recepcao", user_id: p.user_id, ativo: e.target.checked }, "Recepção atualizada.")} />
                  Recepção (triagem da caixa central)
                </label>
              )}
            </li>
          ))}
        </ul>
        <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); void salvar({ acao: "prazo", minutos }, "Prazo salvo."); }}>
          <label className="text-xs">Conversa sem resposta vira tarefa depois de (minutos de expediente)
            <input type="number" min={5} max={1440} value={minutos} onChange={(e) => setMinutos(Number(e.target.value))} className={CAMPO_COMPACTO + " mt-1 block"} />
          </label>
          <button disabled={ocupado} className="btn-contorno px-3 py-2 text-sm">Salvar prazo</button>
        </form>
      </section>
    </div>
  );
}

function LinhaOpcao({ o, equipe, ocupado, salvar }: {
  o: Opcao; equipe: Pessoa[]; ocupado: boolean; salvar: (c: Record<string, unknown>, ok?: string) => Promise<boolean>;
}) {
  const [v, setV] = useState(o);
  const pessoas = equipe.filter((p) => !v.setor || p.diretoria || p.setores.includes(v.setor));
  const ari = v.acao === "ari";
  return (
    <form className="grid items-end gap-2 rounded-xl border border-linha p-3 md:grid-cols-[60px_70px_1fr_180px_180px_120px_auto]" onSubmit={(e) => {
      e.preventDefault();
      // "acao" do corpo é o nome da operação; o que a opção faz vai em acao_opcao
      const { acao: acaoOpcao, ...resto } = v;
      void salvar({ ...resto, acao: "opcao", ...(acaoOpcao ? { acao_opcao: acaoOpcao } : {}) }, "Opção salva.");
    }}>
      <label className="text-[11px]">Ordem<input type="number" value={v.ordem} onChange={(e) => setV({ ...v, ordem: Number(e.target.value) })} className={CAMPO} /></label>
      <label className="text-[11px]">Tecla<input value={v.chave} onChange={(e) => setV({ ...v, chave: e.target.value })} className={CAMPO} /></label>
      <label className="text-[11px]">Texto<input value={v.rotulo} onChange={(e) => setV({ ...v, rotulo: e.target.value })} className={CAMPO} /></label>
      <label className="text-[11px]">Setor
        <select value={ari ? "__ari" : v.setor ?? ""} onChange={(e) => e.target.value === "__ari"
          ? setV({ ...v, acao: "ari", setor: null, responsavel: null })
          : setV({ ...v, ...(v.acao !== undefined ? { acao: "setor" as const } : {}), setor: e.target.value || null, responsavel: null })} className={CAMPO}>
          <option value="">Caixa central</option>
          {SETORES_ATENDIMENTO.map((s) => <option key={s} value={s}>{nomeSetor(s)}</option>)}
          {v.acao !== undefined && <option value="__ari">Ari (consulta de imóveis)</option>}
        </select>
      </label>
      <label className="text-[11px]">Direto para
        <select disabled={ari} value={v.responsavel ?? ""} onChange={(e) => setV({ ...v, responsavel: e.target.value || null })} className={CAMPO}>
          <option value="">Fila do setor</option>
          {pessoas.map((p) => <option key={p.user_id} value={p.user_id}>{p.nome}</option>)}
        </select>
      </label>
      <label className="text-[11px]">Etiqueta<input value={v.etiqueta ?? ""} onChange={(e) => setV({ ...v, etiqueta: e.target.value })} className={CAMPO} /></label>
      <span className="flex items-center gap-2">
        <label className="flex items-center gap-1 text-[11px]"><input type="checkbox" checked={v.ativo} onChange={(e) => setV({ ...v, ativo: e.target.checked })} /> Ativa</label>
        <button disabled={ocupado} className="btn-verde px-3 py-1.5 text-xs">Salvar</button>
        <button type="button" disabled={ocupado} onClick={() => salvar({ acao: "remover_opcao", id: o.id }, "Opção removida.")} className="text-xs text-critico underline">Remover</button>
      </span>
    </form>
  );
}

function LinhaHorario({ setor, atual, prazoGeral, ocupado, salvar }: {
  setor: string; atual: HorarioSetor | null; prazoGeral: number; ocupado: boolean;
  salvar: (c: Record<string, unknown>, ok?: string) => Promise<boolean>;
}) {
  const [v, setV] = useState<HorarioSetor>(atual ?? { setor, dias: [1, 2, 3, 4, 5], inicio: "08:00", fim: "18:00", prazo_minutos: prazoGeral, mensagem_fora: "" });
  const [aberto, setAberto] = useState(false);
  const resumo = atual
    ? `${DIAS_SEMANA.filter((d) => atual.dias.includes(d.n)).map((d) => d.curto).join(", ")} · ${atual.inicio}–${atual.fim} · responde em ${atual.prazo_minutos} min`
    : "Expediente geral";
  return (
    <div className="rounded-xl border border-linha p-3">
      <button type="button" onClick={() => setAberto(!aberto)} className="flex w-full flex-wrap items-center justify-between gap-2 text-left text-sm">
        <strong>{nomeSetor(setor)}</strong>
        <span className="text-xs text-texto-2">{resumo} · {aberto ? "fechar" : "editar"}</span>
      </button>
      {aberto && (
        <form className="mt-3 grid gap-3 md:grid-cols-2" onSubmit={(e) => { e.preventDefault(); void salvar({ acao: "horario", ...v }, `Horário de ${nomeSetor(setor)} salvo.`); }}>
          <fieldset className="md:col-span-2">
            <legend className="text-[11px]">Dias de atendimento</legend>
            <div className="mt-1 flex flex-wrap gap-2">
              {DIAS_SEMANA.map((d) => (
                <label key={d.n} className="flex items-center gap-1 text-xs">
                  <input type="checkbox" checked={v.dias.includes(d.n)}
                    onChange={(e) => setV({ ...v, dias: e.target.checked ? [...v.dias, d.n].sort() : v.dias.filter((x) => x !== d.n) })} />
                  {d.curto}
                </label>
              ))}
            </div>
          </fieldset>
          <label className="text-[11px]">Começa<input type="time" value={v.inicio} onChange={(e) => setV({ ...v, inicio: e.target.value })} className={CAMPO} /></label>
          <label className="text-[11px]">Termina<input type="time" value={v.fim} onChange={(e) => setV({ ...v, fim: e.target.value })} className={CAMPO} /></label>
          <label className="text-[11px]">Prazo da primeira resposta (minutos de expediente)
            <input type="number" min={5} max={1440} value={v.prazo_minutos} onChange={(e) => setV({ ...v, prazo_minutos: Number(e.target.value) })} className={CAMPO} />
          </label>
          <label className="text-[11px] md:col-span-2">Mensagem fora do horário (vazio = a do menu)
            <textarea rows={2} maxLength={1000} value={v.mensagem_fora} onChange={(e) => setV({ ...v, mensagem_fora: e.target.value })} className={CAMPO} />
          </label>
          <span className="flex items-center gap-3 md:col-span-2">
            <button disabled={ocupado} className="btn-verde px-3 py-1.5 text-xs">Salvar</button>
            {atual && (
              <button type="button" disabled={ocupado} onClick={() => salvar({ acao: "remover_horario", setor }, `${nomeSetor(setor)} voltou ao expediente geral.`)}
                className="text-xs text-critico underline">Voltar ao expediente geral</button>
            )}
          </span>
        </form>
      )}
    </div>
  );
}
