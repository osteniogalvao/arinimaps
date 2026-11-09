"use client";

import { useEffect, useRef, useState } from "react";
import type { ExpressionSpecification, GeoJSONSource, Map as MLMap } from "maplibre-gl";
import { CENTRO_REGIAO, ESTILO_BASE } from "@/lib/map/config";
import { RADAR_ANEL, STATUS_MAPA } from "./statusMapa";
import { carregarMaplibre } from "@/lib/map/maplibre";

export type ItemMapaBusca = {
  codigo: string;
  titulo: string;
  preco: string;
  status: string;
  leilao: boolean;
  geom: GeoJSON.Polygon | GeoJSON.MultiPolygon | null;
};

const VAZIO: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

/** Divisas, pontos (centro de cada divisa) e o retângulo de todos, a partir da lista. */
function dadosDoMapa(itens: ItemMapaBusca[]) {
  const cor = (i: ItemMapaBusca) => i.leilao ? STATUS_MAPA.leilao : STATUS_MAPA[i.status] ?? STATUS_MAPA.publicado;
  const comDivisa = itens.filter((i) => i.geom);
  const divisas: GeoJSON.FeatureCollection = {
    type: "FeatureCollection",
    features: comDivisa.map((i, n) => ({
      type: "Feature", id: n, geometry: i.geom!, properties: { codigo: i.codigo, cor: cor(i) },
    })),
  };
  const limites: [number, number, number, number] = [180, 90, -180, -90];
  const pontos: GeoJSON.FeatureCollection = {
    type: "FeatureCollection",
    features: comDivisa.map((i, n) => {
      const b: [number, number, number, number] = [180, 90, -180, -90];
      const andar = (c: unknown): void => {
        if (Array.isArray(c) && typeof c[0] === "number") {
          const [x, y] = c as [number, number];
          b[0] = Math.min(b[0], x); b[1] = Math.min(b[1], y); b[2] = Math.max(b[2], x); b[3] = Math.max(b[3], y);
        } else if (Array.isArray(c)) c.forEach(andar);
      };
      andar(i.geom!.coordinates);
      limites[0] = Math.min(limites[0], b[0]); limites[1] = Math.min(limites[1], b[1]);
      limites[2] = Math.max(limites[2], b[2]); limites[3] = Math.max(limites[3], b[3]);
      return {
        type: "Feature", id: n,
        geometry: { type: "Point", coordinates: [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2] },
        properties: { codigo: i.codigo, cor: cor(i), preco: i.preco },
      };
    }),
  };
  return { divisas, pontos, limites, total: comDivisa.length };
}

/**
 * Busca de imóveis com a lista ao lado do mapa (/imoveis?vista=mapa).
 *
 * A lista é renderizada no servidor; este componente só a "escuta": cada
 * cartão tem `data-codigo`. Passar o mouse no cartão acende a divisa no mapa;
 * clicar na divisa rola a lista até o cartão e o destaca. De longe, cada
 * imóvel vira um ponto (a divisa de um lote some em zoom baixo).
 */
