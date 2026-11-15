"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { ArrowRight, LayoutGrid, Map as IconeMapa, X } from "lucide-react";
import { Etiqueta } from "@/components/ui/Pagina";
import { enviarJson } from "@/lib/api/enviar";
import { COR_ESPELHO, STATUS_ESPELHO, STATUS_ESPELHO_LABEL, compararLote, rotuloLote, type EstoquePublico, type UnidadePublica } from "@/lib/empreendimento/tipos";

const MapaEspelho = dynamic(() => import("./MapaEspelho"), {
  ssr: false,
  loading: () => <div className="grid h-[420px] place-items-center rounded-2xl border border-linha bg-superficie-2 text-sm text-texto-2">Carregando mapa…</div>,
});

const brl = (v: number | null) =>
  v == null ? "Sob consulta" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

export default function EspelhoPublico({ catalogo, geometrias, inicial, id, codigo, logado }: {
  catalogo: UnidadePublica[]; geometrias: GeoJSON.FeatureCollection; inicial: EstoquePublico;
  id: string; codigo: string; logado: boolean;
}) {
  const [estoque, setEstoque] = useState(inicial);
  const url = "/api/empreendimentos/" + id + "/espelho";
  const ultima = useRef(0);
  const [atualizado, setAtualizado] = useState(true);
  const [ocupado, setOcupado] = useState(false);
  const [mensagem, setMensagem] = useState("");
  const emVoo = useRef(false);
  const atualizar = useCallback(async (forcar = false) => {
    if (document.visibilityState !== "visible" || (emVoo.current && !forcar)) return;
    const ordem = ++ultima.current;
    emVoo.current = true;
    try {
      const r = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(8000) });
      if (!r.ok) throw new Error();
      const s: EstoquePublico = await r.json();
      if (ordem === ultima.current) {
        // Mesmo estoque mantém as referências da camada para não redesenhar o mapa a cada leitura.
        setEstoque(anterior => JSON.stringify(anterior) === JSON.stringify(s) ? anterior : s);
        setAtualizado(true);
      }
    } catch { if (ordem === ultima.current) setAtualizado(false); }
    finally { if (ordem === ultima.current) emVoo.current = false; }
  }, [url]);
  useEffect(() => {
    const visivel = () => { void atualizar(); };
    const timer = window.setInterval(visivel, 2500);
    document.addEventListener("visibilitychange", visivel);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", visivel); };
  }, [atualizar]);

  const unidades = useMemo(() => {
    const porId = new Map(estoque.unidades.map((u) => [u.id, u]));
    return catalogo.flatMap((u) => { const e = porId.get(u.id); return e ? [{ ...u, ...e }] : []; });
  }, [catalogo, estoque]);
  const [vista, setVista] = useState<"mapa" | "grade">(geometrias.features.length ? "mapa" : "grade");
  const [selId, setSelId] = useState<string | null>(null);
  const sel = unidades.find((u) => u.id === selId) ?? null;
  async function reservar() {
    if (!sel || ocupado) return;
    setOcupado(true); setMensagem("");
    const r = await enviarJson(url, "POST", {
      unidade_id: sel.id, versao: sel.versao, acao: sel.minha_ate ? "cancelar_minha" : "reserva_online",
    });
    setMensagem(r.ok ? (sel.minha_ate ? "Reserva cancelada." : "Reserva confirmada.") : r.erro.mensagem);
    await atualizar(true);
    setOcupado(false);
  }

  const quadras = useMemo(() => {
    const m = new Map<string, typeof unidades>();
    for (const u of [...unidades].sort(compararLote)) {
      const k = u.quadra ?? "Sem quadra";
      m.set(k, [...(m.get(k) ?? []), u]);
    }
    return [...m.entries()];
  }, [unidades]);
  const cores = useMemo(() => Object.fromEntries(unidades.map((u) => [u.id, COR_ESPELHO[u.status]])), [unidades]);
  const rotulos = useMemo(() => Object.fromEntries(unidades.map((u) => [u.id, u.numero ?? ""])), [unidades]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        {STATUS_ESPELHO.map(s => <span key={s} className="inline-flex items-center gap-2 text-base text-texto">
          <span className="size-4 rounded-[5px]" style={{ background: COR_ESPELHO[s] }} aria-hidden />
          {STATUS_ESPELHO_LABEL[s]} <strong className="tabular-nums">{unidades.filter(u => u.status === s).length}</strong>
        </span>)}
        {!!geometrias.features.length && (
          <div className="ml-auto inline-flex rounded-xl border border-linha bg-superficie-2 p-1" role="tablist" aria-label="Vista">
            {([["mapa", "Mapa", IconeMapa], ["grade", "Quadras", LayoutGrid]] as const).map(([v, r, I]) => (
              <button key={v} type="button" role="tab" aria-selected={vista === v} onClick={() => setVista(v)}
                className={`inline-flex min-h-11 items-center gap-2 rounded-lg px-4 text-sm font-semibold ${vista === v ? "bg-superficie text-texto shadow-sm" : "text-texto-2"}`}>
                <I className="size-4" /> {r}
              </button>
            ))}
          </div>
        )}
      </div>

      {vista === "mapa" ? (
        <MapaEspelho geometrias={geometrias} cores={cores} rotulos={rotulos} selecionado={selId} onSelecionar={setSelId}
          className="h-[60vh] min-h-[360px] w-full overflow-hidden rounded-2xl border border-linha" />
      ) : (
        <div className="space-y-4">
          {quadras.map(([q, lotes]) => (
            <section key={q} className="cartao p-4 md:p-5">
              <h3 className="mb-3 text-base font-semibold text-texto">{q === "Sem quadra" ? q : `Quadra ${q}`}</h3>
              <ul className="grid grid-cols-[repeat(auto-fill,minmax(64px,1fr))] gap-2">
                {lotes.map((u) => (
                  <li key={u.id}>
                    <button type="button" onClick={() => setSelId(u.id)} aria-label={`${rotuloLote(u)}: ${STATUS_ESPELHO_LABEL[u.status]}`}
                      className={`h-14 w-full rounded-xl border-2 text-sm font-semibold tabular-nums text-[#10241B] active:scale-95 ${selId === u.id ? "border-ouro" : "border-transparent"}`}
                      style={{ background: COR_ESPELHO[u.status] }}>
                      {u.numero ?? u.codigo.slice(-4)}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {!atualizado && <p role="status">Reconectando ao estoque…</p>}
      {mensagem && <p role="status">{mensagem}</p>}
      {sel && (
        <div className="cartao flex flex-wrap items-center gap-4 p-5" role="status">
          <div className="min-w-0 flex-1">
            <p className="lp-display text-xl text-texto">{rotuloLote(sel)}</p>
            <p className="mt-1 text-base text-texto-2">
              {sel.area_m2 ? `${Math.round(sel.area_m2).toLocaleString("pt-BR")} m²` : ""}
              {sel.status === "disponivel" ? ` · ${brl(sel.valor)}` : ""}
            </p>
          </div>
          <Etiqueta tom={sel.status === "disponivel" ? "verde" : sel.status === "reservado" ? "ouro" : "neutro"}>{STATUS_ESPELHO_LABEL[sel.status]}</Etiqueta>
          {sel.minha_ate && <p>Sua reserva vence em {new Date(sel.minha_ate).toLocaleString("pt-BR")}.</p>}
          {(sel.minha_ate || (estoque.online && sel.status === "disponivel")) && (logado ? (
            <button type="button" className="lp-btn lp-btn-verde" disabled={ocupado || !atualizado} onClick={reservar}>
              {ocupado ? "Aguarde…" : sel.minha_ate ? "Cancelar minha reserva" : `Reservar por ${estoque.horas} h`}
            </button>
          ) : <Link className="lp-btn lp-btn-verde" href={"/entrar?volta=" + encodeURIComponent("/imovel/" + codigo + "/espelho")}>Entrar para reservar</Link>)}
          {sel.status === "disponivel" && (
            <Link href={`/imovel/${sel.codigo}`} className="lp-btn lp-btn-verde !px-5 !py-3 text-[0.95rem]">Ver lote <ArrowRight /></Link>
          )}
          <button type="button" onClick={() => setSelId(null)} aria-label="Fechar" className="grid size-11 place-items-center rounded-xl text-texto-2 hover:bg-superficie-2">
            <X className="size-5" />
          </button>
        </div>
      )}
    </div>
  );
}
