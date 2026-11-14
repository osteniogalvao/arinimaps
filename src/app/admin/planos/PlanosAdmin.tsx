"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { enviarJson, type ErroApi } from "@/lib/api/enviar";
import {
  COTAS, GRUPO_RECURSO_LABEL, NICHOS, RECURSOS, type Plano, type Recurso,
} from "@/lib/planos";
import { AvisoErro } from "@/components/ui/Aviso";
import { CAMPO, Etiqueta, ROTULO, Vazio } from "@/components/ui/Pagina";
import { ChevronDown, Layers, Plus, Save, Star, Users, X } from "lucide-react";
import { plural } from "@/lib/format";
import { PLANOS_CATALOGO } from "@/lib/planos-catalogo";

const GRUPOS = Object.keys(GRUPO_RECURSO_LABEL) as Recurso["grupo"][];
const input = CAMPO + " disabled:opacity-60";
const rotulo = ROTULO;

type Form = {
  anual: string; promocao: string;
  id: string; nome: string; descricao: string; preco_mensal: string; periodicidade: string; escopo: string;
  destaque: boolean; ativo: boolean; ordem: string; nichos_padrao: string[]; recursos: string[];
  cotas: Record<string, string>;
};

const NOVO: Form = {
  anual: "", promocao: "",
  id: "", nome: "", descricao: "", preco_mensal: "0", periodicidade: "mensal", escopo: "conta",
  destaque: false, ativo: true, ordem: "100", nichos_padrao: [], recursos: [], cotas: {},
};

function formDe(p: Plano): Form {
  return {
    anual: p.preco_anual_centavos == null ? "" : String(p.preco_anual_centavos / 100),
    promocao: p.primeiro_mes_centavos == null ? "" : String(p.primeiro_mes_centavos / 100),
    id: p.id, nome: p.nome, descricao: p.descricao, preco_mensal: String(p.preco_mensal ?? 0),
    periodicidade: p.periodicidade, escopo: p.escopo, destaque: p.destaque, ativo: p.ativo, ordem: String(p.ordem ?? 100),
    nichos_padrao: [...(p.nichos_padrao ?? [])], recursos: [...(p.recursos ?? [])],
    cotas: Object.fromEntries(COTAS.map((c) => [c.id, p.cotas?.[c.id] != null ? String(p.cotas[c.id]) : ""])),
  };
}

function corpoDe(f: Form) {
  const cotas: Record<string, number> = {};
  for (const c of COTAS) if (f.cotas[c.id]?.trim() !== "" && f.cotas[c.id] != null) cotas[c.id] = Number(f.cotas[c.id]);
  return {
    id: f.id.trim(), nome: f.nome.trim(), descricao: f.descricao.trim(),
    ...(PLANOS_CATALOGO.some(p => p.id === f.id) ? {
      preco_anual_centavos: f.anual.trim() ? Math.round(Number(f.anual.replace(",", ".")) * 100) : null,
      primeiro_mes_centavos: f.promocao.trim() ? Math.round(Number(f.promocao.replace(",", ".")) * 100) : null,
    } : {}),
    preco_mensal: Number(String(f.preco_mensal).replace(",", ".")), periodicidade: f.periodicidade, escopo: f.escopo,
    destaque: f.destaque, ativo: f.ativo, ordem: Number(f.ordem), nichos_padrao: f.nichos_padrao, recursos: f.recursos, cotas,
  };
}

function Erro({ erro }: { erro: ErroApi }) {
  return <AvisoErro erro={erro} />;
}