export default function MapaBusca({ itens, listaId }: { itens: ItemMapaBusca[]; listaId: string }) {
  const caixa = useRef<HTMLDivElement>(null);
  const mapaRef = useRef<MLMap | null>(null);
  const [pronto, setPronto] = useState(false);
  const acesoRef = useRef<string | null>(null);
  // os ouvintes do mapa nascem uma vez: leem a lista e o id atuais por aqui
  const itensRef = useRef(itens);
  const listaIdRef = useRef(listaId);
  useEffect(() => { itensRef.current = itens; listaIdRef.current = listaId; }, [itens, listaId]);

  useEffect(() => {
    if (!caixa.current) return;
    let cancelado = false;
    let mapa: MLMap | undefined;

    (async () => {
      const ml = await carregarMaplibre();
      if (cancelado || !caixa.current) return;
      const estilo = structuredClone(ESTILO_BASE);
      estilo.layers = estilo.layers.map((l) => ({
        ...l, layout: { visibility: l.id === "base-satelite" ? "visible" : "none" },
      })) as typeof estilo.layers;

      mapa = new ml.Map({
        container: caixa.current, style: estilo, center: CENTRO_REGIAO, zoom: 9,
        attributionControl: { compact: true }, minZoom: 4,
      });
      mapaRef.current = mapa;
      mapa.addControl(new ml.NavigationControl({ showCompass: false }), "top-right");
      const m = mapa;

      // começa assim que o estilo está pronto, sem esperar o "load" (que só vem
      // depois de todos os tiles da tela; com o satélite lento, o aviso de
      // carregamento ficava preso)
      let iniciado = false;
      const iniciar = () => {
        if (iniciado || !m.isStyleLoaded()) return;
        iniciado = true;
        m.off("styledata", iniciar);
        // as fontes nascem vazias: quem as enche é o efeito de `itens` (setData),
        // sem recriar o mapa a cada filtro
        m.addSource("divisas", { type: "geojson", data: VAZIO });
        m.addSource("pontos", { type: "geojson", data: VAZIO });
        const aceso: ExpressionSpecification = ["boolean", ["feature-state", "aceso"], false];
        m.addLayer({
          id: "divisa-fill", type: "fill", source: "divisas", minzoom: 11,
          paint: { "fill-color": ["get", "cor"], "fill-opacity": ["case", aceso, 0.5, 0.22] },
        });
        m.addLayer({
          id: "divisa-linha", type: "line", source: "divisas", minzoom: 11,
          paint: { "line-color": ["case", aceso, "#F2F2EC", ["get", "cor"]], "line-width": ["case", aceso, 3.5, 2] },
        });
        // radar do manual: anel Oliva em volta do ponto de status
        m.addLayer({
          id: "ponto-anel", type: "circle", source: "pontos", maxzoom: 13,
          paint: {
            "circle-color": "rgba(0,0,0,0)",
            "circle-radius": ["case", aceso, 15, 11],
            "circle-stroke-color": RADAR_ANEL,
            "circle-stroke-width": 1.5,
            "circle-stroke-opacity": ["interpolate", ["linear"], ["zoom"], 11.5, 1, 13, 0],
          },
        });
        m.addLayer({
          id: "ponto", type: "circle", source: "pontos", maxzoom: 13,
          paint: {
            "circle-color": ["get", "cor"],
            "circle-radius": ["case", aceso, 9, 6],
            "circle-stroke-color": "#F2F2EC",
            "circle-stroke-width": ["case", aceso, 3, 1.5],
            "circle-opacity": ["interpolate", ["linear"], ["zoom"], 11.5, 1, 13, 0],
            "circle-stroke-opacity": ["interpolate", ["linear"], ["zoom"], 11.5, 1, 13, 0],
          },
        });

        const popup = new ml.Popup({ closeButton: false, closeOnClick: false, offset: 12, className: "popup-busca" });
        for (const camada of ["divisa-fill", "ponto"]) {
          m.on("mousemove", camada, (e) => {
            const f = e.features?.[0];
            if (!f) return;
            m.getCanvas().style.cursor = "pointer";
            const item = itensRef.current.find((i) => i.codigo === f.properties.codigo);
            if (item) {
              const el = document.createElement("div");
              el.className = "text-[13px] leading-tight";
              const t = document.createElement("strong"); t.textContent = item.titulo;
              const p = document.createElement("div"); p.textContent = item.preco;
              el.append(t, p);
              popup.setLngLat(e.lngLat).setDOMContent(el).addTo(m);
            }
          });
          m.on("mouseleave", camada, () => { m.getCanvas().style.cursor = ""; popup.remove(); });
          m.on("click", camada, (e) => {
            const codigo = e.features?.[0]?.properties.codigo as string | undefined;
            if (!codigo) return;
            const cartao = document.querySelector<HTMLElement>(`#${CSS.escape(listaIdRef.current)} [data-codigo="${CSS.escape(codigo)}"]`);
            if (cartao) {
              cartao.scrollIntoView({ behavior: "smooth", block: "center" });
              cartao.classList.add("busca-destaque");
              setTimeout(() => cartao.classList.remove("busca-destaque"), 1800);
            }
          });
        }
        setPronto(true);
      };
      m.on("styledata", iniciar);
      m.once("load", iniciar);
      iniciar();
    })();

    return () => { cancelado = true; mapa?.remove(); mapaRef.current = null; };
  }, []);

  // filtro novo: só troca os dados das fontes e reenquadra (o mapa fica)
  useEffect(() => {
    const m = mapaRef.current;
    if (!m || !pronto) return;
    const { divisas, pontos, limites, total } = dadosDoMapa(itens);
    (m.getSource("divisas") as GeoJSONSource | undefined)?.setData(divisas);
    (m.getSource("pontos") as GeoJSONSource | undefined)?.setData(pontos);
    // os ids (posição na lista) mudam com o filtro: nenhum fica aceso por engano
    m.removeFeatureState({ source: "divisas" });
    m.removeFeatureState({ source: "pontos" });
    acesoRef.current = null;
    if (total) m.fitBounds([[limites[0], limites[1]], [limites[2], limites[3]]], { padding: 50, duration: 0, maxZoom: 15 });
  }, [itens, pronto]);

  // passar o mouse num cartão da lista acende o imóvel no mapa
  useEffect(() => {
    const lista = document.getElementById(listaId);
    const m = mapaRef.current;
    if (!lista || !m || !pronto) return;
    const indice = new Map(itens.filter((i) => i.geom).map((i, n) => [i.codigo, n]));
    const acender = (codigo: string | null) => {
      if (acesoRef.current === codigo) return;
      for (const fonte of ["divisas", "pontos"]) {
        const antes = acesoRef.current != null ? indice.get(acesoRef.current) : undefined;
        if (antes != null) m.setFeatureState({ source: fonte, id: antes }, { aceso: false });
        const agora = codigo != null ? indice.get(codigo) : undefined;
        if (agora != null) m.setFeatureState({ source: fonte, id: agora }, { aceso: true });
      }
      acesoRef.current = codigo;
    };
    const sobre = (e: Event) => acender((e.target as HTMLElement).closest<HTMLElement>("[data-codigo]")?.dataset.codigo ?? null);
    const fora = () => acender(null);
    lista.addEventListener("mouseover", sobre);
    lista.addEventListener("mouseleave", fora);
    return () => { lista.removeEventListener("mouseover", sobre); lista.removeEventListener("mouseleave", fora); };
  }, [itens, listaId, pronto]);

  return (
    <div className="relative h-full w-full overflow-hidden rounded-2xl border border-linha bg-superficie-2">
      <div ref={caixa} className="h-full w-full" />
      {!pronto && <div className="absolute inset-0 grid place-items-center text-sm text-texto-2">Carregando o mapa…</div>}
    </div>
  );
}
