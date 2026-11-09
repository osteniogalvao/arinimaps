import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { aplicarEdicoesGeoJSON, centroDe, removerLinhasExcluidas, type EdicaoGeometria } from "@/lib/geo/deslocar";

/**
 * Caminho do arquivo público: pasta própria e nome aleatório. Antes era o
 * caminho do original + `.publico-<ts>`, e bastava tirar o sufixo para baixar
 * o original (com as camadas escondidas e as linhas apagadas) do bucket público.
 * O nome novo não guarda nada do original. Também muda a cada gravação: a URL
 * pública tem cache de CDN, e sobrescrever serviria a seleção antiga.
 */
export function caminhoPlantaPublica() {
  return `cartografia/publico/${crypto.randomUUID()}.geojson`;
}

/**
 * Planta recém-enviada: o público é cópia do original (nada escondido ainda),
 * mas num caminho próprio, para que a URL do original nunca saia na resposta
 * pública (/api/geo/cartografia).
 */
export async function publicarCopiaInicial(
  admin: SupabaseClient,
  camadaId: string,
  corpo: Buffer,
  fc: GeoJSON.FeatureCollection
): Promise<void> {
  const path = caminhoPlantaPublica();
  const { error: upErro } = await admin.storage.from("media")
    .upload(path, corpo, { contentType: "application/geo+json", upsert: false });
  if (upErro) throw new Error(`o armazenamento recusou a cópia pública: ${upErro.message}`);
  const { error } = await admin.from("cartography_layers").update({
    publico_path: path, publico_bytes: corpo.length, publico_centro: centroDe(fc),
  }).eq("id", camadaId);
  if (error) {
    await admin.storage.from("media").remove([path]).catch(() => undefined);
    throw new Error(`a cópia pública subiu, mas o banco não gravou: ${error.message}`);
  }
}

/**
 * Versão pública da planta: o GeoJSON sem as camadas do CAD que o operador
 * escondeu na calibração.
 *
 * POR QUE EXISTE. Esconder camada era só filtro no navegador: o mapa baixava
 * os 19,3 MB de Iturama e jogava fora 41% (as 10 camadas de paisagismo —
 * VEGET_I, FORRAÇÃO04, Paisagismo…). Agora, ao salvar a seleção, o servidor
 * grava um arquivo já filtrado e o mapa público baixa só esse.
 *
 * O CENTRO É DO ARQUIVO COMPLETO, e isso não é detalhe. Giro e escala da
 * calibração são aplicados em volta do centro da planta, e a tela de calibração
 * mede esse centro no arquivo inteiro. Se o mapa medisse o centro no arquivo
 * filtrado (retângulo menor, centro em outro lugar), uma planta girada 0,4°
 * sairia metros do lugar calibrado. Por isso o centro vai junto, gravado.
 *
 * O arquivo original fica intacto: é dele que a calibração lê, para poder
 * mostrar de novo uma camada que foi escondida.
 *
 * LINHAS APAGADAS (05/11/2026): as linhas soltas que o operador apagou na
 * calibração também saem daqui. Por isso o arquivo público passa a existir
 * sempre que houver camada escondida OU linha apagada.
 */
export async function gerarPlantaPublica(
  admin: SupabaseClient,
  camada: { id: string; tiles_path: string; publico_path?: string | null },
  ocultos: string[],
  excluidas: string[] = [],
  edicoes: EdicaoGeometria[] = []
): Promise<{ path: string | null; bytes: number; linhas: number; linhasTotal: number; centro: [number, number] }> {
  const { data: arquivo, error } = await admin.storage.from("media").download(camada.tiles_path);
  if (error || !arquivo) throw new Error(`não consegui ler a planta original: ${error?.message ?? "arquivo vazio"}`);

  const original = JSON.parse(await arquivo.text()) as GeoJSON.FeatureCollection;
  const fc = aplicarEdicoesGeoJSON(original, edicoes);
  const centro = centroDe(fc);
  const esconder = new Set(ocultos);
  // apaga as linhas pela posição no arquivo ORIGINAL, antes de filtrar as camadas
  const semApagadas = removerLinhasExcluidas(fc, excluidas);
  const features = semApagadas.features.filter((f) => !esconder.has(String(f.properties?.layer ?? "")));

  const anterior = camada.publico_path ?? null;
  let path: string | null = null;
  let bytes = 0;

  // Sempre grava o arquivo público, mesmo sem filtro: o mapa público nunca
  // recebe a URL do original (ver caminhoPlantaPublica).
  {
    const corpo = Buffer.from(JSON.stringify({ ...fc, features }));
    path = caminhoPlantaPublica();
    const { error: upErro } = await admin.storage.from("media")
      .upload(path, corpo, { contentType: "application/geo+json", upsert: false });
    if (upErro) throw new Error(`o armazenamento recusou a planta filtrada: ${upErro.message}`);
    bytes = corpo.length;
  }

  const { error: dbErro } = await admin.from("cartography_layers").update({
    publico_path: path,
    publico_bytes: path ? bytes : null,
    publico_centro: centro,
  }).eq("id", camada.id);
  if (dbErro) throw new Error(`a planta filtrada subiu, mas o banco não gravou: ${dbErro.message}`);

  if (anterior && anterior !== path) await admin.storage.from("media").remove([anterior]);

  return { path, bytes, linhas: features.length, linhasTotal: fc.features.length, centro };
}
