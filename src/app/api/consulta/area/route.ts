import { supabaseAdmin } from "@/lib/supabase/admin";
import { currentUser } from "@/lib/supabase/server";
import type { Bbox } from "@/lib/rural/adaptadores";
import { executarConsultaArea, validarAreaDesenhada } from "@/lib/geo/consultaArea";
import { falha } from "@/lib/erros";

export const maxDuration = 120;

/** Folga ao redor da área desenhada, como na consulta do CAR. */
const RAIO_M = 2000;

/**
 * Consulta de uma área DESENHADA no mapa, em qualquer ponto do Brasil
 * (roadmap 5.6). A venda começa na região de Iturama, mas a consulta vale para
 * o país todo: as fontes ao vivo respondem para qualquer retângulo.
 *
 * Corpo: GeoJSON Polygon/MultiPolygon (ou Feature com um deles), ou
 * `{ chave: "geo:…" }` para refazer uma área já registrada. Valida forma,
 * tamanho (≤ 50.000 ha) e se está dentro do Brasil; a chave `geo:<sha1>` sai da
 * geometria normalizada, então a mesma área desenhada de novo reaproveita o
 * cache. Plano, cota, limite e registro: os mesmos da consulta do CAR.
 */
export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return falha(401, "sem_sessao", "Entre na sua conta para consultar a sua área.");
  const corpo = await request.json().catch(() => null);
  // "Atualizar consulta" da página manda só a chave: a geometria já está guardada
  let bruto = corpo?.geometria ?? corpo;
  if (typeof corpo?.chave === "string") {
    if (!/^geo:[0-9a-f]{40}$/.test(corpo.chave)) return falha(400, "chave_invalida", "Chave de área inválida.");
    const { data } = await supabaseAdmin().rpc("fn_ler_area_propria", { p_chave: corpo.chave, p_user: user.id });
    bruto = (data as { geometry?: unknown } | null)?.geometry ?? null;
    if (!bruto) return falha(404, "area_nao_encontrada", "Área não encontrada.", { solucao: "Desenhe a área de novo no mapa." });
  }
  const validada = await validarAreaDesenhada(bruto);
  if (!validada.ok) {
    return falha(400, "area_invalida", validada.erro, { solucao: "Desenhe a área de novo no mapa, clicando nos vértices." });
  }
  const { geometria } = validada.area;
  // área já registrada: mantém a chave original (a geometria voltou do banco)
  const chave: string = typeof corpo?.chave === "string" ? corpo.chave : validada.area.chave;

  return executarConsultaArea(request, {
    chave,
    raioM: RAIO_M,
    naoEncontrado: "Não foi possível registrar a área desenhada.",
    bbox: async () => {
      const { data, error } = await supabaseAdmin().rpc("fn_registrar_area_propria", {
        p_chave: chave, p_geojson: geometria, p_user: user.id, p_buffer_m: RAIO_M,
      });
      const r = data as { valida: boolean; bbox?: Bbox } | null;
      if (error || !r?.valida || !r.bbox) return null;
      return r.bbox;
    },
  });
}
