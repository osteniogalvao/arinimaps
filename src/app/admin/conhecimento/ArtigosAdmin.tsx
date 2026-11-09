"use client";

import { useState } from "react";
import { enviarJson, type ErroApi } from "@/lib/api/enviar";
import { AvisoErro } from "@/components/ui/Aviso";
import {
  STATUS_ARTIGO, STATUS_ARTIGO_LABEL, slugDe, type Artigo, type Lacuna, type StatusArtigo,
} from "@/lib/ia/conhecimento";
import LacunasLista from "./LacunasLista";
import { CAMPO, Etiqueta, ROTULO } from "@/components/ui/Pagina";
import { Archive, BookOpen, CheckCircle2, FilePen, History, Plus, Save, Search, Send, Undo2 } from "lucide-react";

const TOM_ARTIGO: Record<StatusArtigo, "alerta" | "verde" | "neutro"> = {
  rascunho: "alerta", publicado: "verde", arquivado: "neutro",
};

type Versao = {
  versao: number; titulo: string; conteudo: string; fonte: string; data_referencia: string;
  status: StatusArtigo; editado_por_nome: string; created_at: string;
};
type Achado = { id: string; titulo: string; trecho: string; fonte: string; data_referencia: string; versao: number; rank: number };

const hoje = () => new Date().toISOString().slice(0, 10);
const VAZIO = { id: "", slug: "", titulo: "", conteudo: "", fonte: "", data_referencia: hoje(), status: "rascunho" as StatusArtigo, versao: 0, updated_at: "" };
const campo = CAMPO;
const dataBR = (d: string) => new Date(d.length === 10 ? `${d}T12:00:00` : d).toLocaleDateString("pt-BR");

/**
 * CRUD da base de conhecimento + histórico de versões + teste da busca do
 * assistente + fila das perguntas que ele não soube responder.
 */
