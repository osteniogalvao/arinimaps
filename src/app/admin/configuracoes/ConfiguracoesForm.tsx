"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { enviarJson } from "@/lib/api/enviar";
import { GRUPOS, type Campo } from "@/lib/configuracoes";
import { CAMPO, Etiqueta } from "@/components/ui/Pagina";
import {
  Brain, CheckCircle2, Map as MapaIcone, Monitor, Save, Scale, Settings, ShieldCheck, Tag, Wallet, type LucideIcon,
} from "lucide-react";

/** Ícone de cada grupo (o `icone` de GRUPOS é texto e não segue o kit de ícones). */
const ICONE_GRUPO: Record<string, LucideIcon> = {
  marca: Tag, site: Monitor, comercial: Wallet, juridico: Scale, seguranca: ShieldCheck, inteligencia: Brain, mapa: MapaIcone,
};

function IconeGrupo({ id, className }: { id: string; className?: string }) {
  const Icone = ICONE_GRUPO[id] ?? Settings;
  return <Icone className={className} />;
}

export default function ConfiguracoesForm({
  inicial, ehDiretoria,
}: { inicial: Record<string, unknown>; ehDiretoria: boolean }) {
  const router = useRouter();
  const [aba, setAba] = useState(GRUPOS[0].id);
  const [valores, setValores] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      Object.entries(inicial).map(([k, v]) => [k, Array.isArray(v) ? v.join("\n") : String(v ?? "")])
    )
  );
  const [sujo, setSujo] = useState<Set<string>>(new Set());
  const [salvando, setSalvando] = useState(false);
  const [msg, setMsg] = useState("");
  const [erro, setErro] = useState("");

  const grupo = GRUPOS.find((g) => g.id === aba)!;
  const alterar = (chave: string, v: string) => {
    setValores((s) => ({ ...s, [chave]: v }));
    setSujo((s) => new Set(s).add(chave));
    setMsg(""); setErro("");
  };

  async function salvar() {
    setSalvando(true); setMsg(""); setErro("");
    const corpo = Object.fromEntries([...sujo].map((k) => [k, valores[k]]));
    const r = await enviarJson<{ salvos?: number }>("/api/admin/configuracoes", "POST", corpo);
    setSalvando(false);
    if (r.ok) {
      const salvos = r.dados.salvos ?? 0;
      setMsg(`${salvos === 1 ? "1 configuração salva" : `${salvos} configurações salvas`}. As mudanças já valem no site.`);
      setSujo(new Set());
      router.refresh();
    } else setErro([r.erro.mensagem, r.erro.motivo].filter(Boolean).join(" — "));
  }

  const inputBase = CAMPO + " disabled:opacity-60 disabled:text-texto-2";

  function renderCampo(c: Campo) {
    const bloqueado = c.somenteDiretoria && !ehDiretoria;
    const v = valores[c.chave] ?? "";
    return (
      <div key={c.chave} className={c.tipo === "textarea" || c.tipo === "lista" ? "sm:col-span-2" : ""}>
        <label className="mb-1.5 flex flex-wrap items-center gap-2 text-sm font-semibold text-texto" htmlFor={c.chave}>
          {c.rotulo}
          {c.somenteDiretoria && (
            <Etiqueta tom="ouro" className="!py-0.5 !text-[10px] uppercase tracking-wider">diretoria</Etiqueta>
          )}
        </label>
        <div className="relative">
          {c.tipo === "sim_nao" ? (
            <select id={c.chave} className={inputBase} disabled={bloqueado}
              value={v === "true" ? "true" : "false"}
              onChange={(e) => alterar(c.chave, e.target.value)}>
              <option value="false">Não</option>
              <option value="true">Sim</option>
            </select>
          ) : c.tipo === "textarea" || c.tipo === "lista" ? (
            <textarea id={c.chave} rows={c.tipo === "lista" ? 7 : 3} className={inputBase}
              value={v} disabled={bloqueado} onChange={(e) => alterar(c.chave, e.target.value)} />
          ) : (
            <input id={c.chave} className={inputBase + (c.sufixo ? " pr-14" : "")}
              inputMode={["numero", "dinheiro", "percentual", "coordenada"].includes(c.tipo) ? "decimal" : undefined}
              value={v} disabled={bloqueado} onChange={(e) => alterar(c.chave, e.target.value)} />
          )}
          {c.sufixo && (
            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm text-texto-2">{c.sufixo}</span>
          )}
        </div>
        {c.ajuda && <p className="text-sm leading-relaxed text-texto-2 mt-1.5">{c.ajuda}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-6 lg:grid-cols-[250px_minmax(0,1fr)] lg:items-start">
        <nav aria-label="Grupos de configuração" className="lg:sticky lg:top-24">
          <ul className="flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:gap-1 lg:overflow-visible lg:pb-0">
            {GRUPOS.map((g) => {
              const ativo = aba === g.id;
              return (
                <li key={g.id} className="shrink-0">
                  <button onClick={() => setAba(g.id)} aria-current={ativo ? "page" : undefined}
                    className={`flex w-full items-center gap-3 rounded-xl border px-4 py-2.5 text-left text-sm font-semibold transition-colors
                      ${ativo ? "border-verde bg-verde text-fundo" : "border-transparent text-texto-2 hover:bg-superficie-2 hover:text-texto"}`}>
                    <IconeGrupo id={g.id} className="size-4 shrink-0" /> {g.titulo}
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="cartao p-6 md:p-8 space-y-6 min-w-0">
          <div className="flex items-start gap-4 border-b border-linha pb-5">
            <span className="hidden sm:grid size-11 shrink-0 place-items-center rounded-xl bg-verde/12 text-verde"><IconeGrupo id={grupo.id} className="size-5" /></span>
            <div>
              <h2 className="lp-display text-2xl text-texto">{grupo.titulo}</h2>
              <p className="mt-1 text-base text-texto-2">{grupo.descricao}</p>
            </div>
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            {grupo.campos.map(renderCampo)}
          </div>
        </div>
      </div>

      <div className="sticky bottom-4 z-10 flex flex-wrap items-center gap-4 rounded-2xl border border-linha bg-superficie/95 px-5 py-3.5 shadow-lg backdrop-blur">
        <button onClick={salvar} disabled={salvando || !sujo.size}
          className="btn-ouro inline-flex items-center gap-2 px-7 py-3 disabled:opacity-45">
          <Save className="size-4" />
          {salvando ? "Salvando…" : sujo.size ? `Salvar ${sujo.size} alteração(ões)` : "Nada alterado"}
        </button>
        {msg && <span className="inline-flex items-center gap-1.5 text-sm text-verde font-semibold"><CheckCircle2 className="size-4" /> {msg}</span>}
        {erro && <span className="text-sm font-semibold text-critico">{erro}</span>}
      </div>
    </div>
  );
}
