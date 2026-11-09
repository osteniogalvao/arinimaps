"use client";

import { useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Map as IconeMapa, LayoutGrid, Search, X, Lock, BadgeCheck, Unlock, Calculator,
  Handshake, History, AlertTriangle,
} from "lucide-react";
import { CAMPO, ROTULO, Etiqueta } from "@/components/ui/Pagina";
import { AvisoErro } from "@/components/ui/Aviso";
import { enviarJson, type ErroApi } from "@/lib/api/enviar";
import { ETAPA_LABEL } from "@/lib/funil";
import { lerNumeroBR } from "@/lib/simulador";
import {
  COR_ESPELHO, STATUS_ESPELHO, STATUS_ESPELHO_LABEL, compararLote, rotuloLote, totaisDoEspelho,
  type StatusEspelho, type UnidadeEspelho,
} from "@/lib/empreendimento/tipos";
import SimuladorProposta from "./SimuladorProposta";

const MapaEspelho = dynamic(() => import("./MapaEspelho"), {
  ssr: false,
  loading: () => <div className="grid h-[420px] place-items-center rounded-2xl border border-linha bg-superficie-2 text-sm text-texto-2">Carregando mapa…</div>,
});

type Props = {
  empreendimento: { id: string; codigo: string; titulo: string; municipio: string | null };
  unidades: UnidadeEspelho[];
  geometrias: GeoJSON.FeatureCollection;
  /** false = migration 0061 ainda não aplicada: só leitura */
  ativo: boolean;
  /** "/painel" ou "/admin": onde abrir a negociação */
  base: "/painel" | "/admin";
  hoje: string;
  anunciante: string | null;
};

const TOM: Record<StatusEspelho, "verde" | "ouro" | "neutro"> = { disponivel: "verde", reservado: "ouro", vendido: "neutro" };
const brl = (v: number | null | undefined) =>
  v == null ? "—" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const quando = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" }) : "—";
const dia = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "—";

/**
 * Espelho de vendas do loteamento (segunda etapa, item 10): mapa e grade de
 * quadras com cada lote na cor da situação, totais e VGV. Tocar no lote abre o
 * painel com dados, cliente, negociação e as ações (reservar com prazo,
 * vender, liberar, abrir no simulador). No celular o painel sobe de baixo.
 */
