"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Lock, MessageCircle, Send } from "lucide-react";
import { CAMPO_COMPACTO } from "@/components/admin/estilos";
import { nomeSetor, PERFIL_LABEL, STATUS_LABEL } from "@/lib/atendimento-rotulos";

type Msg = { id: string; direcao: "entrada" | "saida"; tipo: string; texto: string | null; status: string | null; erro: string | null; enviado_por: string | null; created_at: string };
type Ev = { id: string; acao: string; de_setor: string | null; para_setor: string | null; de_user: string | null; para_user: string | null; texto: string | null; autor: string | null; created_at: string };
type Pessoa = { user_id: string; nome: string; setores: string[] };
type Dados = {
  conversa: {
    id: string; codigo: string; telefone: string; nome: string | null; perfil_tipo: string | null; setor: string | null; responsavel: string | null;
    status: string; etiquetas: string[]; opportunity_id: string | null; crm_item_id: string | null; created_at: string;
  };
  papel: string; eu: string; configurado: boolean;
  mensagens: Msg[]; eventos: Ev[]; equipe: Pessoa[];
  respostas: { id: string; atalho: string; titulo: string; texto: string }[];
  oportunidade: { id: string; codigo: string; etapa: string } | null;
  crm_item: { id: string; codigo: string; titulo: string; status: string } | null;
  perfil: { nome: string; role: string; email: string | null } | null;
  pipelines: { id: string; nome: string }[];
  setores: { id: string; nome: string }[];
  pode: { triar: boolean; lead: boolean };
};

const ACAO: Record<string, string> = {
  criada: "Conversa criada", menu: "Menu automático", reconhecida: "Reconhecido pelo telefone", triagem: "Triagem",
  transferencia: "Transferência", assumir: "Assumiu", devolver: "Devolvido", resolver: "Status", reabrir: "Reaberta",
  nota: "Nota interna", etiquetas: "Etiquetas", lead: "Lead", crm: "CRM do setor", automatica: "Automação",
};
const hora = (iso: string) => new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });

