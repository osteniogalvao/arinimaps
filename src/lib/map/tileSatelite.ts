import type { AddProtocolAction } from "maplibre-gl";
import { TILE_DETALHE, urlTileAlto, urlTileHistorico, urlTileAtivo } from "./config";
import { urlMosaico } from "../../../public/vendor/fonte-satelite.mjs";
import { amostrarImagem, melhoraCobertura } from "./coberturaNuvens";

async function buscar(url: string, signal: AbortSignal, timeout: number) {
  const resposta = await fetch(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(timeout)]) });
  if (!resposta.ok || !resposta.headers.get("content-type")?.startsWith("image/")) {
    throw new Error("Imagem de satélite indisponível.");
  }
  return { data: await resposta.arrayBuffer(), cacheControl: resposta.headers.get("cache-control") ?? undefined };
}

// A camada opcional z18+ é sobreposta à base, que já escolhe a melhor captura.
const transparente = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNgYAAAAAMAASsJTYQAAAAASUVORK5CYII="), c => c.charCodeAt(0));

export const carregarTileSatelite: AddProtocolAction = async ({ url }, abort) => {
  const xyz = /^arini-satelite:\/\/(tile|alto|mosaico)\/(\d+)\/(\d+)\/(\d+)$/.exec(url);
  if (!xyz) throw new Error("Endereço de tile de satélite inválido.");
  const [z, x, y] = xyz.slice(2).map(Number);
  const signal = abort.signal;
  if (xyz[1] === "mosaico") return buscar(urlMosaico(z, x, y), signal, 15000);
  const sobreposta = xyz[1] === "alto";
  const principal = sobreposta ? urlTileAlto(z, x, y) : urlTileAtivo(z, x, y);
  let imagem;
  try {
    imagem = await buscar(principal, signal, 12000);
  } catch {
    signal.throwIfAborted();
    if (sobreposta) return { data: transparente.slice().buffer, cacheControl: "max-age=300" };
    const reserva = z > 13 ? urlMosaico(z, x, y) :
      TILE_DETALHE.replace("{z}", String(z)).replace("{x}", String(x)).replace("{y}", String(y));
    return { ...await buscar(reserva, signal, 10000), cacheControl: "max-age=300" };
  }
  if (z <= 13) return imagem;
  const original = await amostrarImagem(imagem.data).catch(() => null);
  signal.throwIfAborted();
  if (!original?.suspeita) return imagem;

  if (sobreposta) return { data: transparente.slice().buffer, cacheControl: imagem.cacheControl };

  // Prefere outra fotografia de detalhe. O mosaico anual é a segunda alternativa.
  for (const endereco of [urlTileHistorico(z, x, y, "16453"), urlMosaico(z, x, y)]) {
    try {
      const outra = await buscar(endereco, signal, 4000);
      const amostra = await amostrarImagem(outra.data);
      signal.throwIfAborted();
      if (amostra && melhoraCobertura(original, amostra)) return outra;
    } catch {
      signal.throwIfAborted();
    }
  }
  return imagem;
};