export default function EspelhoVendas(props: Props) {
  const { unidades, ativo, base, hoje } = props;
  const router = useRouter();
  const [vista, setVista] = useState<"mapa" | "grade">("grade");
  const [filtro, setFiltro] = useState<StatusEspelho | "todos">("todos");
  const [busca, setBusca] = useState("");
  const [selId, setSelId] = useState<string | null>(null);
  const [simId, setSimId] = useState<string | null>(null);
  const simRef = useRef<HTMLDivElement>(null);

  const totais = useMemo(() => totaisDoEspelho(unidades), [unidades]);
  const sel = unidades.find((u) => u.id === selId) ?? null;
  const simUnidade = unidades.find((u) => u.id === simId) ?? null;

  const visiveis = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return unidades.filter((u) => (filtro === "todos" || u.status === filtro) && (!q
      || [u.codigo, u.titulo, u.quadra, u.numero, u.cliente_nome].some((t) => t?.toLowerCase().includes(q))));
  }, [unidades, filtro, busca]);

  const quadras = useMemo(() => {
    const m = new Map<string, UnidadeEspelho[]>();
    for (const u of [...visiveis].sort(compararLote)) {
      const k = u.quadra ?? "Sem quadra";
      m.set(k, [...(m.get(k) ?? []), u]);
    }
    return [...m.entries()];
  }, [visiveis]);

  // o mapa mostra só o que passa no filtro: o resto fica apagado
  const cores = useMemo(() => {
    const ids = new Set(visiveis.map((u) => u.id));
    return Object.fromEntries(unidades.map((u) => [u.id, ids.has(u.id) ? COR_ESPELHO[u.status] : "#3A463F"]));
  }, [unidades, visiveis]);
  const rotulos = useMemo(() => Object.fromEntries(unidades.map((u) => [u.id, u.numero ?? ""])), [unidades]);

  function abrirSimulador(u: UnidadeEspelho) {
    setSimId(u.id);
    setSelId(null);
    setTimeout(() => simRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  }

  return (
    <div className="space-y-6">
      {!ativo && (
        <p className="flex items-start gap-3 rounded-2xl border border-alerta/40 bg-alerta/10 px-5 py-4 text-base text-alerta">
          <AlertTriangle className="mt-0.5 size-5 shrink-0" />
          O espelho está em modo de leitura: as reservas e vendas ficam disponíveis assim que a atualização do banco for aplicada.
        </p>
      )}

      {/* totais + legenda */}
      <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {STATUS_ESPELHO.map((s) => (
          <button key={s} type="button" onClick={() => setFiltro(filtro === s ? "todos" : s)}
            aria-pressed={filtro === s}
            className={`cartao flex items-center gap-3 p-4 text-left transition-colors ${filtro === s ? "!border-verde" : ""}`}>
            <span className="size-4 shrink-0 rounded-[5px] border border-linha-forte" style={{ background: COR_ESPELHO[s] }} aria-hidden />
            <span className="min-w-0">
              <dt className="text-xs font-semibold uppercase tracking-wide text-texto-2">{STATUS_ESPELHO_LABEL[s]}s</dt>
              <dd className="lp-display text-3xl leading-tight text-texto tabular-nums">{totais[s]}</dd>
            </span>
          </button>
        ))}
        <div className="cartao p-4">
          <dt className="text-xs font-semibold uppercase tracking-wide text-texto-2">VGV ({totais.unidades} lotes)</dt>
          <dd className="lp-display text-2xl leading-tight text-texto tabular-nums">{brl(totais.vgv)}</dd>
          <dd className="mt-1 text-xs text-texto-2 tabular-nums">vendido {brl(totais.vgvVendido)} · em estoque {brl(totais.vgvDisponivel)}</dd>
        </div>
      </dl>

      {/* barra: vista + busca */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-xl border border-linha bg-superficie-2 p-1" role="tablist" aria-label="Vista do espelho">
          {([["grade", "Quadras", LayoutGrid], ["mapa", "Mapa", IconeMapa]] as const).map(([v, r, I]) => (
            <button key={v} type="button" role="tab" aria-selected={vista === v} onClick={() => setVista(v)}
              className={`inline-flex min-h-11 items-center gap-2 rounded-lg px-4 text-sm font-semibold transition-colors ${vista === v ? "bg-superficie text-texto shadow-sm" : "text-texto-2 hover:text-texto"}`}>
              <I className="size-4" /> {r}
            </button>
          ))}
        </div>
        <label className="relative min-w-0 flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-texto-2" />
          <input className={`${CAMPO} !pl-10`} placeholder="Quadra, lote ou cliente" value={busca} onChange={(e) => setBusca(e.target.value)} aria-label="Buscar lote" />
        </label>
        {filtro !== "todos" && (
          <button type="button" onClick={() => setFiltro("todos")} className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-verde">
            <X className="size-4" /> limpar filtro
          </button>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start">
        <div className="min-w-0">
          {vista === "mapa" ? (
            props.geometrias.features.length ? (
              <MapaEspelho geometrias={props.geometrias} cores={cores} rotulos={rotulos} selecionado={selId} onSelecionar={setSelId}
                className="h-[60vh] min-h-[360px] w-full overflow-hidden rounded-2xl border border-linha" />
            ) : (
              <p className="cartao p-6 text-base text-texto-2">As unidades deste empreendimento ainda não têm divisa no mapa. Use a vista de quadras.</p>
            )
          ) : (
            <div className="space-y-5">
              {quadras.map(([q, lotes]) => (
                <section key={q} className="cartao p-4 md:p-5">
                  <h3 className="mb-3 flex items-baseline gap-2 text-base font-semibold text-texto">
                    {q === "Sem quadra" ? q : `Quadra ${q}`}
                    <span className="text-xs font-normal text-texto-2">{lotes.length} lote{lotes.length === 1 ? "" : "s"}</span>
                  </h3>
                  <ul className="grid grid-cols-[repeat(auto-fill,minmax(64px,1fr))] gap-2">
                    {lotes.map((u) => (
                      <li key={u.id}>
                        <button type="button" onClick={() => setSelId(u.id)}
                          aria-label={`${rotuloLote(u)}: ${STATUS_ESPELHO_LABEL[u.status]}`}
                          className={`flex h-14 w-full flex-col items-center justify-center rounded-xl border-2 text-sm font-semibold tabular-nums text-[#10241B] transition-transform active:scale-95 ${selId === u.id ? "border-ouro ring-2 ring-ouro/40" : "border-transparent"}`}
                          style={{ background: COR_ESPELHO[u.status] }}>
                          {u.numero ?? u.codigo.slice(-4)}
                          {u.status === "reservado" && <Lock className="size-3 opacity-70" aria-hidden />}
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
              {!quadras.length && <p className="cartao p-6 text-base text-texto-2">Nenhum lote com esse filtro.</p>}
            </div>
          )}
        </div>

        {/* painel do lote: coluna fixa no computador, folha de baixo no celular */}
        {sel ? (
          <>
            <button type="button" aria-label="Fechar" onClick={() => setSelId(null)} className="fixed inset-0 z-40 bg-black/40 lg:hidden" />
            <aside className="fixed inset-x-0 bottom-0 z-50 max-h-[85vh] overflow-y-auto rounded-t-3xl border-t border-linha bg-superficie p-5 pb-8 shadow-2xl lg:sticky lg:top-24 lg:z-auto lg:max-h-[calc(100vh-7rem)] lg:rounded-2xl lg:border lg:pb-5 lg:shadow-none">
              <PainelLote key={sel.id} u={sel} ativo={ativo} base={base} hoje={hoje} empId={props.empreendimento.id}
                onFechar={() => setSelId(null)} onSimular={() => abrirSimulador(sel)} onFeito={() => router.refresh()} />
            </aside>
          </>
        ) : (
          <aside className="hidden cartao p-5 text-base text-texto-2 lg:block">
            Toque num lote, no mapa ou na grade, para ver dados, cliente e negociação, e para reservar, vender ou liberar.
          </aside>
        )}
      </div>

      {simUnidade && (
        <div ref={simRef} className="space-y-3 scroll-mt-24">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-texto-2">
              Simulação do lote <strong className="text-texto">{rotuloLote(simUnidade)}</strong>
              {negociacaoDo(simUnidade) ? <> · negociação {negociacaoDo(simUnidade)!.codigo}</> : " · sem negociação ligada"}
            </p>
            <button type="button" onClick={() => setSimId(null)} className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-verde">
              <X className="size-4" /> fechar
            </button>
          </div>
          <SimuladorProposta key={simUnidade.id}
            oportunidadeId={negociacaoDo(simUnidade)?.id ?? null}
            imovel={{ codigo: simUnidade.codigo, titulo: simUnidade.titulo }}
            valorTabela={simUnidade.valor}
            cliente={simUnidade.cliente_nome ?? negociacaoDo(simUnidade)?.cliente ?? null}
            anunciante={props.anunciante}
            hoje={hoje}
            ladoPadrao="vendedor" />
        </div>
      )}
    </div>
  );
}

/** Negociação ligada: a escolhida na reserva/venda, senão a mais recente ainda viva. */
function negociacaoDo(u: UnidadeEspelho) {
  return u.oportunidades.find((o) => o.id === u.opportunity_id)
    ?? u.oportunidades.find((o) => o.etapa !== "perdido") ?? null;
}

function PainelLote({ u, ativo, base, hoje, empId, onFechar, onSimular, onFeito }: {
  u: UnidadeEspelho; ativo: boolean; base: string; hoje: string; empId: string;
  onFechar: () => void; onSimular: () => void; onFeito: () => void;
}) {
  const [acao, setAcao] = useState<"reservar" | "vender" | "liberar" | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<ErroApi | null>(null);
  const neg = negociacaoDo(u);
  const [form, setForm] = useState({
    reserva_ate: hoje,
    cliente_nome: u.cliente_nome ?? neg?.cliente ?? "",
    opportunity_id: u.opportunity_id ?? neg?.id ?? "",
    valor_venda: "",
    observacao: "",
  });

  function abrir(a: "reservar" | "vender" | "liberar") {
    setErro(null);
    setAcao(a);
    // prazo padrão da reserva: 7 dias
    if (a === "reservar") {
      const d = new Date(`${hoje}T12:00:00Z`);
      d.setUTCDate(d.getUTCDate() + 7);
      setForm((f) => ({ ...f, reserva_ate: d.toISOString().slice(0, 10) }));
    }
  }

  async function confirmar() {
    if (!acao) return;
    setOcupado(true);
    setErro(null);
    const valor = lerNumeroBR(form.valor_venda);
    const r = await enviarJson(`/api/empreendimentos/${empId}/espelho`, "POST", {
      unidade_id: u.id, acao,
      reserva_ate: form.reserva_ate, cliente_nome: form.cliente_nome,
      opportunity_id: form.opportunity_id || null,
      valor_venda: Number.isFinite(valor) ? valor : null,
      observacao: form.observacao,
    });
    setOcupado(false);
    if (!r.ok) { setErro(r.erro); return; }
    setAcao(null);
    onFeito();
  }

  const pode = (s: StatusEspelho[]) => ativo && s.includes(u.status);
  const botao = "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border px-4 text-sm font-semibold transition-colors disabled:opacity-50";

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-xs text-texto-2">{u.codigo}</p>
          <h3 className="lp-display mt-1 text-2xl text-texto">{rotuloLote(u)}</h3>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Etiqueta tom={TOM[u.status]}>{STATUS_ESPELHO_LABEL[u.status]}</Etiqueta>
            {u.status === "reservado" && u.reserva_ate && <span className="text-xs text-texto-2">até {dia(u.reserva_ate)}</span>}
          </div>
        </div>
        <button type="button" onClick={onFechar} aria-label="Fechar painel" className="grid size-11 shrink-0 place-items-center rounded-xl text-texto-2 hover:bg-superficie-2">
          <X className="size-5" />
        </button>
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
        <Dado r="Preço de tabela" v={brl(u.valor)} />
        <Dado r="Área" v={u.area_m2 ? `${Math.round(u.area_m2).toLocaleString("pt-BR")} m²` : "—"} />
        {u.cliente_nome && <Dado r={u.status === "vendido" ? "Comprador" : "Cliente"} v={u.cliente_nome} />}
        {u.valor_venda != null && <Dado r="Valor de venda" v={brl(u.valor_venda)} />}
        {u.alterado_em && <Dado r="Última mudança" v={`${quando(u.alterado_em)}${u.alterado_por ? ` · ${u.alterado_por}` : ""}`} largo />}
        {u.observacao && <Dado r="Observação" v={u.observacao} largo />}
      </dl>

      <div className="space-y-2">
        <p className="flex items-center gap-2 text-sm font-semibold text-texto"><Handshake className="size-4" /> Negociação</p>
        {u.oportunidades.length ? (
          <ul className="space-y-1.5">
            {u.oportunidades.slice(0, 4).map((o) => (
              <li key={o.id}>
                <Link href={`${base}/oportunidades/${o.id}`} className="flex flex-wrap items-center gap-2 rounded-xl bg-superficie-2 px-3 py-2.5 text-sm hover:text-verde">
                  <span className="font-mono text-xs">{o.codigo}</span>
                  <span className="flex-1 truncate">{o.cliente ?? "—"}</span>
                  <Etiqueta tom={o.etapa === "perdido" ? "critico" : "ouro"}>{ETAPA_LABEL[o.etapa] ?? o.etapa}</Etiqueta>
                </Link>
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-texto-2">Nenhuma negociação neste lote.</p>}
      </div>

      {/* ações */}
      <div className="grid grid-cols-2 gap-2">
        <button type="button" disabled={!pode(["disponivel", "reservado"])} onClick={() => abrir("reservar")}
          className={`${botao} border-ouro/50 text-texto hover:bg-ouro/15`}>
          <Lock className="size-4" /> {u.status === "reservado" ? "Renovar" : "Reservar"}
        </button>
        <button type="button" disabled={!pode(["disponivel", "reservado"])} onClick={() => abrir("vender")}
          className={`${botao} border-verde/50 text-texto hover:bg-verde/15`}>
          <BadgeCheck className="size-4" /> Vender
        </button>
        <button type="button" disabled={!pode(["reservado", "vendido"])} onClick={() => abrir("liberar")}
          className={`${botao} border-linha-forte text-texto hover:bg-superficie-2`}>
          <Unlock className="size-4" /> Liberar
        </button>
        <button type="button" onClick={onSimular} className={`${botao} border-linha-forte text-texto hover:bg-superficie-2`}>
          <Calculator className="size-4" /> Simulador
        </button>
      </div>

      {acao && (
        <div className="space-y-3 rounded-2xl border border-linha bg-superficie-2 p-4">
          <p className="text-sm font-semibold text-texto">
            {acao === "reservar" ? "Reservar lote" : acao === "vender" ? "Registrar venda do lote" : "Liberar lote (volta a disponível)"}
          </p>
          {acao === "reservar" && (
            <label className="block"><span className={ROTULO}>Reservado até</span>
              <input type="date" className={CAMPO} min={hoje} value={form.reserva_ate} onChange={(e) => setForm({ ...form, reserva_ate: e.target.value })} />
            </label>
          )}
          {acao !== "liberar" && (
            <>
              <label className="block"><span className={ROTULO}>{acao === "vender" ? "Comprador" : "Cliente"}</span>
                <input className={CAMPO} maxLength={160} value={form.cliente_nome} onChange={(e) => setForm({ ...form, cliente_nome: e.target.value })} />
              </label>
              {!!u.oportunidades.length && (
                <label className="block"><span className={ROTULO}>Negociação ligada</span>
                  <select className={CAMPO} value={form.opportunity_id} onChange={(e) => setForm({ ...form, opportunity_id: e.target.value })}>
                    <option value="">Nenhuma</option>
                    {u.oportunidades.map((o) => <option key={o.id} value={o.id}>{o.codigo} · {o.cliente ?? "—"}</option>)}
                  </select>
                </label>
              )}
            </>
          )}
          {acao === "vender" && (
            <label className="block"><span className={ROTULO}>Valor de venda (R$, opcional)</span>
              <input className={CAMPO} inputMode="decimal" placeholder={u.valor ? u.valor.toLocaleString("pt-BR") : ""} value={form.valor_venda} onChange={(e) => setForm({ ...form, valor_venda: e.target.value })} />
            </label>
          )}
          <label className="block"><span className={ROTULO}>Observação</span>
            <input className={CAMPO} maxLength={500} value={form.observacao} onChange={(e) => setForm({ ...form, observacao: e.target.value })} />
          </label>
          {erro && <AvisoErro erro={erro} aoFechar={() => setErro(null)} />}
          <div className="flex gap-2">
            <button type="button" disabled={ocupado} onClick={confirmar} className="lp-btn lp-btn-verde !px-5 !py-3 text-[0.95rem] disabled:opacity-50">
              {ocupado ? "Salvando…" : "Confirmar"}
            </button>
            <button type="button" onClick={() => setAcao(null)} className="lp-btn lp-btn-contorno !px-5 !py-3 text-[0.95rem]">Cancelar</button>
          </div>
        </div>
      )}

      {!!u.eventos.length && (
        <div className="space-y-2">
          <p className="flex items-center gap-2 text-sm font-semibold text-texto"><History className="size-4" /> Histórico</p>
          <ol className="space-y-1.5 text-sm">
            {u.eventos.map((e) => (
              <li key={e.id} className="text-texto-2">
                <span className="tabular-nums">{quando(e.created_at)}</span> · {e.de ? `${STATUS_ESPELHO_LABEL[e.de as StatusEspelho] ?? e.de} → ` : ""}
                <strong className="text-texto">{STATUS_ESPELHO_LABEL[e.para]}</strong>
                {e.para === "reservado" && e.reserva_ate ? ` até ${dia(e.reserva_ate)}` : ""}
                {` · ${e.autor ?? "sistema"}`}{e.motivo ? ` · ${e.motivo}` : ""}
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

function Dado({ r, v, largo = false }: { r: string; v: string; largo?: boolean }) {
  return (
    <div className={largo ? "col-span-2" : undefined}>
      <dt className="text-xs text-texto-2">{r}</dt>
      <dd className="font-semibold text-texto">{v}</dd>
    </div>
  );
}
