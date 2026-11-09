"use client";

/**
 * Barra de ferramentas do mapa (mockup desktop). Medir área e distância
 * usam a geodésia do turf — o número precisa bater com o que o corretor
 * mediria em campo, não com pixels de tela.
 *
 * "Consultar área" (roadmap 5.6) usa o mesmo desenho da medição de área: o
 * polígono fechado vai para POST /api/consulta/area e a consulta abre em
 * /consulta/area/<chave>. Vale para qualquer ponto do Brasil.
 */

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Map as MLMap, MapMouseEvent, GeoJSONSource } from "maplibre-gl";
import type { RecursoId } from "@/lib/planos";
import { ArrowRight, Camera, Lock, MoveHorizontal, Printer, ScanSearch, Triangle, Upload, X } from "lucide-react";
import { abrirAssistente } from "@/components/ia/ChatIA";
import MarcaArini from "@/components/marca/MarcaArini";
import { VIDRO, BotaoFechar } from "@/components/map/UiMapa";

type Modo = null | "area" | "distancia" | "consulta";

/** Teto da área desenhada para consulta — o mesmo do servidor (src/lib/geo/consultaArea.ts). */
const CONSULTA_MAX_HA = 50_000;

export default function Ferramentas({
  mapa, onImportarKml, onCapturar, recursos, logado = false, onDesenhando,
}: {
  mapa: MLMap | null;
  /** avisa o mapa que um desenho está em curso (o clique não deve abrir cartão de lote/CAR) */
  onDesenhando?: (ativo: boolean) => void;
  onImportarKml: (arquivo: File) => void;
  onCapturar: () => void;
  /** recursos do plano de quem está olhando (planos por nicho); ausente = tudo liberado */
  recursos?: string[];
  logado?: boolean;
}) {
  const [modo, setModo] = useState<Modo>(null);
  const [resultado, setResultado] = useState<string>("");
  const [bloqueio, setBloqueio] = useState<string>("");
  const router = useRouter();
  // área desenhada para consulta, já fechada (duplo clique), esperando o "Consultar"
  const [consultaPronta, setConsultaPronta] = useState<{ pontos: [number, number][]; ha: number } | null>(null);
  const [consultando, setConsultando] = useState(false);
  const [erroConsulta, setErroConsulta] = useState<{ msg: string; planos: boolean } | null>(null);
  const liberado = (r: RecursoId) => !recursos || recursos.includes(r);
  const pontosRef = useRef<[number, number][]>([]);
  const modoRef = useRef<Modo>(null);
  modoRef.current = modo;

  // durante o desenho o duplo clique encerra o polígono — não pode dar zoom
  useEffect(() => {
    if (!mapa) return;
    if (modo) mapa.doubleClickZoom.disable();
    else mapa.doubleClickZoom.enable();
    onDesenhando?.(!!modo);
  }, [mapa, modo, onDesenhando]);

  // fonte/camadas da medição. Criadas na hora do primeiro desenho se ainda não
  // existirem (a ferramenta pode abrir antes do "load" do mapa) e sempre trazidas
  // para o topo: a troca de base e o "Imagem do ano" adicionam camadas raster
  // depois, que cobriam o desenho com o satélite ligado.
  const CAMADAS_MEDICAO = ["medicao-area", "medicao-linha", "medicao-pontos"];
  const garantirCamadas = () => {
    if (!mapa?.style) return false;
    if (!mapa.getSource("medicao")) {
      mapa.addSource("medicao", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      mapa.addLayer({
        id: "medicao-area", type: "fill", source: "medicao",
        filter: ["==", ["geometry-type"], "Polygon"],
        paint: { "fill-color": "#D9BD6F", "fill-opacity": 0.22 },
      });
      mapa.addLayer({
        id: "medicao-linha", type: "line", source: "medicao",
        filter: ["!=", ["geometry-type"], "Point"],
        paint: { "line-color": "#D9BD6F", "line-width": 2.5, "line-dasharray": [2, 1] },
      });
      mapa.addLayer({
        id: "medicao-pontos", type: "circle", source: "medicao",
        filter: ["==", ["geometry-type"], "Point"],
        paint: { "circle-color": "#F2F2EC", "circle-radius": 4.5, "circle-stroke-color": "#D9BD6F", "circle-stroke-width": 2 },
      });
    } else {
      for (const id of CAMADAS_MEDICAO) if (mapa.getLayer(id)) mapa.moveLayer(id);
    }
    return true;
  };

  useEffect(() => {
    if (!mapa) return;
    const preparar = () => { try { garantirCamadas(); } catch { /* estilo ainda carregando: o desenho cria depois */ } };
    if (mapa.loaded()) preparar();
    else mapa.once("load", preparar);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapa]);

  const desenhar = (pontos: [number, number][], fechar: boolean) => {
    if (!garantirCamadas()) return;
    const src = mapa?.getSource("medicao") as GeoJSONSource | undefined;
    if (!src) return;
    const features: GeoJSON.Feature[] = pontos.map((p) => ({
      type: "Feature", geometry: { type: "Point", coordinates: p }, properties: {},
    }));
    if (pontos.length >= 2) {
      features.push({
        type: "Feature",
        geometry: fechar && pontos.length >= 3
          ? { type: "Polygon", coordinates: [[...pontos, pontos[0]]] }
          : { type: "LineString", coordinates: pontos },
        properties: {},
      });
    }
    src.setData({ type: "FeatureCollection", features });
  };

  const calcular = async (pontos: [number, number][], tipo: Modo) => {
    if (!tipo || pontos.length < 2) return;
    const turf = await import("@turf/turf");
    if (tipo === "distancia") {
      let total = 0;
      for (let i = 1; i < pontos.length; i++) {
        total += turf.distance(turf.point(pontos[i - 1]), turf.point(pontos[i]), { units: "kilometers" });
      }
      setResultado(
        total < 1
          ? `${(total * 1000).toLocaleString("pt-BR", { maximumFractionDigits: 0 })} m`
          : `${total.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} km`
      );
    } else if (pontos.length >= 3) {
      const poligono = turf.polygon([[...pontos, pontos[0]]]);
      if (tipo === "consulta") {
        const ha = turf.area(poligono) / 10000;
        setResultado(`${ha.toLocaleString("pt-BR", { maximumFractionDigits: ha < 10 ? 2 : 0 })} ha`);
        return;
      }
      const m2 = turf.area(poligono);
      const ha = m2 / 10000;
      setResultado(
        ha < 1
          ? `${m2.toLocaleString("pt-BR", { maximumFractionDigits: 0 })} m²`
          : `${ha.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} ha (${(ha / 4.84).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} alq.)`
      );
    }
  };

  // clique adiciona vértice; duplo clique encerra a medição
  useEffect(() => {
    if (!mapa) return;
    const aoClicar = (e: MapMouseEvent) => {
      if (!modoRef.current) return;
      const p: [number, number] = [e.lngLat.lng, e.lngLat.lat];
      // o duplo clique chega antes como dois cliques no mesmo lugar: não duplica o vértice
      const ult = pontosRef.current[pontosRef.current.length - 1];
      if (ult && Math.abs(ult[0] - p[0]) < 1e-7 && Math.abs(ult[1] - p[1]) < 1e-7) return;
      pontosRef.current = [...pontosRef.current, p];
      desenhar(pontosRef.current, modoRef.current !== "distancia");
      calcular(pontosRef.current, modoRef.current);
    };
    const aoDuploClique = async () => {
      if (!modoRef.current) return;
      if (modoRef.current === "consulta" && pontosRef.current.length >= 3) {
        const turf = await import("@turf/turf");
        const pts = pontosRef.current;
        setConsultaPronta({ pontos: pts, ha: turf.area(turf.polygon([[...pts, pts[0]]])) / 10000 });
      }
      setModo(null);
      if (mapa) mapa.getCanvas().style.cursor = "";
    };
    mapa.on("click", aoClicar);
    mapa.on("dblclick", aoDuploClique);
    return () => {
      mapa.off("click", aoClicar);
      mapa.off("dblclick", aoDuploClique);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapa]);

  const iniciar = (novo: Modo) => {
    pontosRef.current = [];
    setResultado("");
    setConsultaPronta(null);
    setErroConsulta(null);
    desenhar([], false);
    const proximo = modo === novo ? null : novo;
    setModo(proximo);
    if (mapa) mapa.getCanvas().style.cursor = proximo ? "crosshair" : "";
  };

  const limpar = () => {
    pontosRef.current = [];
    setResultado("");
    setConsultaPronta(null);
    setErroConsulta(null);
    desenhar([], false);
    setModo(null);
    if (mapa) mapa.getCanvas().style.cursor = "";
  };

  const consultar = async () => {
    if (!consultaPronta) return;
    setConsultando(true); setErroConsulta(null);
    const anel = [...consultaPronta.pontos, consultaPronta.pontos[0]];
    // 503 `consulta_na_fila` (muita gente consultando): mostra a posição e tenta
    // de novo sozinho, como o BotaoConsultarArea — a volta da fila não gasta cota
    let r: Response | null = null;
    let data: { chave?: unknown; error?: string; solucao?: string; codigo?: string; tentar_em?: number } = {};
    for (let volta = 0; volta <= 12; volta++) {
      r = await fetch("/api/consulta/area", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ geometria: { type: "Polygon", coordinates: [anel] } }),
      }).catch(() => null);
      data = r ? await r.json().catch(() => ({})) : {};
      if (data.codigo !== "consulta_na_fila" || volta === 12) break;
      setErroConsulta({ msg: [data.error, data.solucao].filter(Boolean).join(" "), planos: false });
      await new Promise((ok) => setTimeout(ok, (Number(data.tentar_em) || 10) * 1000));
    }
    setConsultando(false);
    if (!r?.ok || typeof data.chave !== "string") {
      setErroConsulta({
        msg: [data.error ?? "Não foi possível consultar agora.", data.solucao].filter(Boolean).join(" "),
        planos: data.codigo === "sem_plano" || data.codigo === "cota_esgotada",
      });
      return;
    }
    router.push(`/consulta/area/${data.chave.replace(/^geo:/, "")}`);
  };

  // cada ferramenta pertence a um recurso do plano (src/lib/planos.ts); a trava
  // de verdade é no servidor — aqui o botão só avisa e aponta para os planos
  const FERRAMENTAS = [
    { id: "area", icone: Triangle, rotulo: "Medir Área", recurso: "ferramenta_medir", acao: () => iniciar("area") },
    { id: "distancia", icone: MoveHorizontal, rotulo: "Medir Distância", recurso: "ferramenta_medir", acao: () => iniciar("distancia") },
    { id: "consulta", icone: ScanSearch, rotulo: "Consultar Área", recurso: "consulta_area", acao: () => iniciar("consulta") },
    { id: "kml", icone: Upload, rotulo: "Importar KML", recurso: "ferramenta_kml", acao: null },
    { id: "imprimir", icone: Printer, rotulo: "Imprimir", recurso: "ferramenta_exportar", acao: () => window.print() },
    { id: "captura", icone: Camera, rotulo: "Capturar Imagem", recurso: "ferramenta_exportar", acao: onCapturar },
  ] as const;

  const avisarBloqueio = (rotulo: string) =>
    setBloqueio(logado
      ? `“${rotulo}” faz parte da consulta profissional e não está no seu plano.`
      : `Entre na sua conta para usar “${rotulo}”.`);

  // atalho /mapa?ferramenta=consulta (vem de "Ver relatórios territoriais"):
  // abre o mapa já com o desenho da consulta ligado, uma vez só
  const atalhoFeito = useRef(false);
  useEffect(() => {
    if (!mapa || atalhoFeito.current) return;
    if (new URLSearchParams(window.location.search).get("ferramenta") !== "consulta") return;
    atalhoFeito.current = true;
    setTimeout(() => {
      if (liberado("consulta_area")) iniciar("consulta");
      else avisarBloqueio("Consultar Área");
    }, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapa]);

  const botaoLimpar = (
    <button onClick={limpar}
      className="inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-semibold text-texto-2 transition hover:bg-superficie-2 hover:text-texto">
      <X className="size-3.5" /> limpar
    </button>
  );

  return (
    <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-10 w-[min(92%,760px)] space-y-2">
      {bloqueio && (
        <div className={`flex items-center gap-3 px-4 py-3 text-sm ${VIDRO}`}>
          <Lock className="size-4 shrink-0 text-ouro" />
          <span className="text-texto-3 flex-1">{bloqueio}</span>
          <Link href={logado ? "/planos" : "/entrar"} className="inline-flex items-center gap-1 font-semibold text-verde whitespace-nowrap hover:underline">
            {logado ? "Ver planos" : "Entrar"} <ArrowRight className="size-3.5" />
          </Link>
          <BotaoFechar onClick={() => setBloqueio("")} />
        </div>
      )}
      {consultaPronta && !modo && (
        <div className={`px-4 py-3 text-sm space-y-2 ${VIDRO}`}>
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-texto-2">Área desenhada</span>
            <span className="lp-display text-2xl text-verde tabular-nums">
              {consultaPronta.ha.toLocaleString("pt-BR", { maximumFractionDigits: consultaPronta.ha < 10 ? 2 : 0 })} ha
            </span>
            {consultaPronta.ha > CONSULTA_MAX_HA ? (
              <span className="text-alerta text-xs">Máximo de {CONSULTA_MAX_HA.toLocaleString("pt-BR")} ha por consulta.</span>
            ) : (
              <button onClick={consultar} disabled={consultando} className="btn-verde ml-auto inline-flex items-center gap-1.5 px-4 py-2 text-xs disabled:opacity-60">
                <ScanSearch className="size-4" />
                {consultando ? "Consultando os órgãos…" : "Consultar fontes oficiais"}
              </button>
            )}
            {botaoLimpar}
          </div>
          {erroConsulta && (
            <p className="text-xs text-alerta">
              {erroConsulta.msg}{erroConsulta.planos && <> <Link href="/planos" className="text-verde underline">Ver planos</Link></>}
            </p>
          )}
          <p className="text-[11px] text-texto-2">Leva de 10 a 40 segundos e conta uma consulta do seu plano.</p>
        </div>
      )}
      {(modo || (resultado && !consultaPronta)) && (
        <div className={`flex items-center gap-3 px-4 py-3 text-sm ${VIDRO}`}>
          <span className="text-texto-3">
            {modo === "area" ? "Clique nos vértices; duplo clique encerra."
              : modo === "distancia" ? "Clique nos pontos; duplo clique encerra."
              : modo === "consulta" ? "Desenhe a área a consultar (qualquer lugar do Brasil); duplo clique fecha."
              : "Medição"}
          </span>
          {resultado && <span className="ml-auto lp-display text-2xl text-verde tabular-nums">{resultado}</span>}
          {botaoLimpar}
        </div>
      )}

      <div className={`px-2.5 py-2 ${VIDRO}`}>
        <p className="lp-eyebrow !text-[10px] !tracking-[0.2em] !text-ouro px-2 pt-0.5 mb-2">Ferramentas</p>
        <div className="flex items-center justify-between gap-1 overflow-x-auto">
          {FERRAMENTAS.map((f) => {
            const ativo = modo === f.id;
            const pode = liberado(f.recurso);
            const Icone = pode ? f.icone : Lock;
            const classe =
              "flex flex-col items-center gap-1.5 rounded-full px-3 py-2 min-w-[76px] text-[11px] font-medium transition " +
              (ativo ? "bg-verde/15 text-verde ring-1 ring-verde/40" : "text-texto-2 hover:text-texto hover:bg-superficie-2") +
              (pode ? "" : " opacity-60");
            const miolo = <><Icone className="size-[18px]" strokeWidth={1.9} />{f.rotulo}</>;
            if (!pode) {
              return (
                <button key={f.id} onClick={() => avisarBloqueio(f.rotulo)} className={classe}
                  title="Disponível na consulta profissional">
                  {miolo}
                </button>
              );
            }
            if (f.id === "kml") {
              return (
                <label key={f.id} className={classe + " cursor-pointer"}>
                  {miolo}
                  <input type="file" accept=".kml,.kmz" className="hidden"
                    onChange={(e) => e.target.files?.[0] && onImportarKml(e.target.files[0])} />
                </label>
              );
            }
            return (
              <button key={f.id} onClick={f.acao ?? undefined} className={classe}>
                {miolo}
              </button>
            );
          })}
          {/* assistente de IA: no mapa fica aqui, não flutuando sobre a escala */}
          <span className="mx-1 h-10 w-px shrink-0 bg-linha" aria-hidden />
          <button onClick={abrirAssistente} title="Pergunte à Ari, a assistente de IA da Arini"
            className="flex shrink-0 items-center gap-2 rounded-full bg-[#124431] py-1.5 pl-1.5 pr-4 text-left text-[#F2F2EC] ring-2 ring-[#D9BD6F]/70 transition hover:ring-[#D9BD6F]">
            <span className="relative grid size-9 place-items-center rounded-full bg-[#0B2A1E]" aria-hidden>
              <span className="absolute inset-0 animate-ping rounded-full bg-[#D9BD6F]/25 motion-reduce:hidden" />
              <MarcaArini variante="radar" titulo="" className="relative size-5" />
            </span>
            <span className="leading-tight">
              <span className="block text-sm font-bold">Ari</span>
              <span className="block text-[10px] text-[#F2F2EC]/70 whitespace-nowrap">pergunte à IA</span>
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
