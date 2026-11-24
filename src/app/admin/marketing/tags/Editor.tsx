"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CodeXml, FlaskConical, Pencil, Plus, Power, ShieldCheck, X } from "lucide-react";
import { CAMPO, Etiqueta, ROTULO } from "@/components/ui/Pagina";
import {
  PAGINAS_SISTEMA, POSICOES, caminhoProibido, normalizarRegra, problemaNoCodigo, resumoOnde, tagValeEm,
  type PosicaoTag, type TagMarketing,
} from "@/lib/tags-marketing";
import { excluirTag, ligarTag, salvarTag } from "./acoes";

/** Modo de cada página da lista: "" = segue a regra geral. */
type Modo = "" | "incluir" | "incluir_sub" | "excluir" | "excluir_sub";
type Extra = { regra: string; tipo: "incluir" | "excluir" };

type Rascunho = {
  id?: string;
  nome: string;
  codigo: string;
  posicao: PosicaoTag;
  ativo: boolean;
  todas: boolean;
  modos: Record<string, Modo>;
  extras: Extra[];
  observacao: string;
};

const BASES = new Set(PAGINAS_SISTEMA.map((p) => p.caminho));

const MODO_ROTULO: Record<Modo, string> = {
  "": "—",
  incluir: "Carregar só nesta página",
  incluir_sub: "Carregar nesta e nas subpáginas",
  excluir: "Não carregar nesta página",
  excluir_sub: "Não carregar nesta nem nas subpáginas",
};

const POSICAO_CURTA: Record<PosicaoTag, string> = { head: "<head>", body_inicio: "início do <body>", body_fim: "fim do <body>" };

function novoRascunho(): Rascunho {
  return { nome: "", codigo: "", posicao: "head", ativo: true, todas: true, modos: {}, extras: [], observacao: "" };
}

/** Listas do banco → linhas da tela (páginas conhecidas viram seletor, o resto vira endereço extra). */
function rascunhoDe(t: TagMarketing): Rascunho {
  const modos: Record<string, Modo> = {};
  const extras: Extra[] = [];
  const ler = (lista: string[], tipo: "incluir" | "excluir") => {
    for (const regra of lista) {
      const sub = regra.endsWith("/**");
      const base = sub ? regra.slice(0, -3) || "/" : regra;
      if (BASES.has(base) && !(base === "/" && sub)) modos[base] = (sub ? `${tipo}_sub` : tipo) as Modo;
      else extras.push({ regra, tipo });
    }
  };
  ler(t.paginas, "incluir");
  ler(t.excluir, "excluir");
  return {
    id: t.id, nome: t.nome, codigo: t.codigo, posicao: t.posicao, ativo: t.ativo, todas: t.todas_paginas,
    modos, extras, observacao: t.observacao ?? "",
  };
}

/** Linhas da tela → listas que o servidor grava. */
function listasDe(r: Rascunho) {
  const paginas: string[] = [];
  const excluir: string[] = [];
  for (const [base, modo] of Object.entries(r.modos)) {
    if (!modo) continue;
    const regra = modo.endsWith("_sub") ? (base === "/" ? "/**" : `${base}/**`) : base;
    if (modo.startsWith("incluir")) { if (!r.todas) paginas.push(regra); } else excluir.push(regra);
  }
  for (const e of r.extras) {
    const regra = normalizarRegra(e.regra);
    if (!regra) continue;
    if (e.tipo === "incluir") { if (!r.todas) paginas.push(regra); } else excluir.push(regra);
  }
  return { paginas, excluir };
}

