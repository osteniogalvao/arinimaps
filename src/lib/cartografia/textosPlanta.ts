import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TextoPlanta } from "@/lib/geo/dxf";

/**
 * Números de quadra/lote e áreas escritas no DXF de uma planta (áudio do
 * Carlos, 28/11/2026). Ficam num arquivo ao lado da planta, com caminho fixo
 * pelo id da camada, para a fila (worker/jobs/gerarLotes.mjs) reaplicar a
 * numeração e a área oficial TODA vez que os lotes forem gerados de novo —
 * sem isso, cada recalibração apagava os números dos lotes refeitos.
 */
export const caminhoTextosPlanta = (layerId: string) => `cartografia/textos/${layerId}.json`;

export async function salvarTextosPlanta(admin: SupabaseClient, layerId: string, textos: TextoPlanta[]) {
  const corpo = Buffer.from(JSON.stringify({ versao: 1, gerado_em: new Date().toISOString(), textos }));
  const { error } = await admin.storage.from("media")
    .upload(caminhoTextosPlanta(layerId), corpo, { contentType: "application/json", upsert: true });
  return error ? error.message : null;
}

/** Quantos de cada tipo, para mostrar ao operador. */
export function resumoTextos(textos: TextoPlanta[]) {
  return {
    numeros: textos.filter((t) => t.k === "n").length,
    quadras_explicitas: textos.filter((t) => t.k === "q").length,
    letras: textos.filter((t) => t.k === "l").length,
    areas: textos.filter((t) => t.k === "a").length,
  };
}