/** Formulário de um plano (existente ou novo). */
function FormPlano({
  inicial, novo, contas, ehDiretoria, aoSalvar, aoCancelar,
}: {
  inicial: Form; novo: boolean; contas: number; ehDiretoria: boolean;
  aoSalvar: (f: Form) => Promise<void>; aoCancelar?: () => void;
}) {
  const [f, setF] = useState<Form>(inicial);
  const [aberto, setAberto] = useState(novo);
  const [sujo, setSujo] = useState(novo);
  const [salvando, setSalvando] = useState(false);
  const [msg, setMsg] = useState("");
  const [erro, setErro] = useState<ErroApi | null>(null);

  const mudar = (patch: Partial<Form>) => { setF((s) => ({ ...s, ...patch })); setSujo(true); setMsg(""); setErro(null); };
  const alternar = (campo: "nichos_padrao" | "recursos", id: string) =>
    mudar({ [campo]: f[campo].includes(id) ? f[campo].filter((x) => x !== id) : [...f[campo], id] });

  async function salvar() {
    setSalvando(true); setMsg(""); setErro(null);
    try {
      await aoSalvar(f);
      setMsg(novo ? "Plano criado." : "Plano salvo. As mudanças já valem para as contas.");
      setSujo(false);
    } catch (e) {
      setErro(e as ErroApi);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className={"cartao overflow-hidden " + (f.ativo ? "" : "opacity-80")}>
      <button type="button" onClick={() => setAberto(!aberto)}
        className="w-full px-6 py-5 flex items-center gap-4 flex-wrap text-left transition-colors hover:bg-superficie-2/50">
        <span className={"hidden sm:grid size-11 shrink-0 place-items-center rounded-xl " + (f.destaque ? "bg-ouro/15 text-ouro" : "bg-verde/12 text-verde")}>
          {novo ? <Plus className="size-5" /> : <Layers className="size-5" />}
        </span>
        <div className="flex-1 min-w-48">
          <p className="lp-display text-lg text-texto">
            {novo ? "Novo plano" : f.nome || f.id}
            {!novo && <span className="ml-2 font-mono text-xs font-normal text-texto-2">{f.id}</span>}
          </p>
          {!novo && <p className="mt-0.5 text-sm text-texto-2 tabular-nums">{plural(f.recursos.length, "recurso")} · ordem {f.ordem}</p>}
        </div>
        {!novo && (
          <>
            {f.destaque && <Etiqueta tom="ouro"><Star className="size-3.5" /> destaque</Etiqueta>}
            <Etiqueta tom={f.ativo ? "verde" : "neutro"}>
              {f.ativo ? "ativo" : "inativo"}
            </Etiqueta>
            <Etiqueta tom="neutro" className="tabular-nums"><Users className="size-3.5" /> {plural(contas, "conta")}</Etiqueta>
          </>
        )}
        <ChevronDown className={"size-5 text-texto-2 transition-transform " + (aberto ? "rotate-180" : "")} aria-hidden />
      </button>

      {aberto && (
        <div className="px-6 pb-6 space-y-7 border-t border-linha pt-6">
          <div className="grid gap-5 sm:grid-cols-2">
            {novo && (
              <div>
                <label className={rotulo} htmlFor={`id-${f.id || "novo"}`}>Identificador (slug) *</label>
                <input id={`id-${f.id || "novo"}`} className={input + " font-mono"} placeholder="ex.: consulta_avancada"
                  value={f.id} onChange={(e) => mudar({ id: e.target.value.toLowerCase() })} />
                <p className="text-sm text-texto-2 mt-1.5">Letras minúsculas, números e _; não muda depois.</p>
              </div>
            )}
            <div>
              <label className={rotulo} htmlFor={`nome-${f.id}`}>Nome *</label>
              <input id={`nome-${f.id}`} className={input} disabled={!ehDiretoria}
                value={f.nome} onChange={(e) => mudar({ nome: e.target.value })} />
            </div>
            <div className="sm:col-span-2">
              <label className={rotulo} htmlFor={`desc-${f.id}`}>Descrição (aparece na página de planos)</label>
              <textarea id={`desc-${f.id}`} rows={2} className={input} disabled={!ehDiretoria}
                value={f.descricao} onChange={(e) => mudar({ descricao: e.target.value })} />
            </div>
            <div>
              <label className={rotulo} htmlFor={`preco-${f.id}`}>Preço (R$)</label>
              <input id={`preco-${f.id}`} className={input} inputMode="decimal" disabled={!ehDiretoria}
                value={f.preco_mensal} onChange={(e) => mudar({ preco_mensal: e.target.value })} />
              <p className="text-sm text-texto-2 mt-1.5">Zero com periodicidade paga = “sob consulta” na página pública.</p>
            </div>
            {PLANOS_CATALOGO.some(p => p.id === f.id) && <>
              <label className={rotulo}>Valor anual em reais (opcional)
                <input className={input} type="number" min="0" step="0.01" value={f.anual} disabled={!ehDiretoria} onChange={e => mudar({ anual:e.target.value })} /></label>
              <label className={rotulo}>Primeiro mês em reais (opcional)
                <input className={input} type="number" min="0" step="0.01" value={f.promocao} disabled={!ehDiretoria} onChange={e => mudar({ promocao:e.target.value })} /></label>
            </>}
            <div>
              <label className={rotulo} htmlFor={`per-${f.id}`}>Periodicidade</label>
              <select id={`per-${f.id}`} className={input} disabled={!ehDiretoria}
                value={f.periodicidade} onChange={(e) => mudar({ periodicidade: e.target.value })}>
                <option value="gratis">Gratuito</option>
                <option value="mensal">Mensal</option>
                <option value="anual">Anual</option>
              </select>
            </div>
            <div>
              <label className={rotulo} htmlFor={`esc-${f.id}`}>Escopo</label>
              <select id={`esc-${f.id}`} className={input} disabled={!ehDiretoria}
                value={f.escopo} onChange={(e) => mudar({ escopo: e.target.value })}>
                <option value="conta">Por conta</option>
                <option value="organizacao">Por organização</option>
              </select>
            </div>
            <div>
              <label className={rotulo} htmlFor={`ordem-${f.id}`}>Ordem na página</label>
              <input id={`ordem-${f.id}`} className={input} inputMode="numeric" disabled={!ehDiretoria}
                value={f.ordem} onChange={(e) => mudar({ ordem: e.target.value })} />
            </div>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 sm:col-span-2">
              <label className="flex items-center gap-2 text-[0.95rem] text-texto">
                <input type="checkbox" checked={f.destaque} disabled={!ehDiretoria} onChange={(e) => mudar({ destaque: e.target.checked })} />
                Em destaque
              </label>
              <label className="flex items-center gap-2 text-[0.95rem] text-texto">
                <input type="checkbox" checked={f.ativo} disabled={!ehDiretoria} onChange={(e) => mudar({ ativo: e.target.checked })} />
                Ativo (aparece na página e pode ser atribuído)
              </label>
            </div>
          </div>

          <div>
            <p className={rotulo}>Nichos que nascem com este plano</p>
            <div className="flex flex-wrap gap-2">
              {NICHOS.map((n) => {
                const marcado = f.nichos_padrao.includes(n.id);
                return (
                  <label key={n.id} title={n.descricao}
                    className={"rounded-lg border px-3 py-1.5 text-sm font-semibold cursor-pointer transition-colors " +
                      (marcado ? "border-verde bg-verde/10 text-verde" : "border-linha-forte text-texto-2 hover:text-texto")}>
                    <input type="checkbox" className="hidden" checked={marcado} disabled={!ehDiretoria}
                      onChange={() => alternar("nichos_padrao", n.id)} />
                    {n.nome}{n.reservado ? " ·" : ""}
                  </label>
                );
              })}
            </div>
            <p className="text-sm text-texto-2 mt-2">Se dois planos ativos marcam o mesmo nicho, vale o de menor ordem.</p>
          </div>

          <div className="space-y-4">
            <p className={rotulo}>Recursos liberados</p>
            {GRUPOS.map((g) => (
              <div key={g} className="rounded-xl border border-linha p-4">
                <p className="text-[11px] uppercase tracking-wider text-texto-2 font-semibold mb-3">{GRUPO_RECURSO_LABEL[g]}</p>
                <div className="grid gap-x-5 gap-y-3 sm:grid-cols-2">
                  {RECURSOS.filter((r) => r.grupo === g).map((r) => (
                    <label key={r.id} className="flex items-start gap-2.5 text-[0.95rem] text-texto cursor-pointer" title={r.descricao}>
                      <input type="checkbox" className="mt-1" checked={f.recursos.includes(r.id)} disabled={!ehDiretoria}
                        onChange={() => alternar("recursos", r.id)} />
                      <span>
                        {r.nome}
                        {r.reservado && <Etiqueta tom="ouro" className="ml-1.5 !py-0.5">reservado</Etiqueta>}
                        <span className="mt-0.5 block text-sm text-texto-2">{r.descricao}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div>
            <p className={rotulo}>Limites (vazio = sem limite)</p>
            <div className="grid gap-4 sm:grid-cols-2">
              {COTAS.map((c) => (
                <div key={c.id}>
                  <label className="mb-1.5 block text-sm text-texto-2" htmlFor={`cota-${f.id}-${c.id}`}>{c.nome}</label>
                  <input id={`cota-${f.id}-${c.id}`} className={input} inputMode="numeric" placeholder="sem limite" disabled={!ehDiretoria}
                    value={f.cotas[c.id] ?? ""} onChange={(e) => mudar({ cotas: { ...f.cotas, [c.id]: e.target.value } })} />
                  <p className="text-xs text-texto-2 mt-1.5">{c.ajuda}</p>
                </div>
              ))}
            </div>
          </div>

          {erro && <Erro erro={erro} />}
          {msg && <p className="text-sm font-semibold text-verde">{msg}</p>}

          {ehDiretoria && (
            <div className="flex items-center gap-3 flex-wrap border-t border-linha pt-5">
              <button onClick={salvar} disabled={salvando || !sujo} className="btn-ouro inline-flex items-center gap-2 px-6 py-3 disabled:opacity-45">
                <Save className="size-4" />
                {salvando ? "Salvando…" : novo ? "Criar plano" : sujo ? "Salvar alterações" : "Nada alterado"}
              </button>
              {aoCancelar && (
                <button type="button" onClick={aoCancelar} className="btn-contorno px-5 py-3 text-sm">Cancelar</button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function PlanosAdmin({
  planos, contasPorPlano, ehDiretoria,
}: { planos: Plano[]; contasPorPlano: Record<string, number>; ehDiretoria: boolean }) {
  const router = useRouter();
  const [criando, setCriando] = useState(false);

  async function salvar(metodo: "POST" | "PATCH", f: Form) {
    const r = await enviarJson("/api/admin/planos", metodo, corpoDe(f));
    if (!r.ok) throw r.erro;
    router.refresh();
  }

  return (
    <section className="space-y-5">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <p className="lp-eyebrow text-xs">Catálogo</p>
          <h2 className="lp-display mt-2 text-2xl md:text-[1.75rem] text-texto">Planos ({planos.length})</h2>
          {!ehDiretoria && <p className="mt-1.5 text-base text-texto-2">Só a diretoria altera planos; aqui você consulta.</p>}
        </div>
        {ehDiretoria && (
          <button onClick={() => setCriando(!criando)}
            className={(criando ? "btn-contorno" : "btn-verde") + " inline-flex items-center gap-2 px-5 py-3 text-sm"}>
            {criando ? <X className="size-4" /> : <Plus className="size-4" />}
            {criando ? "Cancelar" : "Novo plano"}
          </button>
        )}
      </div>

      <div className="space-y-4">
        {criando && (
          <FormPlano key="novo" inicial={NOVO} novo contas={0} ehDiretoria={ehDiretoria}
            aoSalvar={async (f) => { await salvar("POST", f); setCriando(false); }}
            aoCancelar={() => setCriando(false)} />
        )}
        {planos.map((p) => (
          <FormPlano key={p.id + ":" + p.ordem + ":" + p.ativo} inicial={formDe(p)} novo={false}
            contas={contasPorPlano[p.id] ?? 0} ehDiretoria={ehDiretoria}
            aoSalvar={(f) => salvar("PATCH", f)} />
        ))}
        {!planos.length && !criando && (
          <Vazio icone={Layers} titulo="Nenhum plano cadastrado." />
        )}
      </div>
    </section>
  );
}