export default function Editor({ tags }: { tags: TagMarketing[] }) {
  const router = useRouter();
  const [rascunho, setRascunho] = useState<Rascunho | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState("");
  const [erro, setErro] = useState("");
  const [removendo, setRemovendo] = useState<string | null>(null);
  const [teste, setTeste] = useState("/");

  async function executar(acao: () => Promise<{ erro?: string }>, ok: string) {
    setOcupado(true); setErro(""); setAviso("");
    try {
      const r = await acao();
      if (r.erro) { setErro(r.erro); return false; }
      setAviso(ok);
      router.refresh();
      return true;
    } catch {
      setErro("Conexão interrompida. Tente novamente.");
      return false;
    } finally {
      setOcupado(false);
    }
  }

  async function salvar() {
    if (!rascunho) return;
    const { paginas, excluir } = listasDe(rascunho);
    const invalido = rascunho.extras.find((e) => e.regra.trim() && !normalizarRegra(e.regra));
    if (invalido) { setErro(`Endereço inválido: "${invalido.regra}". Use /pagina ou /pagina/** para incluir as subpáginas.`); return; }
    const ok = await executar(() => salvarTag({
      id: rascunho.id, nome: rascunho.nome, codigo: rascunho.codigo, posicao: rascunho.posicao, ativo: rascunho.ativo,
      todas_paginas: rascunho.todas, paginas, excluir, observacao: rascunho.observacao,
    }), "Código salvo. Já vale no site para as próximas visitas.");
    if (ok) setRascunho(null);
  }

  const caminhoTeste = teste.trim().startsWith("/") ? teste.trim() : "/" + teste.trim();
  const noTeste = useMemo(
    () => tags.filter((t) => t.ativo && tagValeEm(t, caminhoTeste)),
    [tags, caminhoTeste],
  );

  return (
    <div className="space-y-8">
      <div className="cartao flex gap-3 p-5 text-sm leading-relaxed text-texto-2">
        <ShieldCheck className="mt-0.5 size-5 shrink-0 text-verde" />
        <p>
          Os códigos carregam nas páginas do site e na área do cliente, nunca no painel da equipe (/admin). Só cole código
          vindo da própria ferramenta (Google, Meta, TikTok…): ele roda no navegador de todos os visitantes. Cada mudança fica
          registrada na auditoria. Para verificar domínio (Google, Meta), prefira a verificação por DNS.
        </p>
      </div>

      {(aviso || erro) && (
        <p role="status" className={`cartao p-4 text-sm font-semibold ${erro ? "text-critico" : "text-verde"}`}>{erro || aviso}</p>
      )}

      {rascunho ? (
        <Formulario r={rascunho} mudar={setRascunho} ocupado={ocupado} salvar={salvar} cancelar={() => { setRascunho(null); setErro(""); }} />
      ) : (
        <button type="button" onClick={() => { setRascunho(novoRascunho()); setAviso(""); setErro(""); }}
          className="lp-btn lp-btn-verde !px-5 !py-3 text-[0.95rem]">
          <Plus className="size-4" /> Adicionar código
        </button>
      )}

      <section className="space-y-3">
        <h2 className="lp-display text-2xl text-texto">Códigos instalados</h2>
        {!tags.length && (
          <div className="cartao flex flex-col items-center px-6 py-12 text-center">
            <CodeXml className="size-8 text-verde" />
            <p className="mt-3 text-texto-2">Nenhum código instalado ainda.</p>
          </div>
        )}
        <ul className="space-y-3">
          {tags.map((t) => (
            <li key={t.id} className={`cartao p-5 ${t.ativo ? "" : "opacity-70"}`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 font-semibold text-texto">
                    {t.nome}
                    <Etiqueta tom={t.ativo ? "verde" : "neutro"}>{t.ativo ? "ativo" : "desligado"}</Etiqueta>
                    <Etiqueta>{POSICAO_CURTA[t.posicao]}</Etiqueta>
                  </p>
                  <p className="mt-1 text-sm text-texto-2">{resumoOnde(t)}</p>
                  {t.observacao && <p className="mt-1 text-sm text-texto-2 italic">{t.observacao}</p>}
                  <p className="mt-1 text-xs text-texto-2">Atualizado em {new Date(t.updated_at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" disabled={ocupado} onClick={() => { setRascunho(rascunhoDe(t)); setAviso(""); setErro(""); window.scrollTo({ top: 0 }); }}
                    className="btn-contorno inline-flex items-center gap-1.5 px-3 py-2 text-sm"><Pencil className="size-4" /> Editar</button>
                  <button type="button" disabled={ocupado}
                    onClick={() => executar(() => ligarTag(t.id, !t.ativo), t.ativo ? "Código desligado." : "Código ligado.")}
                    className="btn-contorno inline-flex items-center gap-1.5 px-3 py-2 text-sm"><Power className="size-4" /> {t.ativo ? "Desligar" : "Ligar"}</button>
                  {removendo === t.id ? (
                    <>
                      <button type="button" disabled={ocupado}
                        onClick={async () => { await executar(() => excluirTag(t.id), "Código removido."); setRemovendo(null); }}
                        className="inline-flex items-center gap-1.5 rounded-full border border-critico px-3 py-2 text-sm font-semibold text-critico">Confirmar remoção</button>
                      <button type="button" onClick={() => setRemovendo(null)} className="px-2 text-sm text-texto-2 underline">cancelar</button>
                    </>
                  ) : (
                    <button type="button" disabled={ocupado} onClick={() => setRemovendo(t.id)}
                      className="inline-flex items-center gap-1.5 px-3 py-2 text-sm text-critico"><X className="size-4" /> Remover</button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      </section>

      {tags.length > 0 && (
        <section className="cartao space-y-3 p-5">
          <h2 className="flex items-center gap-2 font-semibold text-texto"><FlaskConical className="size-5 text-verde" /> Testar um endereço</h2>
          <p className="text-sm text-texto-2">Digite o endereço de uma página (ex.: /imovel/ARI-123/tour) para ver quais códigos ativos carregam nela.</p>
          <input value={teste} onChange={(e) => setTeste(e.target.value)} className={CAMPO + " font-mono"} aria-label="Endereço para testar" />
          <p className="text-sm">
            {caminhoProibido(caminhoTeste)
              ? "O painel da equipe e as APIs nunca recebem códigos."
              : noTeste.length
                ? <>Carregam aqui: <strong>{noTeste.map((t) => t.nome).join(", ")}</strong></>
                : "Nenhum código ativo carrega neste endereço."}
          </p>
        </section>
      )}
    </div>
  );
}

function Formulario({ r, mudar, ocupado, salvar, cancelar }: {
  r: Rascunho; mudar: (r: Rascunho) => void; ocupado: boolean; salvar: () => void; cancelar: () => void;
}) {
  const set = <K extends keyof Rascunho>(k: K, v: Rascunho[K]) => mudar({ ...r, [k]: v });
  const problema = r.codigo.trim() ? problemaNoCodigo(r.codigo) : null;
  const opcoes = (temSub: boolean, raiz: boolean): Modo[] => {
    const base: Modo[] = r.todas ? ["", "excluir"] : ["", "incluir", "excluir"];
    if (!temSub || raiz) return base;
    return r.todas ? ["", "excluir", "excluir_sub"] : ["", "incluir", "incluir_sub", "excluir", "excluir_sub"];
  };
  const grupos = [...new Set(PAGINAS_SISTEMA.map((p) => p.grupo))];
  // no modo "todas", inclusões perdem o sentido: some com elas da tela
  const modoVisivel = (m: Modo | undefined): Modo => (r.todas && m?.startsWith("incluir") ? "" : m ?? "");

  return (
    <form className="cartao space-y-6 p-5 md:p-6" onSubmit={(e) => { e.preventDefault(); salvar(); }}>
      <fieldset disabled={ocupado} className="space-y-6">
        <legend className="lp-display text-2xl text-texto">{r.id ? "Editar código" : "Novo código"}</legend>

        <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
          <label>
            <span className={ROTULO}>Nome</span>
            <input required maxLength={120} value={r.nome} onChange={(e) => set("nome", e.target.value)}
              placeholder="Ex.: Meta Pixel, Google Tag Manager" className={CAMPO} />
          </label>
          <label className="flex items-center gap-2 pb-3 text-sm font-semibold">
            <input type="checkbox" checked={r.ativo} onChange={(e) => set("ativo", e.target.checked)} className="size-4 accent-verde" /> Ativo
          </label>
        </div>

        <div>
          <span className={ROTULO}>Onde o código entra na página</span>
          <div className="grid gap-3 md:grid-cols-3">
            {POSICOES.map((p) => (
              <label key={p.id} className={`cursor-pointer rounded-xl border p-4 text-sm transition ${r.posicao === p.id ? "border-verde bg-verde/8" : "border-linha"}`}>
                <span className="flex items-center gap-2 font-semibold text-texto">
                  <input type="radio" name="posicao" checked={r.posicao === p.id} onChange={() => set("posicao", p.id)} className="accent-verde" />
                  {p.rotulo}
                </span>
                <span className="mt-1 block text-texto-2">{p.ajuda}</span>
              </label>
            ))}
          </div>
        </div>

        <label className="block">
          <span className={ROTULO}>Código</span>
          <textarea required rows={9} spellCheck={false} value={r.codigo} onChange={(e) => set("codigo", e.target.value)}
            placeholder={"<!-- cole aqui o código completo, como a ferramenta entrega -->\n<script>…</script>"}
            className={CAMPO + " font-mono text-xs leading-relaxed"} />
          {problema && <span className="mt-1.5 block text-sm font-semibold text-critico">{problema}</span>}
        </label>

        <div className="space-y-3">
          <span className={ROTULO}>Em quais páginas carrega</span>
          <div className="flex flex-wrap gap-3">
            {[[true, "Todas as páginas"], [false, "Só nas páginas que eu escolher"]].map(([v, rot]) => (
              <label key={String(v)} className={`cursor-pointer rounded-full border px-4 py-2 text-sm font-semibold ${r.todas === v ? "border-verde bg-verde text-fundo" : "border-linha text-texto-2"}`}>
                <input type="radio" className="sr-only" checked={r.todas === v} onChange={() => set("todas", v as boolean)} />{rot as string}
              </label>
            ))}
          </div>
          <p className="text-sm text-texto-2">
            {r.todas
              ? "Carrega em todo o site. Se quiser, marque abaixo as páginas onde ele NÃO deve carregar."
              : "Escolha abaixo onde carregar. Dá para incluir uma seção com as subpáginas e ainda tirar uma delas."}
          </p>

          <div className="overflow-x-auto rounded-xl border border-linha">
            <table className="w-full min-w-[560px] text-sm">
              <tbody className="divide-y divide-linha">
                {grupos.map((g) => (
                  <GrupoPaginas key={g} grupo={g}>
                    {PAGINAS_SISTEMA.filter((p) => p.grupo === g).map((p) => {
                      const m = modoVisivel(r.modos[p.caminho]);
                      return (
                        <tr key={p.caminho} className={m ? (m.startsWith("excluir") ? "bg-critico/5" : "bg-verde/5") : ""}>
                          <td className="px-4 py-2.5">
                            <span className="font-medium text-texto">{p.rotulo}</span>
                            <span className="ml-2 font-mono text-xs text-texto-2">{p.caminho}</span>
                            {p.subpaginas && <span className="block text-xs text-texto-2">Subpáginas: {p.subpaginas}</span>}
                          </td>
                          <td className="w-[19rem] px-4 py-2">
                            <select value={m} aria-label={`Regra para ${p.rotulo}`} className={CAMPO + " !py-2 text-sm"}
                              onChange={(e) => set("modos", { ...r.modos, [p.caminho]: e.target.value as Modo })}>
                              {opcoes(!!p.subpaginas, p.caminho === "/").map((o) => (
                                <option key={o} value={o}>{o === "" ? (r.todas ? "Carrega (regra geral)" : "Não carrega") : MODO_ROTULO[o]}</option>
                              ))}
                            </select>
                          </td>
                        </tr>
                      );
                    })}
                  </GrupoPaginas>
                ))}
              </tbody>
            </table>
          </div>

          <div className="space-y-2">
            <span className="text-sm font-semibold text-texto">Outros endereços</span>
            <p className="text-xs text-texto-2">
              Use <code>/pagina</code> para só aquela página, <code>/pagina/**</code> para ela e as subpáginas, e <code>*</code> para
              um trecho qualquer (ex.: <code>/imovel/*/tour</code> = tour 3D de qualquer imóvel).
            </p>
            {r.extras.map((e, i) => {
              const valido = !e.regra.trim() || !!normalizarRegra(e.regra);
              return (
                <div key={i} className="flex flex-wrap items-center gap-2">
                  <input value={e.regra} placeholder="/imovel/*/tour" aria-label="Endereço"
                    onChange={(ev) => set("extras", r.extras.map((x, j) => (j === i ? { ...x, regra: ev.target.value } : x)))}
                    className={CAMPO + " !py-2 flex-1 min-w-[12rem] font-mono text-sm " + (valido ? "" : "!border-critico")} />
                  <select value={e.tipo} aria-label="Incluir ou excluir" className={CAMPO + " !w-auto !py-2 text-sm"}
                    onChange={(ev) => set("extras", r.extras.map((x, j) => (j === i ? { ...x, tipo: ev.target.value as Extra["tipo"] } : x)))}>
                    {!r.todas && <option value="incluir">Carregar aqui</option>}
                    <option value="excluir">Não carregar aqui</option>
                  </select>
                  <button type="button" aria-label="Tirar endereço" className="p-2 text-texto-2 hover:text-critico"
                    onClick={() => set("extras", r.extras.filter((_, j) => j !== i))}><X className="size-4" /></button>
                </div>
              );
            })}
            <button type="button" className="inline-flex items-center gap-1.5 text-sm font-semibold text-verde hover:underline"
              onClick={() => set("extras", [...r.extras, { regra: "", tipo: r.todas ? "excluir" : "incluir" }])}>
              <Plus className="size-4" /> Adicionar endereço
            </button>
          </div>
        </div>

        <label className="block">
          <span className={ROTULO}>Observação (opcional)</span>
          <input maxLength={500} value={r.observacao} onChange={(e) => set("observacao", e.target.value)}
            placeholder="Ex.: pixel da campanha de dezembro, conta Meta da Arini" className={CAMPO} />
        </label>

        <div className="flex flex-wrap gap-3">
          <button type="submit" disabled={!!problema} className="lp-btn lp-btn-verde !px-5 !py-3 text-[0.95rem] disabled:opacity-60">
            {ocupado ? "Salvando…" : "Salvar código"}
          </button>
          <button type="button" onClick={cancelar} className="btn-contorno px-5 py-3 text-sm">Cancelar</button>
        </div>
      </fieldset>
    </form>
  );
}

function GrupoPaginas({ grupo, children }: { grupo: string; children: React.ReactNode }) {
  return (
    <>
      <tr className="bg-superficie-2/60">
        <td colSpan={2} className="px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-texto-2">{grupo}</td>
      </tr>
      {children}
    </>
  );
}