export default function ConversaAtendimento({ id, voltar }: { id: string; voltar: string }) {
  const router = useRouter();
  const [d, setD] = useState<Dados | null>(null);
  const [erroCarga, setErroCarga] = useState("");
  const [texto, setTexto] = useState("");
  const [nota, setNota] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState("");
  const [painel, setPainel] = useState<"" | "transferir" | "lead" | "crm" | "etiquetas">("");
  const [destino, setDestino] = useState({ setor: "", responsavel: "", motivo: "" });
  const [lead, setLead] = useState({ codigo: "", rodizio: true });
  const [crm, setCrm] = useState({ pipeline: "", titulo: "" });
  const [etiquetas, setEtiquetas] = useState("");
  const fim = useRef<HTMLDivElement>(null);
  const qtdAnterior = useRef(0);

  const carregar = useCallback(async () => {
    const r = await fetch(`/api/admin/atendimento/${id}`).catch(() => null);
    if (!r) return;
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { setErroCarga(j.error ?? "Não foi possível abrir a conversa."); return; }
    setErroCarga(""); setD(j);
  }, [id]);
  useEffect(() => {
    void carregar();
    const t = setInterval(carregar, 8_000);
    return () => clearInterval(t);
  }, [carregar]);
  useEffect(() => {
    const n = (d?.mensagens.length ?? 0) + (d?.eventos.length ?? 0);
    if (n !== qtdAnterior.current) { fim.current?.scrollIntoView({ block: "end" }); qtdAnterior.current = n; }
  }, [d]);

  const nomeDe = useMemo(() => new Map((d?.equipe ?? []).map((p) => [p.user_id, p.nome])), [d]);
  const linha = useMemo(() => {
    if (!d) return [];
    const itens: ({ t: "m"; v: Msg } | { t: "e"; v: Ev })[] = [
      ...d.mensagens.map((v) => ({ t: "m" as const, v })), ...d.eventos.map((v) => ({ t: "e" as const, v })),
    ];
    return itens.sort((x, y) => x.v.created_at.localeCompare(y.v.created_at));
  }, [d]);
  const sugestoes = useMemo(() => {
    if (!d || !texto.startsWith("/")) return [];
    const termo = texto.slice(1).toLowerCase();
    return d.respostas.filter((r) => r.atalho.includes(termo) || r.titulo.toLowerCase().includes(termo)).slice(0, 6);
  }, [d, texto]);

  async function agir(corpo: Record<string, unknown>) {
    setOcupado(true); setErro("");
    const r = await fetch(`/api/admin/atendimento/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) }).catch(() => null);
    setOcupado(false);
    const j = await r?.json().catch(() => ({}));
    if (!r?.ok) { setErro(j?.error ?? "Não foi possível concluir."); return false; }
    await carregar(); router.refresh();
    return true;
  }

  if (erroCarga) return <p className="cartao p-5" role="alert">{erroCarga} <Link href={voltar} className="underline">Voltar</Link></p>;
  if (!d) return <p className="cartao p-5 text-texto-2">Carregando a conversa…</p>;
  const c = d.conversa;
  const naCentral = !c.setor;
  const pessoasDoDestino = d.equipe.filter((p) => !destino.setor || p.setores.includes(destino.setor));

  return (
    <div className="cartao flex flex-col">
      {/* cabeçalho */}
      <header className="space-y-2 border-b border-linha p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <Link href={voltar} className="mb-1 inline-flex items-center gap-1 text-xs text-texto-2 lg:hidden"><ArrowLeft className="size-3" /> Conversas</Link>
            <p className="flex items-center gap-2 text-lg font-semibold text-texto"><MessageCircle className="size-4 text-verde" />{c.nome || "+" + c.telefone}</p>
            <p className="text-xs text-texto-2">
              +{c.telefone} · {c.codigo} · {STATUS_LABEL[c.status] ?? c.status}
              {c.perfil_tipo && ` · ${PERFIL_LABEL[c.perfil_tipo] ?? c.perfil_tipo}`}
              {d.perfil && ` (${d.perfil.nome}${d.perfil.email ? ", " + d.perfil.email : ""})`}
            </p>
            <p className="mt-1 text-sm">
              <strong>{nomeSetor(c.setor)}</strong>
              {" · "}{c.responsavel ? `com ${nomeDe.get(c.responsavel) ?? "responsável"}` : "sem responsável (fila)"}
              {d.oportunidade && <> · <Link className="text-verde underline" href={`/admin/oportunidades/${d.oportunidade.id}`}>Negociação {d.oportunidade.codigo}</Link></>}
              {d.crm_item && <> · <Link className="text-verde underline" href={`/admin/crm/item/${d.crm_item.id}`}>{d.crm_item.codigo}</Link></>}
            </p>
            {!!c.etiquetas.length && <p className="mt-1 flex flex-wrap gap-1">{c.etiquetas.map((e) => <span key={e} className="rounded-full bg-superficie-2 px-2 text-[11px]">#{e}</span>)}</p>}
          </div>
          <div className="flex flex-wrap gap-2 text-sm">
            {c.responsavel !== d.eu && (!naCentral || d.pode.triar) && <button disabled={ocupado} onClick={() => agir({ acao: "assumir" })} className="btn-verde px-3 py-1.5">Assumir</button>}
            {(!naCentral || d.pode.triar) && <button disabled={ocupado} onClick={() => { setPainel(painel === "transferir" ? "" : "transferir"); setDestino({ setor: "", responsavel: "", motivo: "" }); }} className="btn-contorno px-3 py-1.5">{naCentral ? "Triar" : "Transferir"}</button>}
            {c.responsavel && <button disabled={ocupado} onClick={() => agir({ acao: "devolver" })} className="btn-contorno px-3 py-1.5">Devolver à fila</button>}
            {c.status !== "pendente" && c.status !== "resolvida" && <button disabled={ocupado} onClick={() => agir({ acao: "pendente" })} className="btn-contorno px-3 py-1.5">Aguardando cliente</button>}
            {c.status === "resolvida"
              ? <button disabled={ocupado} onClick={() => agir({ acao: "reabrir" })} className="btn-contorno px-3 py-1.5">Reabrir</button>
              : <button disabled={ocupado} onClick={() => agir({ acao: "resolver" })} className="btn-contorno px-3 py-1.5">Resolver</button>}
          </div>
        </div>
        <div className="flex flex-wrap gap-3 text-xs font-semibold text-verde">
          <button onClick={() => { setPainel(painel === "etiquetas" ? "" : "etiquetas"); setEtiquetas(c.etiquetas.join(", ")); }}>Etiquetas</button>
          {d.pode.lead && !c.opportunity_id && <button onClick={() => setPainel(painel === "lead" ? "" : "lead")}>Criar lead no Comercial</button>}
          {!!d.pipelines.length && !c.crm_item_id && <button onClick={() => { setPainel(painel === "crm" ? "" : "crm"); setCrm({ pipeline: d.pipelines[0].id, titulo: "" }); }}>Abrir no CRM de {nomeSetor(c.setor)}</button>}
        </div>

        {painel === "transferir" && (
          <form className="grid gap-2 rounded-xl border border-linha p-3 sm:grid-cols-2" onSubmit={async (e) => {
            e.preventDefault();
            if (await agir({ acao: "transferir", ...destino })) setPainel("");
          }}>
            <label className="text-xs">Para o setor
              <select value={destino.setor} onChange={(e) => setDestino({ ...destino, setor: e.target.value, responsavel: "" })} className={CAMPO_COMPACTO + " mt-1 w-full"}>
                {d.pode.triar && <option value="">Caixa central</option>}
                {!d.pode.triar && <option value="" disabled>Escolha…</option>}
                {d.setores.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
              </select>
            </label>
            <label className="text-xs">Pessoa (opcional)
              <select value={destino.responsavel} onChange={(e) => setDestino({ ...destino, responsavel: e.target.value })} className={CAMPO_COMPACTO + " mt-1 w-full"} disabled={!destino.setor}>
                <option value="">Fila do setor (quem estiver livre assume)</option>
                {pessoasDoDestino.map((p) => <option key={p.user_id} value={p.user_id}>{p.nome}</option>)}
              </select>
            </label>
            <label className="text-xs sm:col-span-2">Motivo {c.setor ? "(obrigatório)" : "(opcional)"}
              <input value={destino.motivo} onChange={(e) => setDestino({ ...destino, motivo: e.target.value })} className={CAMPO_COMPACTO + " mt-1 w-full"} placeholder="Ex.: cliente quer falar de boleto" />
            </label>
            <button disabled={ocupado} className="btn-verde px-3 py-1.5 text-sm sm:col-span-2">Encaminhar</button>
          </form>
        )}
        {painel === "lead" && (
          <form className="flex flex-wrap items-end gap-2 rounded-xl border border-linha p-3" onSubmit={async (e) => {
            e.preventDefault();
            if (await agir({ acao: "criar_lead", codigo_imovel: lead.codigo, rodizio: lead.rodizio })) setPainel("");
          }}>
            <label className="text-xs">Código do imóvel de interesse
              <input value={lead.codigo} onChange={(e) => setLead({ ...lead, codigo: e.target.value })} className={CAMPO_COMPACTO + " mt-1 block"} placeholder="AIB-000031" />
            </label>
            <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={lead.rodizio} onChange={(e) => setLead({ ...lead, rodizio: e.target.checked })} /> Distribuir pelo rodízio (desmarcado: fica comigo)</label>
            <button disabled={ocupado} className="btn-verde px-3 py-1.5 text-sm">Criar lead</button>
          </form>
        )}
        {painel === "crm" && (
          <form className="flex flex-wrap items-end gap-2 rounded-xl border border-linha p-3" onSubmit={async (e) => {
            e.preventDefault();
            if (await agir({ acao: "abrir_crm", pipeline_id: crm.pipeline, titulo: crm.titulo })) setPainel("");
          }}>
            <label className="text-xs">Funil
              <select value={crm.pipeline} onChange={(e) => setCrm({ ...crm, pipeline: e.target.value })} className={CAMPO_COMPACTO + " mt-1 block"}>
                {d.pipelines.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
              </select>
            </label>
            <label className="text-xs">Título (opcional)
              <input value={crm.titulo} onChange={(e) => setCrm({ ...crm, titulo: e.target.value })} className={CAMPO_COMPACTO + " mt-1 block"} placeholder={`WhatsApp · ${c.nome || c.telefone}`} />
            </label>
            <button disabled={ocupado} className="btn-verde px-3 py-1.5 text-sm">Abrir item</button>
          </form>
        )}
        {painel === "etiquetas" && (
          <form className="flex flex-wrap items-end gap-2 rounded-xl border border-linha p-3" onSubmit={async (e) => {
            e.preventDefault();
            if (await agir({ acao: "etiquetas", etiquetas: etiquetas.split(",") })) setPainel("");
          }}>
            <label className="flex-1 text-xs">Etiquetas separadas por vírgula
              <input value={etiquetas} onChange={(e) => setEtiquetas(e.target.value)} className={CAMPO_COMPACTO + " mt-1 w-full"} placeholder="compra, urgente" />
            </label>
            <button disabled={ocupado} className="btn-verde px-3 py-1.5 text-sm">Salvar</button>
          </form>
        )}
      </header>

      {/* mensagens + histórico */}
      <div className="max-h-[60vh] min-h-[320px] space-y-2 overflow-y-auto p-4">
        {linha.map((i) => i.t === "m" ? (
          <div key={"m" + i.v.id} className={"max-w-[80%] rounded-xl px-3 py-2 text-sm " + (i.v.direcao === "saida" ? "ml-auto bg-verde/12" : "mr-auto bg-superficie-2")}>
            <p className="whitespace-pre-wrap text-texto">{i.v.texto}</p>
            <p className="mt-0.5 text-[11px] text-texto-2">
              {hora(i.v.created_at)}
              {i.v.direcao === "saida" && ` · ${i.v.enviado_por ? nomeDe.get(i.v.enviado_por) ?? "equipe" : "robô"}`}
              {i.v.direcao === "saida" && i.v.status && ` · ${i.v.status === "read" ? "lida" : i.v.status === "delivered" ? "entregue" : i.v.status === "failed" ? "falhou" : "enviada"}`}
              {i.v.erro && <span className="text-critico"> · {i.v.erro}</span>}
            </p>
          </div>
        ) : i.v.acao === "nota" ? (
          <div key={"e" + i.v.id} className="mx-auto max-w-[85%] rounded-xl border border-ouro/50 bg-ouro/10 px-3 py-2 text-sm">
            <p className="flex items-center gap-1 text-[11px] font-semibold text-texto-2"><Lock className="size-3" /> Nota interna · {i.v.autor ? nomeDe.get(i.v.autor) ?? "equipe" : ""} · {hora(i.v.created_at)}</p>
            <p className="whitespace-pre-wrap text-texto">{i.v.texto}</p>
          </div>
        ) : (
          <p key={"e" + i.v.id} className="text-center text-[11px] text-texto-2">
            {ACAO[i.v.acao] ?? i.v.acao}
            {(i.v.para_setor !== i.v.de_setor || ["triagem", "transferencia"].includes(i.v.acao)) && (i.v.de_setor || i.v.para_setor) ? `: ${nomeSetor(i.v.de_setor)} → ${nomeSetor(i.v.para_setor)}` : ""}
            {i.v.para_user && i.v.acao !== "assumir" ? ` (para ${nomeDe.get(i.v.para_user) ?? "alguém"})` : ""}
            {i.v.autor ? ` · ${nomeDe.get(i.v.autor) ?? "equipe"}` : ""}
            {i.v.texto ? ` · ${i.v.texto}` : ""} · {hora(i.v.created_at)}
          </p>
        ))}
        {!linha.length && <p className="text-sm text-texto-2">Nenhuma mensagem ainda.</p>}
        <div ref={fim} />
      </div>

      {/* resposta */}
      <form className="relative space-y-2 border-t border-linha p-3" onSubmit={async (e) => {
        e.preventDefault();
        if (!texto.trim()) return;
        if (await agir(nota ? { acao: "nota", texto } : { acao: "responder", texto })) setTexto("");
      }}>
        {!!sugestoes.length && (
          <ul className="absolute bottom-full left-3 right-3 mb-1 divide-y divide-linha overflow-hidden rounded-xl border border-linha bg-superficie shadow-lg">
            {sugestoes.map((r) => (
              <li key={r.id}><button type="button" onClick={() => setTexto(r.texto)} className="block w-full px-3 py-2 text-left text-sm hover:bg-superficie-2">
                <strong>/{r.atalho}</strong> · {r.titulo}<span className="block truncate text-xs text-texto-2">{r.texto}</span>
              </button></li>
            ))}
          </ul>
        )}
        <div className="flex gap-2">
          <textarea value={texto} onChange={(e) => setTexto(e.target.value)} rows={2}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); e.currentTarget.form?.requestSubmit(); } }}
            placeholder={nota ? "Nota interna (o cliente não vê)…" : d.configurado ? "Responder pelo WhatsApp… (digite / para respostas prontas)" : "WhatsApp não configurado: só notas internas"}
            className={CAMPO_COMPACTO + " flex-1 resize-y " + (nota ? "border-ouro" : "")} />
          <button disabled={ocupado || (!nota && !d.configurado)} aria-label="Enviar" className="btn-verde self-end px-3 py-2 disabled:opacity-60"><Send className="size-4" /></button>
        </div>
        <label className="flex items-center gap-2 text-xs text-texto-2"><input type="checkbox" checked={nota} onChange={(e) => setNota(e.target.checked)} /> Nota interna (só a equipe vê)</label>
        {erro && <p className="text-xs text-critico" role="alert">{erro}</p>}
      </form>
    </div>
  );
}
