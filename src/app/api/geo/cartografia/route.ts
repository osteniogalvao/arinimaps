import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { limiteLeituraMapa } from "@/lib/geo/limiteMemoria";
import { assinaturaAjustes, assinaturaExclusoes, type AjusteLocal } from "@/lib/geo/deslocar";

/**
 * Camadas de cartografia prontas: raster (pirâmide de tiles) e vetorial
 * (plantas CAD convertidas).
 *
 * A transformação vai em METROS, não em graus já convertidos como antes: com
 * giro e escala no jogo, quem aplica precisa do centro da planta, e o centro só
 * se conhece depois de carregar o GeoJSON. Converter aqui daria uma planta
 * torta — um grau de longitude no Pontal vale ~105 km e um de latitude ~110,5.
 *
 * O `bbox` é o que permite ao mapa NÃO baixar a planta. Iturama são 19 MB;
 * abrir o mapa na visão regional baixava as três cidades (22 MB) para desenhar
 * nenhuma, porque abaixo de z12 a planta nem entra. Com o retângulo aqui, o
 * mapa só busca o arquivo quando a cidade está na tela e no zoom de lote.
 *
 * `?fresco=1` desliga o cache. A tela de calibração lê desta mesma rota, e com
 * `max-age=60` ela reabria nos valores ANTIGOS logo depois de salvar — o
 * operador via "não salvou", mexia de novo e gravava o valor velho por cima.
 * Perder calibração é pior do que uma consulta a mais ao banco.
 */
export async function GET(request: Request) {
  const bloqueio = limiteLeituraMapa(request, "geo");
  if (bloqueio) return bloqueio;
  const fresco = new URL(request.url).searchParams.get("fresco") === "1";

  const { data, error } = await supabaseAdmin()
    .from("cartography_layers")
    .select("id, nome, tipo, tiles_path, min_zoom, max_zoom, opacidade_padrao, datum, offset_leste_m, offset_norte_m, rotacao_graus, escala, layers_ocultos, linhas_excluidas, espessura_linha, ajustes_locais, bytes, diagnostico, publico_path, publico_bytes, publico_centro, lotes_total, lotes_gerados_em, lotes_assinatura, municipality:municipalities(nome)")
    .eq("status", "pronto")
    .not("tiles_path", "is", null);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const base = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/media`;
  const corpo = (data ?? []).map((c) => {
    const mun = c.municipality as unknown as { nome: string } | null;
    const diag = (c.diagnostico ?? null) as {
      layers?: { nome: string; linhas: number }[];
      zona?: number | string;
      bbox?: [number, number, number, number];
    } | null;
    // bbox só vale se vier completo e finito — planta antiga não tem diagnóstico,
    // e nesse caso o mapa carrega como antes em vez de decidir por um retângulo
    // inventado.
    const b = diag?.bbox;
    const bbox = Array.isArray(b) && b.length === 4 && b.every((n) => Number.isFinite(n)) ? b : null;
    return {
      id: c.id,
      nome: c.nome,
      municipio: mun?.nome ?? null,
      tipo: c.tipo,
      tiles: c.tipo === "raster" ? `${base}/${c.tiles_path}/{z}/{x}/{y}.png` : undefined,
      // original completo: a calibração lê daqui para poder reexibir camada escondida
      geojson: c.tipo === "vector" ? `${base}/${c.tiles_path}` : undefined,
      // o que o mapa público baixa: já sem as camadas escondidas (0019)
      geojson_publico: c.tipo === "vector" && c.publico_path ? `${base}/${c.publico_path}` : undefined,
      centro: Array.isArray(c.publico_centro) && c.publico_centro.length === 2 ? (c.publico_centro as [number, number]) : null,
      min_zoom: c.min_zoom,
      max_zoom: c.max_zoom,
      opacidade: Number(c.opacidade_padrao),
      datum: c.datum,
      bytes: c.bytes ? Number(c.bytes) : null,
      bytes_publico: c.publico_bytes ? Number(c.publico_bytes) : null,
      bbox,
      layers_ocultos: (c.layers_ocultos ?? []) as string[],
      // linhas apagadas na calibração e espessura das linhas (áudio do Carlos, 05/11)
      linhas_excluidas: (c.linhas_excluidas ?? []) as string[],
      espessura: Number(c.espessura_linha ?? 1) || 1,
      layers_cad: diag?.layers ?? [],
      // lotes clicáveis: quantos há e se foram gerados com a calibração de agora
      lotes: c.tipo === "vector" ? {
        total: c.lotes_total as number | null,
        gerados_em: c.lotes_gerados_em as string | null,
        defasados: c.lotes_total != null && c.lotes_assinatura !== [
          c.offset_leste_m ?? 0, c.offset_norte_m ?? 0, c.rotacao_graus ?? 0, c.escala ?? 1,
          [...((c.layers_ocultos ?? []) as string[])].sort().join("|"),
        ].join(";") + assinaturaExclusoes(c.linhas_excluidas as string[] | null) + assinaturaAjustes((c.ajustes_locais ?? []) as AjusteLocal[]),
      } : null,
      zona: diag?.zona ?? null,
      // partes da planta com ajuste próprio (src/lib/geo/deslocar.ts)
      ajustes: (c.ajustes_locais ?? []) as AjusteLocal[],
      transform: {
        offsetLesteM: Number(c.offset_leste_m ?? 0),
        offsetNorteM: Number(c.offset_norte_m ?? 0),
        rotacaoGraus: Number(c.rotacao_graus ?? 0),
        escala: Number(c.escala ?? 1) || 1,
      },
    };
  });

  return NextResponse.json(corpo, {
    headers: { "Cache-Control": fresco ? "no-store" : "public, max-age=60" },
  });
}
