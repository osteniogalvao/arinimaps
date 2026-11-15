"use client";

import { useEffect, useState } from "react";
import type { AddProtocolAction, LayerSpecification, Map as MLMap } from "maplibre-gl";
import { carregarMaplibre } from "@/lib/map/maplibre";
import {
  CAMADAS_RELEVO,
  camadasDeRelevo,
  RAMPA_ALTITUDE,
  type GerenciadorRelevo,
  type RelevoId,
} from "./camadasRelevo";
import { lerVetoresNasAreas } from "./vetoresNasAreas";

let proximoProtocolo = 0;

/** Uma instância só enquanto esta camada tem recortes. O mapa continua com um único canvas/WebGL. */
export default function RelevoNasAreas({
  mapa,
  gerente,
  id,
  areas,
  aoErro,
}: {
  mapa: MLMap;
  gerente: GerenciadorRelevo;
  id: RelevoId;
  areas: GeoJSON.Polygon[];
  aoErro: (id: RelevoId, aviso: string) => void;
}) {
  // O pai muda a chave quando a lista de áreas desta camada muda.
  const [mascaras] = useState(areas);
  useEffect(() => {
    let cancelado = false;
    const fonte = `relevo-local-${id}`,
      camadas: string[] = [];
    let encerrarProtocolo: (() => void) | undefined;
    let pararLeitura: (() => void) | undefined;
    const avisar = (aviso: string) => {
      if (!cancelado) aoErro(id, aviso);
    };
    async function criar() {
      await gerente.criar(id);
      if (cancelado) return;
      const originais = mapa.getStyle().layers.filter((l) => camadasDeRelevo(id).includes(l.id));
      if (!originais.length) throw new Error("Fonte indisponível");
      const antes = originais[0].id;
      if (id === "hidrografia") {
        mapa.addSource(fonte, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        const leitores: string[] = [];
        for (const original of originais) {
          if (!("source-layer" in original)) continue;
          if (original.type === "fill" || original.type === "line") {
            const leitor = original.id + "-leitura";
            mapa.addLayer(
              {
                ...original,
                id: leitor,
                paint: original.type === "fill" ? { "fill-opacity": 0 } : { "line-opacity": 0 },
              } as LayerSpecification,
              antes,
            );
            leitores.push(leitor);
            camadas.push(leitor);
          }
          const local = {
            ...original,
            source: fonte,
            id: original.id + "-local",
            layout: { ...original.layout, visibility: "visible" as const },
          };
          delete local["source-layer"];
          mapa.addLayer(local as LayerSpecification, antes);
          camadas.push(local.id);
        }
        pararLeitura = lerVetoresNasAreas(mapa, mascaras, leitores, "relevo-agua-osm", fonte, avisar);
        return;
      }
      const ml = await carregarMaplibre();
      if (cancelado) return;
      const protocolo = "arini-recorte-" + ++proximoProtocolo;
      const worker = new Worker(new URL("./terrenoNasAreas.worker.ts", import.meta.url));
      worker.postMessage({ areas: mascaras, rampa: RAMPA_ALTITUDE });
      let sequencia = 0;
      const retornos = new Map<number, (dados?: ArrayBuffer) => void>();
      worker.onmessage = ({ data }) => retornos.get(data.id)?.(data.bytes);
      worker.onerror = () => retornos.forEach((responder) => responder());
      const tile: AddProtocolAction = (p, ctrl) =>
        new Promise((resolve, reject) => {
          const [z, x, y] = p.url.split("://")[1].split("/").map(Number);
          const seq = ++sequencia;
          const abortar = () => {
            retornos.delete(seq);
            worker.postMessage({ id: seq, cancelar: true });
            reject(ctrl.signal.reason);
          };
          if (ctrl.signal.aborted) {
            reject(ctrl.signal.reason);
            return;
          }
          ctrl.signal.addEventListener("abort", abortar, { once: true });
          retornos.set(seq, (bytes) => {
            retornos.delete(seq);
            ctrl.signal.removeEventListener("abort", abortar);
            if (bytes) resolve({ data: bytes });
            else {
              avisar("Parte do relevo não carregou.");
              reject(new Error("Tile de relevo indisponível"));
            }
          });
          worker.postMessage({ id: seq, tipo: id, z, x, y });
        });
      ml.addProtocol(protocolo, tile);
      encerrarProtocolo = () => {
        ml.removeProtocol(protocolo);
        worker.terminate();
        retornos.forEach((fn) => fn());
      };
      const minzoom = CAMADAS_RELEVO.find((c) => c.id === id)?.zoomMin ?? 0;
      const tiles = [protocolo + "://{z}/{x}/{y}"];
      const especificacao = {
        tiles,
        minzoom,
        maxzoom: 15,
        attribution: "Relevo: SRTM via Terrarium (AWS Open Data)",
      };
      if (id === "curvas") {
        mapa.addSource(fonte, { ...especificacao, type: "vector" });
        for (const orig of originais) {
          if (orig.type !== "line" && orig.type !== "symbol") continue;
          const local = {
            ...orig,
            id: orig.id + "-local",
            source: fonte,
            layout: { ...orig.layout, visibility: "visible" as const },
          };
          mapa.addLayer(local as LayerSpecification, antes);
          camadas.push(local.id);
        }
      } else {
        mapa.addSource(fonte, { ...especificacao, type: "raster", tileSize: 256 });
        mapa.addLayer(
          {
            id: fonte,
            type: "raster",
            source: fonte,
            minzoom,
            paint: {
              "raster-opacity": id === "altitude" ? 0.62 : id === "declividade" ? 0.58 : 1,
              "raster-resampling": id === "declividade" ? "nearest" : "linear",
              "raster-fade-duration": 0,
            },
          },
          antes,
        );
        camadas.push(fonte);
      }
    }
    void criar().catch(() => avisar("A fonte desta camada não respondeu para a área."));
    return () => {
      cancelado = true;
      pararLeitura?.();
      if (mapa.style) {
        for (const camada of camadas.reverse()) if (mapa.getLayer(camada)) mapa.removeLayer(camada);
        if (mapa.getSource(fonte)) mapa.removeSource(fonte);
      }
      encerrarProtocolo?.();
    };
  }, [mapa, gerente, id, mascaras, aoErro]);
  return null;
}
