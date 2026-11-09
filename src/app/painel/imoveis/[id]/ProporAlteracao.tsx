"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { enviarJson } from "@/lib/api/enviar";
import { CAMPO_REVISAO_LABEL, valorRevisao, type DadosRevisao } from "@/lib/imovel/revisao";
import { Clock, PencilLine } from "lucide-react";
import { CAMPO, ROTULO } from "@/components/ui/Pagina";
import { TOUR_AJUDA } from "@/lib/imovel/tour";

type Atual = {
  titulo: string; descricao: string; valor: number | null; area_declarada: number | null;
  condicoes_venda: string | null; aceita_permuta: boolean; aceita_financiamento: boolean;
  tour_virtual_url: string | null;
};
type Pendente = { id: string; versao: number; dados: Record<string, unknown>; created_at: string } | null;

/**
 * Anúncio publicado: o anunciante não edita direto — propõe uma nova versão
 * que vai para a Matriz (Fluxograma §9). O anúncio atual continua no ar até a
 * decisão.
 */
export default function ProporAlteracao({ propertyId, atual, pendente, tipo }: {
  propertyId: string; atual: Atual; pendente: Pendente; tipo: "urbano" | "rural";
}) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState("");
  const [form, setForm] = useState({
    titulo: atual.titulo ?? "",
    descricao: atual.descricao ?? "",
    valor: atual.valor != null ? String(atual.valor) : "",
    area_declarada: atual.area_declarada != null ? String(atual.area_declarada) : "",
    condicoes_venda: atual.condicoes_venda ?? "",
    aceita_permuta: !!atual.aceita_permuta,
    aceita_financiamento: !!atual.aceita_financiamento,
    tour_virtual_url: atual.tour_virtual_url ?? "",
  });

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setOcupado(true);
    setErro("");
    const corpo: DadosRevisao = {
      titulo: form.titulo,
      descricao: form.descricao,
      valor: form.valor.trim() === "" ? null : Number(form.valor.replace(/\./g, "").replace(",", ".")),
      area_declarada: form.area_declarada.trim() === "" ? null : Number(form.area_declarada.replace(/\./g, "").replace(",", ".")),
      condicoes_venda: form.condicoes_venda || null,
      aceita_permuta: form.aceita_permuta,
      aceita_financiamento: form.aceita_financiamento,
      tour_virtual_url: form.tour_virtual_url.trim() || null,
    };
    const r = await enviarJson(`/api/imoveis/${propertyId}/revisao`, "POST", corpo);
    setOcupado(false);
    if (!r.ok) { setErro(r.erro.mensagem + (r.erro.solucao ? ` ${r.erro.solucao}` : "")); return; }
    setAberto(false);
    router.refresh();
  }

  async function cancelar() {
    if (!confirm("Cancelar a alteração proposta? O anúncio continua como está.")) return;
    setOcupado(true);
    setErro("");
    const r = await enviarJson(`/api/imoveis/${propertyId}/revisao`, "DELETE");
    setOcupado(false);
    if (!r.ok) { setErro(r.erro.mensagem); return; }
    router.refresh();
  }

  const campo = CAMPO;

  if (pendente) {
    const campos = Object.keys(pendente.dados ?? {});
    return (
      <div className="space-y-5">
        <div className="flex items-start gap-3 rounded-2xl border border-alerta/40 bg-alerta/10 px-5 py-4">
          <Clock className="mt-0.5 size-5 shrink-0 text-alerta" />
          <div>
            <p className="text-base font-semibold text-alerta">
              Alteração (versão {pendente.versao}) aguardando a Matriz desde {new Date(pendente.created_at).toLocaleDateString("pt-BR")}.
            </p>
            <p className="mt-1 text-sm text-texto-2">
              O anúncio atual continua no ar até a Arini aprovar. Se aprovada, os campos abaixo substituem os publicados.
            </p>
          </div>
        </div>
        <dl className="divide-y divide-linha rounded-xl border border-linha">
          {campos.map((c) => (
            <div key={c} className="flex flex-col gap-1 px-4 py-3.5 sm:flex-row sm:gap-4">
              <dt className="w-44 shrink-0 text-sm font-semibold text-texto-2">{CAMPO_REVISAO_LABEL[c as keyof typeof CAMPO_REVISAO_LABEL] ?? c}</dt>
              <dd className="text-base text-texto whitespace-pre-line">{valorRevisao(c, pendente.dados[c])}</dd>
            </div>
          ))}
        </dl>
        <button type="button" disabled={ocupado} onClick={cancelar}
          className="btn-contorno px-5 py-2.5 text-sm">
          {ocupado ? "Cancelando…" : "Cancelar proposta"}
        </button>
        {erro && <p className="text-sm text-critico">{erro}</p>}
      </div>
    );
  }

  if (!aberto) {
    return (
      <div className="space-y-4">
        <p className="text-base leading-relaxed text-texto-2">
          Seu anúncio está publicado. Mudanças de título, descrição, valor, área, condições ou tour virtual passam pela Matriz
          antes de entrar no ar — enquanto isso, o anúncio atual continua visível.
        </p>
        <button type="button" onClick={() => setAberto(true)}
          className="btn-verde inline-flex items-center gap-2 px-5 py-2.5 text-sm">
          <PencilLine className="size-4" /> Propor alteração
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={enviar} className="space-y-5">
      <label className="block">
        <span className={ROTULO}>Título</span>
        <input className={campo} value={form.titulo} maxLength={120} required minLength={3}
          onChange={(e) => setForm({ ...form, titulo: e.target.value })} />
      </label>
      <label className="block">
        <span className={ROTULO}>Descrição</span>
        <textarea className={campo} rows={5} value={form.descricao} maxLength={5000}
          onChange={(e) => setForm({ ...form, descricao: e.target.value })} />
      </label>
      <div className="grid gap-5 sm:grid-cols-2">
        <label className="block">
          <span className={ROTULO}>Valor (R$)</span>
          <input className={campo} inputMode="decimal" value={form.valor}
            onChange={(e) => setForm({ ...form, valor: e.target.value })} />
        </label>
        <label className="block">
          <span className={ROTULO}>Área declarada ({tipo === "rural" ? "ha" : "m²"})</span>
          <input className={campo} inputMode="decimal" value={form.area_declarada}
            onChange={(e) => setForm({ ...form, area_declarada: e.target.value })} />
        </label>
      </div>
      <label className="block">
        <span className={ROTULO}>Condições de venda</span>
        <textarea className={campo} rows={3} value={form.condicoes_venda} maxLength={2000}
          onChange={(e) => setForm({ ...form, condicoes_venda: e.target.value })} />
      </label>
      <label className="block">
        <span className={ROTULO}>Tour virtual 360 / vídeo imersivo (opcional)</span>
        <input className={campo} type="url" inputMode="url" maxLength={500} value={form.tour_virtual_url}
          placeholder="https://my.matterport.com/show/?m=…"
          onChange={(e) => setForm({ ...form, tour_virtual_url: e.target.value })} />
        <span className="mt-1.5 block text-sm text-texto-2">{TOUR_AJUDA} Deixe em branco para retirar o tour.</span>
      </label>
      <div className="flex flex-wrap gap-5 text-base text-texto">
        <label className="flex items-center gap-2.5">
          <input type="checkbox" className="size-4 accent-[var(--verde)]" checked={form.aceita_permuta} onChange={(e) => setForm({ ...form, aceita_permuta: e.target.checked })} />
          Aceita permuta
        </label>
        <label className="flex items-center gap-2.5">
          <input type="checkbox" className="size-4 accent-[var(--verde)]" checked={form.aceita_financiamento} onChange={(e) => setForm({ ...form, aceita_financiamento: e.target.checked })} />
          Aceita financiamento
        </label>
      </div>
      {erro && <p className="text-sm text-critico">{erro}</p>}
      <div className="flex flex-wrap gap-3">
        <button type="submit" disabled={ocupado}
          className="btn-verde px-5 py-2.5 text-sm disabled:opacity-50">
          {ocupado ? "Enviando…" : "Enviar para a Matriz"}
        </button>
        <button type="button" disabled={ocupado} onClick={() => setAberto(false)}
          className="btn-contorno px-5 py-2.5 text-sm">
          Voltar
        </button>
      </div>
      <p className="text-sm text-texto-2">
        Só os campos que mudaram entram na proposta. O anúncio publicado continua no ar até a decisão.
      </p>
    </form>
  );
}
