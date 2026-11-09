"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { enviarJson } from "@/lib/api/enviar";
import { CircleCheck, Link2, Plus, SearchX } from "lucide-react";
import { CAMPO, Etiqueta, ROTULO } from "@/components/ui/Pagina";
import { CAMPO_COMPACTO, CODIGO, LISTA } from "@/components/admin/estilos";

const input = CAMPO;

export type DemandaLinha = {
  id: string; codigo: string; cliente_nome: string; cliente_contato: string | null; opportunity_id: string | null;
  tipo: string | null; municipios: string[]; area_min: number | null; area_max: number | null;
  valor_min: number | null; valor_max: number | null; observacoes: string | null; status: string;
  responsavel: string | null; fechada_em: string | null; motivo_fechamento: string | null; created_at: string;
  casamentos: { codigo: string; titulo: string; status: string; em: string }[];
};
export type Prefill = {
  opportunity_id: string; opportunity_codigo: string; cliente_nome: string; cliente_contato: string;
  tipo: string; municipios: string[];
};
type Municipio = { id: string; nome: string; uf: string };
type Membro = { user_id: string; nome: string };

const SITUACAO: Record<string, string> = { aberta: "Aberta", atendida: "Atendida", cancelada: "Cancelada" };
const brl = (v: number | null) => (v == null ? null : Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }));
// data sem hora ancorada ao meio-dia: senão cai no dia anterior no horário de Brasília
const dataBR = (d: string | null) => (d ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d}T12:00:00` : d).toLocaleDateString("pt-BR") : "—");

function faixa(min: number | null, max: number | null, fmt: (v: number | null) => string | null) {
  if (min == null && max == null) return null;
  if (min != null && max != null) return `${fmt(min)} a ${fmt(max)}`;
  return min != null ? `a partir de ${fmt(min)}` : `até ${fmt(max)}`;
}

const VAZIO = {
  cliente_nome: "", cliente_contato: "", tipo: "", municipios: [] as string[],
  area_min: "", area_max: "", valor_min: "", valor_max: "", observacoes: "", responsavel: "",
};

export default function Demandas({
  demandas, municipios, equipe, souEu, prefill, destaque,
}: {
  demandas: DemandaLinha[]; municipios: Municipio[]; equipe: Membro[]; souEu: string;
  prefill: Prefill | null; destaque: string | null;
}) {
  const router = useRouter();
  const [form, setForm] = useState<typeof VAZIO | null>(
    prefill ? { ...VAZIO, ...prefill, responsavel: souEu } : null,
  );
  const [erro, setErro] = useState("");
  const [ok, setOk] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const nomeMun = new Map(municipios.map((m) => [m.id, `${m.nome}/${m.uf}`]));
  const nomeEquipe = new Map(equipe.map((m) => [m.user_id, m.nome]));
  const unidade = form?.tipo === "rural" ? "ha" : form?.tipo === "urbano" ? "m²" : "";

  async function criar(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    setOcupado(true); setErro(""); setOk("");
    const r = await enviarJson<{ codigo?: string }>("/api/demandas", "POST", { ...form, opportunity_id: prefill?.opportunity_id ?? null });
    setOcupado(false);
    if (!r.ok) { setErro([r.erro.mensagem, r.erro.motivo].filter(Boolean).join(" — ")); return; }
    setOk(`Demanda ${r.dados.codigo ?? ""} registrada. Vamos avisar quando um imóvel publicado casar com ela.`);
    setForm(null);
    router.replace("/admin/demandas");
    router.refresh();
  }

  async function mudarStatus(id: string, status: string) {
    const motivo = status === "aberta" ? "" : prompt(status === "atendida" ? "Como foi atendida? (opcional)" : "Motivo do cancelamento (opcional)") ?? null;
    if (motivo === null) return;
    setErro("");
    const r = await enviarJson(`/api/demandas/${id}`, "PATCH", { status, motivo });
    if (r.ok) router.refresh(); else setErro(r.erro.mensagem);
  }

  async function mudarResponsavel(id: string, responsavel: string) {
    setErro("");
    const r = await enviarJson(`/api/demandas/${id}`, "PATCH", { responsavel });
    if (r.ok) router.refresh(); else setErro(`Não foi possível trocar o responsável: ${r.erro.mensagem}`);
  }

  return (
    <div className="space-y-4">
      {ok && <p className="flex items-center gap-2 rounded-xl border border-verde/40 bg-verde/10 px-4 py-3 text-[0.95rem] text-verde"><CircleCheck className="size-5 shrink-0" />{ok}</p>}
      {/* erro das ações da lista (status, responsável); o do formulário aparece dentro dele */}
      {erro && !form && <p role="alert" className="text-sm text-critico">{erro}</p>}
      {!form ? (
        <button type="button" onClick={() => setForm({ ...VAZIO, responsavel: souEu })} className="btn-verde inline-flex items-center gap-2 px-5 py-2.5 text-sm">
          <Plus className="size-4" /> Registrar demanda
        </button>
      ) : (
        <form onSubmit={criar} className="cartao p-6 space-y-5">
          <div>
            <h2 className="lp-display text-xl md:text-2xl text-texto">Nova demanda</h2>
            {prefill && (
              <p className="mt-1.5 text-[0.95rem] text-texto-2">Da oportunidade {prefill.opportunity_codigo} — cliente, tipo e município vieram do imóvel que ele não quis. Ajuste ao que ele procura.</p>
            )}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className={ROTULO}>Cliente *</span>
              <input required className={input + " w-full"} value={form.cliente_nome} onChange={(e) => setForm({ ...form, cliente_nome: e.target.value })} />
            </label>
            <label className="block">
              <span className={ROTULO}>Contato (telefone, e-mail)</span>
              <input className={input + " w-full"} value={form.cliente_contato} onChange={(e) => setForm({ ...form, cliente_contato: e.target.value })} />
            </label>
            <label className="block">
              <span className={ROTULO}>Tipo de imóvel</span>
              <select className={input + " w-full"} value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value })}>
                <option value="">Rural ou urbano</option>
                <option value="rural">Rural</option>
                <option value="urbano">Urbano</option>
              </select>
            </label>
            <label className="block">
              <span className={ROTULO}>Responsável</span>
              <select className={input + " w-full"} value={form.responsavel} onChange={(e) => setForm({ ...form, responsavel: e.target.value })}>
                <option value="">—</option>
                {equipe.map((m) => <option key={m.user_id} value={m.user_id}>{m.nome || "—"}</option>)}
              </select>
            </label>
          </div>
          <fieldset>
            <legend className={ROTULO}>Municípios (nenhum marcado = qualquer um)</legend>
            <div className="flex flex-wrap gap-2">
              {municipios.map((m) => {
                const marcado = form.municipios.includes(m.id);
                return (
                  <button key={m.id} type="button"
                    onClick={() => setForm({ ...form, municipios: marcado ? form.municipios.filter((x) => x !== m.id) : [...form.municipios, m.id] })}
                    className={"rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors " + (marcado ? "border-verde bg-verde/12 text-verde" : "border-linha-forte text-texto-2 hover:border-verde hover:text-texto")}>
                    {m.nome}/{m.uf}
                  </button>
                );
              })}
            </div>
          </fieldset>
          <div className="grid gap-4 grid-cols-2 sm:grid-cols-4">
            {([["valor_min", "Valor mínimo (R$)"], ["valor_max", "Valor máximo (R$)"], ["area_min", `Área mínima ${unidade && `(${unidade})`}`], ["area_max", `Área máxima ${unidade && `(${unidade})`}`]] as const).map(([k, l]) => (
              <label key={k} className="block">
                <span className={ROTULO}>{l}</span>
                <input inputMode="decimal" className={input + " w-full"} value={form[k]}
                  disabled={k.startsWith("area") && !form.tipo}
                  title={k.startsWith("area") && !form.tipo ? "Escolha o tipo: a área é em hectares (rural) ou m² (urbano)" : undefined}
                  onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
              </label>
            ))}
          </div>
          <label className="block">
            <span className={ROTULO}>O que mais ele procura</span>
            <textarea rows={3} className={input + " w-full"} placeholder="Ex.: com represa, perto de asfalto, aceita permuta"
              value={form.observacoes} onChange={(e) => setForm({ ...form, observacoes: e.target.value })} />
          </label>
          {erro && <p className="text-sm text-critico">{erro}</p>}
          <div className="flex gap-2.5">
            <button disabled={ocupado} className="btn-verde px-5 py-2.5 text-sm disabled:opacity-60">Registrar</button>
            <button type="button" onClick={() => { setForm(null); setErro(""); }} className="btn-contorno px-5 py-2.5 text-sm">Cancelar</button>
          </div>
        </form>
      )}

      <div className={LISTA}>
        {demandas.map((d) => (
          <div key={d.id} id={d.codigo}
            className={"px-5 py-4 space-y-2 " + (destaque === d.codigo ? "bg-ouro/10" : "")}>
            <div className="flex items-center gap-3 flex-wrap">
              <span className={CODIGO}>{d.codigo}</span>
              <span className="flex-1 min-w-52 font-semibold text-texto">
                {d.cliente_nome}{d.cliente_contato && <span className="font-normal text-sm text-texto-2"> · {d.cliente_contato}</span>}
              </span>
              <Etiqueta tom={d.status === "aberta" ? "ouro" : d.status === "atendida" ? "verde" : "neutro"}>
                {SITUACAO[d.status]}
              </Etiqueta>
            </div>
            <p className="text-sm text-texto-2">
              {d.tipo ? (d.tipo === "rural" ? "Rural" : "Urbano") : "Rural ou urbano"}
              {" · "}{d.municipios.length ? d.municipios.map((m) => nomeMun.get(m) ?? "?").join(", ") : "qualquer município"}
              {faixa(d.valor_min, d.valor_max, brl) && ` · ${faixa(d.valor_min, d.valor_max, brl)}`}
              {d.tipo && faixa(d.area_min, d.area_max, (v) => `${Number(v).toLocaleString("pt-BR")} ${d.tipo === "rural" ? "ha" : "m²"}`) &&
                ` · ${faixa(d.area_min, d.area_max, (v) => `${Number(v).toLocaleString("pt-BR")} ${d.tipo === "rural" ? "ha" : "m²"}`)}`}
              {" · "}registrada em {dataBR(d.created_at)}
            </p>
            {d.observacoes && <p className="text-[0.95rem] leading-relaxed text-texto whitespace-pre-wrap">“{d.observacoes}”</p>}
            {d.casamentos.length > 0 && (
              <p className="inline-flex flex-wrap items-center gap-1.5 text-sm font-semibold text-verde">
                <Link2 className="size-4" /> Casou com: {d.casamentos.map((c, i) => (
                  <span key={c.codigo}>{i > 0 && ", "}<Link href={`/imovel/${c.codigo}`} target="_blank" className="hover:underline">{c.codigo}</Link></span>
                ))}
              </p>
            )}
            {d.status !== "aberta" && d.motivo_fechamento && (
              <p className="text-sm text-texto-2">Fechada em {dataBR(d.fechada_em)}: {d.motivo_fechamento}</p>
            )}
            <div className="flex items-center gap-3 flex-wrap pt-1 text-sm">
              <select className={CAMPO_COMPACTO + " !py-1.5 text-xs"} value={d.responsavel ?? ""} onChange={(e) => mudarResponsavel(d.id, e.target.value)}
                aria-label="Responsável">
                <option value="">Sem responsável</option>
                {equipe.map((m) => <option key={m.user_id} value={m.user_id}>{m.nome || "—"}</option>)}
              </select>
              {d.responsavel && !nomeEquipe.has(d.responsavel) && <span className="text-texto-2">responsável fora da equipe ativa</span>}
              {d.opportunity_id && <Link href={`/admin/oportunidades/${d.opportunity_id}`} className="font-semibold text-verde hover:underline underline-offset-4">oportunidade</Link>}
              <span className="ml-auto flex gap-4 font-semibold">
                {d.status === "aberta" ? (
                  <>
                    <button type="button" className="text-verde hover:underline" onClick={() => mudarStatus(d.id, "atendida")}>Marcar atendida</button>
                    <button type="button" className="text-texto-2 hover:text-critico" onClick={() => mudarStatus(d.id, "cancelada")}>Cancelar</button>
                  </>
                ) : (
                  <button type="button" className="text-texto-2 hover:text-texto" onClick={() => mudarStatus(d.id, "aberta")}>Reabrir</button>
                )}
              </span>
            </div>
          </div>
        ))}
        {!demandas.length && (
          <div className="flex flex-col items-center gap-2 px-5 py-12 text-center">
            <SearchX className="size-6 text-verde" />
            <p className="text-[0.95rem] text-texto-2">Nenhuma demanda neste filtro.</p>
          </div>
        )}
      </div>
    </div>
  );
}