export default function ArtigosAdmin({ inicial, lacunasIniciais, resumoLacunas }: {
  inicial: Artigo[];
  lacunasIniciais: Lacuna[];
  resumoLacunas: { respondidas: number; descartadas: number };
}) {
  const [artigos, setArtigos] = useState(inicial);
  const [lacunas, setLacunas] = useState(lacunasIniciais);
  const [resumo, setResumo] = useState(resumoLacunas);
  // pergunta que originou o artigo aberto no editor: ao salvar, o artigo é ligado a ela
  const [lacunaOrigem, setLacunaOrigem] = useState<Lacuna | null>(null);
  const [lacunaOcupada, setLacunaOcupada] = useState<string | null>(null);
  const [edit, setEdit] = useState<Artigo | null>(null);
  const [slugManual, setSlugManual] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<ErroApi | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [versoes, setVersoes] = useState<Versao[] | null>(null);
  const [verVersao, setVerVersao] = useState<Versao | null>(null);
  const [filtro, setFiltro] = useState<"todos" | StatusArtigo>("todos");
  const [q, setQ] = useState("");
  const [achados, setAchados] = useState<Achado[] | null>(null);

  async function recarregar() {
    const r = await fetch("/api/ia/conhecimento").then((x) => x.json()).catch(() => null);
    if (r?.artigos) setArtigos(r.artigos);
  }

  async function abrir(a: Artigo | null, origem: Lacuna | null = null) {
    setErro(null); setOk(null); setVersoes(null); setVerVersao(null);
    setLacunaOrigem(origem);
    setEdit(a ? { ...a } : origem
      ? { ...VAZIO, titulo: origem.pergunta.slice(0, 200), slug: slugDe(origem.pergunta) }
      : { ...VAZIO });
    setSlugManual(!!a);
    if (a) {
      const r = await fetch(`/api/ia/conhecimento/${a.id}`).then((x) => x.json()).catch(() => null);
      if (r?.versoes) setVersoes(r.versoes);
    }
  }

  async function salvar(status?: StatusArtigo) {
    if (!edit) return;
    setSalvando(true); setErro(null); setOk(null);
    const corpo = { ...edit, status: status ?? edit.status };
    const r = edit.id
      ? await enviarJson<{ versao: number }>(`/api/ia/conhecimento/${edit.id}`, "PATCH", corpo)
      : await enviarJson<{ id: string }>("/api/ia/conhecimento", "POST", corpo);
    setSalvando(false);
    if (!r.ok) return setErro(r.erro);
    const id = edit.id || (r.dados as { id: string }).id;
    let aviso = edit.id ? "Alterações salvas — nova versão registrada." : "Artigo criado.";
    if (lacunaOrigem) {
      const v = await enviarJson<{ lacuna: Lacuna }>(`/api/ia/lacunas/${lacunaOrigem.id}`, "PATCH", { acao: "vincular", artigo_id: id });
      if (v.ok) {
        const l = v.dados.lacuna;
        if (l.status === "respondida") {
          setLacunas((ls) => ls.filter((x) => x.id !== l.id));
          setResumo((s) => ({ ...s, respondidas: s.respondidas + 1 }));
          setLacunaOrigem(null);
          aviso += " A pergunta saiu da fila de perguntas sem resposta.";
        } else {
          setLacunas((ls) => ls.map((x) => (x.id === l.id ? l : x)));
          setLacunaOrigem(l);
          aviso += " Publique o artigo para a pergunta contar como respondida.";
        }
      } else {
        // o artigo foi salvo; só o vínculo com a pergunta falhou — diz isso, não esconde
        aviso += ` Mas não deu para ligar o artigo à pergunta de origem: ${v.erro.mensagem}`;
      }
    }
    setOk(aviso);
    await recarregar();
    const atualizado = await fetch(`/api/ia/conhecimento/${id}`).then((x) => x.json()).catch(() => null);
    if (atualizado?.artigo) { setEdit(atualizado.artigo); setVersoes(atualizado.versoes); setSlugManual(true); }
  }

  /** Responder: abre o rascunho já ligado à pergunta ou um artigo novo com ela como título. */
  function responderLacuna(l: Lacuna) {
    const ligado = l.artigo_id ? artigos.find((x) => x.id === l.artigo_id) : null;
    void abrir(ligado ?? null, l);
    // o editor pode não estar na tela ainda: rola depois da renderização
    setTimeout(() => document.getElementById("kb-titulo")?.scrollIntoView({ behavior: "smooth", block: "center" }), 50);
  }

  async function descartarLacuna(l: Lacuna) {
    setLacunaOcupada(l.id); setErro(null);
    const r = await enviarJson<{ lacuna: Lacuna }>(`/api/ia/lacunas/${l.id}`, "PATCH", { acao: "descartar" });
    setLacunaOcupada(null);
    if (!r.ok) return setErro(r.erro);
    setLacunas((ls) => ls.filter((x) => x.id !== l.id));
    setResumo((s) => ({ ...s, descartadas: s.descartadas + 1 }));
    if (lacunaOrigem?.id === l.id) setLacunaOrigem(null);
  }

  async function testarBusca(e: React.FormEvent) {
    e.preventDefault();
    if (!q.trim()) return;
    const r = await fetch(`/api/ia/conhecimento?q=${encodeURIComponent(q)}`).then((x) => x.json()).catch(() => null);
    setAchados(r?.resultados ?? []);
  }

  const lista = artigos.filter((a) => filtro === "todos" || a.status === filtro);

  return (
    <div className="space-y-8">
      <LacunasLista lacunas={lacunas} resumo={resumo} ocupado={lacunaOcupada}
        aoResponder={responderLacuna} aoDescartar={descartarLacuna} />

      <form onSubmit={testarBusca} className="cartao p-5 flex flex-wrap gap-3 items-end">
        <div className="flex-1 min-w-60">
          <label htmlFor="kb-q" className={ROTULO}>Testar a busca do assistente (só artigos publicados)</label>
          <input id="kb-q" value={q} onChange={(e) => setQ(e.target.value)} className={campo}
            placeholder="Ex.: qual a comissão da Arini?" />
        </div>
        <button className="btn-contorno inline-flex items-center gap-2 px-5 py-3 text-sm"><Search className="size-4" /> Buscar</button>
        {achados && (
          <div className="w-full pt-2 space-y-2.5">
            {!achados.length && <p className="text-[0.95rem] text-texto-2">Nada encontrado — o assistente vai dizer que não há informação oficial.</p>}
            {achados.map((a) => (
              <div key={a.id} className="rounded-xl border border-linha bg-superficie-2 p-4">
                <p className="font-semibold text-texto">{a.titulo} <span className="ml-1 text-sm font-normal text-texto-2 tabular-nums">v{a.versao} · relevância {a.rank.toFixed(2)}</span></p>
                <p className="text-texto-2 text-sm leading-relaxed mt-1">{a.trecho}</p>
              </div>
            ))}
          </div>
        )}
      </form>

      <div className="grid gap-6 lg:grid-cols-[340px_minmax(0,1fr)] items-start">
        {/* ---------- lista ---------- */}
        <div className="space-y-4 lg:sticky lg:top-24">
          <div className="flex gap-1.5 flex-wrap">
            {(["todos", ...STATUS_ARTIGO] as const).map((s) => (
              <button key={s} type="button" onClick={() => setFiltro(s)} data-ativo={filtro === s} className="chip px-3.5 py-1.5 text-sm">
                {s === "todos" ? "Todos" : STATUS_ARTIGO_LABEL[s]}
              </button>
            ))}
          </div>
          <button type="button" onClick={() => abrir(null)} className="btn-verde inline-flex w-full items-center justify-center gap-2 py-3 text-sm"><Plus className="size-4" /> Novo artigo</button>
          <div className="cartao divide-y divide-linha overflow-hidden lg:max-h-[calc(100vh-18rem)] lg:overflow-y-auto">
            {lista.map((a) => (
              <button key={a.id} type="button" onClick={() => abrir(a)}
                className={"w-full text-left px-5 py-3.5 transition-colors hover:bg-superficie-2/70 " + (edit?.id === a.id ? "bg-verde/8 shadow-[inset_3px_0_0_var(--verde)]" : "")}>
                <p className="text-[0.95rem] font-semibold text-texto leading-snug">{a.titulo}</p>
                <p className="text-xs text-texto-2 mt-1.5 flex gap-2 items-center tabular-nums">
                  <Etiqueta tom={TOM_ARTIGO[a.status]} className="!py-0.5">{STATUS_ARTIGO_LABEL[a.status]}</Etiqueta>
                  v{a.versao} · ref. {dataBR(a.data_referencia)}
                </p>
              </button>
            ))}
            {!lista.length && <p className="px-5 py-10 text-base text-texto-2 text-center">Nenhum artigo.</p>}
          </div>
        </div>

        {/* ---------- editor ---------- */}
        {edit ? (
          <div className="space-y-5 min-w-0">
            <div className="cartao p-6 space-y-5">
              <div className="flex items-center justify-between gap-3 flex-wrap border-b border-linha pb-4">
                <h2 className="flex items-center gap-2.5 lp-display text-xl text-texto"><FilePen className="size-5 text-verde" /> {edit.id ? `Editar artigo (versão ${edit.versao})` : "Novo artigo"}</h2>
                {edit.id && <Etiqueta tom={TOM_ARTIGO[edit.status]}>{STATUS_ARTIGO_LABEL[edit.status]}</Etiqueta>}
              </div>
              {lacunaOrigem && (
                <p className="rounded-xl border border-linha bg-superficie-2 px-4 py-3 text-sm text-texto-2">
                  Respondendo à pergunta sem resposta <strong className="text-texto">“{lacunaOrigem.pergunta}”</strong>
                  {" "}({lacunaOrigem.ocorrencias} {lacunaOrigem.ocorrencias === 1 ? "vez" : "vezes"}). Ao publicar, ela sai da fila.
                </p>
              )}
              <div>
                <label htmlFor="kb-titulo" className={ROTULO}>Título</label>
                <input id="kb-titulo" className={campo} value={edit.titulo}
                  onChange={(e) => setEdit({ ...edit, titulo: e.target.value, slug: slugManual ? edit.slug : slugDe(e.target.value) })} />
              </div>
              <div className="grid gap-4 sm:grid-cols-[1fr_200px]">
                <div>
                  <label htmlFor="kb-slug" className={ROTULO}>Identificador</label>
                  <input id="kb-slug" className={campo + " font-mono"} value={edit.slug}
                    onChange={(e) => { setSlugManual(true); setEdit({ ...edit, slug: e.target.value }); }} />
                </div>
                <div>
                  <label htmlFor="kb-data" className={ROTULO}>Data de referência</label>
                  <input id="kb-data" type="date" className={campo} value={edit.data_referencia}
                    onChange={(e) => setEdit({ ...edit, data_referencia: e.target.value })} />
                </div>
              </div>
              <div>
                <label htmlFor="kb-fonte" className={ROTULO}>Fonte (de onde veio a informação)</label>
                <input id="kb-fonte" className={campo} value={edit.fonte} placeholder="Ex.: Termos de uso v3; Configurações › Regras comerciais"
                  onChange={(e) => setEdit({ ...edit, fonte: e.target.value })} />
              </div>
              <div>
                <label htmlFor="kb-conteudo" className={ROTULO}>Conteúdo (markdown simples)</label>
                <textarea id="kb-conteudo" rows={16} className={campo + " font-mono !text-[13px] leading-relaxed"} value={edit.conteudo}
                  onChange={(e) => setEdit({ ...edit, conteudo: e.target.value })} />
                <p className="text-xs text-texto-2 mt-1.5 tabular-nums">{edit.conteudo.length.toLocaleString("pt-BR")} / 20.000 caracteres. O assistente lê até 3.000 por artigo.</p>
              </div>

              {erro && <AvisoErro erro={erro} aoFechar={() => setErro(null)} />}
              {ok && <p className="flex items-center gap-1.5 text-sm font-semibold text-verde"><CheckCircle2 className="size-4" /> {ok}</p>}

              <div className="flex flex-wrap gap-3 border-t border-linha pt-5">
                <button type="button" disabled={salvando} onClick={() => salvar()} className="btn-contorno inline-flex items-center gap-2 px-5 py-3 text-sm">
                  <Save className="size-4" />
                  {salvando ? "Salvando…" : "Salvar"}
                </button>
                {edit.status !== "publicado" && (
                  <button type="button" disabled={salvando} onClick={() => salvar("publicado")} className="btn-verde inline-flex items-center gap-2 px-5 py-3 text-sm">
                    <Send className="size-4" />
                    Salvar e publicar
                  </button>
                )}
                {edit.id && edit.status === "publicado" && (
                  <button type="button" disabled={salvando} onClick={() => salvar("rascunho")} className="btn-contorno inline-flex items-center gap-2 px-5 py-3 text-sm">
                    <Undo2 className="size-4" />
                    Voltar para rascunho
                  </button>
                )}
                {edit.id && edit.status !== "arquivado" && (
                  <button type="button" disabled={salvando} onClick={() => salvar("arquivado")} className="btn-perigo inline-flex items-center gap-2 px-5 py-3 text-sm">
                    <Archive className="size-4" />
                    Arquivar
                  </button>
                )}
              </div>
              <p className="text-sm text-texto-2">
                Só artigos publicados entram nas respostas do assistente. Arquivar tira da busca sem apagar o histórico.
              </p>
            </div>

            {versoes && versoes.length > 0 && (
              <div className="cartao p-6 space-y-4">
                <h3 className="flex items-center gap-2 font-display text-base font-bold text-texto"><History className="size-4 text-verde" /> Versões ({versoes.length})</h3>
                <div className="divide-y divide-linha text-[0.95rem]">
                  {versoes.map((v) => (
                    <button key={v.versao} type="button" onClick={() => setVerVersao(verVersao?.versao === v.versao ? null : v)}
                      className="w-full text-left py-3 flex flex-wrap items-center gap-x-3 gap-y-1 transition-colors hover:text-verde">
                      <span className="font-mono font-semibold">v{v.versao}</span>
                      <Etiqueta tom={TOM_ARTIGO[v.status]} className="!py-0.5">{STATUS_ARTIGO_LABEL[v.status]}</Etiqueta>
                      <span className="text-texto-2">{v.editado_por_nome}</span>
                      <span className="text-sm text-texto-2 tabular-nums">{new Date(v.created_at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}</span>
                    </button>
                  ))}
                </div>
                {verVersao && (
                  <div className="rounded-xl border border-linha bg-superficie-2 p-5 space-y-1.5">
                    <p className="font-semibold text-texto">{verVersao.titulo}</p>
                    <p className="text-sm text-texto-2">Fonte: {verVersao.fonte || "—"} · ref. {dataBR(verVersao.data_referencia)}</p>
                    <pre className="whitespace-pre-wrap font-sans text-texto-2 text-sm leading-relaxed pt-2">{verVersao.conteudo}</pre>
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="cartao flex flex-col items-center px-6 py-16 text-center">
            <span className="grid size-14 place-items-center rounded-2xl bg-verde/10 text-verde"><BookOpen className="size-7" /></span>
            <p className="lp-display mt-4 text-xl text-texto">Escolha um artigo para editar ou crie um novo.</p>
          </div>
        )}
      </div>
    </div>
  );
}
