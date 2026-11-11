"use client";

import { useState } from "react";
import { PROBABILIDADE_LABEL, RELATORIO_VAZIO, VALOR_PERCEBIDO_LABEL, type RelatorioVisita } from "@/lib/visitas";
import { CAMPO } from "@/components/ui/Pagina";

/**
 * Relatório obrigatório depois da visita (Central de CRMs, bloco 1).
 * O que vai em "Para o proprietário" e as notas/objeções aparecem no
 * Acompanhamento do imóvel, sem o nome nem o contato do interessado.
 */
export default function RelatorioVisitaForm({ ocupado, onEnviar, onCancelar }: {
  ocupado: boolean;
  onEnviar: (r: RelatorioVisita) => void;
  onCancelar: () => void;
}) {
  const [r, setR] = useState<RelatorioVisita>(RELATORIO_VAZIO);
  const campo = CAMPO + " !py-2 text-sm";
  const set = <K extends keyof RelatorioVisita>(k: K, v: RelatorioVisita[K]) => setR({ ...r, [k]: v });

  return (
    <form className="basis-full space-y-3 rounded-xl border border-verde/30 bg-superficie p-4"
      onSubmit={(e) => { e.preventDefault(); onEnviar(r); }}>
      <p className="text-sm font-semibold text-texto">Relatório da visita</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-xs text-texto-2">Interesse do visitante
          <select className={campo} value={r.interesse} onChange={(e) => set("interesse", Number(e.target.value))}>
            {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n} de 5</option>)}
          </select>
        </label>
        <label className="text-xs text-texto-2">Chance de negócio
          <select className={campo} value={r.probabilidade} onChange={(e) => set("probabilidade", e.target.value as RelatorioVisita["probabilidade"])}>
            {Object.entries(PROBABILIDADE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <label className="text-xs text-texto-2">Sobre o preço
          <select className={campo} value={r.valor_percebido} onChange={(e) => set("valor_percebido", e.target.value as RelatorioVisita["valor_percebido"])}>
            {Object.entries(VALOR_PERCEBIDO_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs text-texto-2">O que gostou
          <textarea className={campo} rows={2} value={r.pontos_positivos} onChange={(e) => set("pontos_positivos", e.target.value)} />
        </label>
        <label className="text-xs text-texto-2">O que fez hesitar
          <textarea className={campo} rows={2} value={r.objecoes} onChange={(e) => set("objecoes", e.target.value)} />
        </label>
      </div>
      <label className="block text-xs text-texto-2">Próximo passo (obrigatório)
        <input required className={campo} value={r.proximo_passo} placeholder="Ex.: enviar a matrícula e ligar na sexta"
          onChange={(e) => set("proximo_passo", e.target.value)} />
      </label>
      <label className="block text-xs text-texto-2">Recado para o proprietário (opcional)
        <textarea className={campo} rows={2} value={r.resumo_proprietario} onChange={(e) => set("resumo_proprietario", e.target.value)} />
      </label>
      <label className="flex items-center gap-2 text-sm text-texto">
        <input type="checkbox" className="size-4 accent-[var(--verde)]" checked={r.compartilhar}
          onChange={(e) => set("compartilhar", e.target.checked)} />
        Mostrar este retorno ao proprietário (sem nome nem contato do interessado)
      </label>
      <div className="flex gap-2">
        <button disabled={ocupado} className="btn-verde px-4 py-2 text-sm disabled:opacity-60">Salvar relatório</button>
        <button type="button" onClick={onCancelar} className="btn-contorno px-4 py-2 text-sm">Cancelar</button>
      </div>
    </form>
  );
}
