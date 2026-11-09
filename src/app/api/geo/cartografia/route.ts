import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { limiteLeituraMapa } from "@/lib/geo/limiteMemoria";
import { ator, temSetor } from "@/lib/authz";
import { assinaturaAjustes, assinaturaEdicoes, assinaturaExclusoes, type AjusteLocal, type EdicaoGeometria } from "@/lib/geo/deslocar";

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
 *
 * O ORIGINAL É SÓ DA EQUIPE. O arquivo completo tem as camadas que o operador
 * escondeu e as linhas que apagou; o diagnóstico do CAD (camadas, zona UTM)
 * também é material de trabalho. Esses campos só saem para quem é do setor de
 * cartografia (a tela Calibrar). Para o público, `geojson` aponta SÓ para o
 * arquivo público (`publico_path`, nome aleatório que não leva ao original).
 * A URL do original nunca sai para o público, nem quando os dois são iguais:
 * quem a guardasse baixaria depois as camadas escondidas. Planta ainda sem
 * arquivo público fica fora do mapa público até a calibração gerá-lo (envio
 * novo já gera; planta antiga gera ao salvar a calibração uma vez).
 */
export async function GET(request: Request) {
  const bloqueio = await limiteLeituraMapa(request, "geo");
  if (bloqueio) return bloqueio;
  const fresco = new URL(request.url).searchParams.get("fresco") === "1";
  // só consulta a sessão se houver cookie de login: o mapa público (anônimo)
  // não paga a ida ao Supabase Auth
  const temSessao = /(?:^|;\s*)sb-[^=]*-auth-token/.test(request.headers.get("cookie") ?? "");
  const equipe = temSessao ? temSetor(await ator(), "cartografia") : false;

  const { data, error } = await supabaseAdmin()
    .from("cartography_layers")
    .select("id, nome, tipo, tiles_path, min_zoom, max_zoom, opacidade_padrao, datum, offset_leste_m, offset_norte_m, rotacao_graus, escala, layers_ocultos, linhas_excluidas, espessura_linha, ajustes_locais, edicoes_geometria, bytes, diagnostico, publico_path, publico_bytes, publico_centro, lotes_total, lotes_gerados_em, lotes_assinatura, municipality:municipalities(nome)")
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
    const original = c.tipo === "vector" ? `${base}/${c.tiles_path}` : undefined;
    // Planta antiga sem arquivo público e sem nada escondido, apagado ou
    // corrigido: o original é idêntico ao público, então pode ser servido até a
    // próxima calibração gerar a cópia (senão ela sumiria do mapa público).
    const nadaFiltrado = !(c.layers_ocultos as string[] | null)?.length &&
      !(c.linhas_excluidas as string[] | null)?.length &&
      !(c.edicoes_geometria as unknown[] | null)?.length;
    const publico = c.tipo !== "vector" ? undefined
      : c.publico_path ? `${base}/${c.publico_path}`
      : nadaFiltrado ? original : undefined;
    return {
      id: c.id,
      nome: c.nome,
      municipio: mun?.nome ?? null,
      tipo: c.tipo,
      tiles: c.tipo === "raster" ? `${base}/${c.tiles_path}/{z}/{x}/{y}.png` : undefined,
      // equipe: original completo (a calibração lê daqui para reexibir camada
      // escondida). Público: só o arquivo público.
      geojson: equipe ? original : publico,
      // o que o mapa público baixa: já sem as camadas escondidas (0019)
      geojson_publico: publico,
      centro: Array.isArray(c.publico_centro) && c.publico_centro.length === 2 ? (c.publico_centro as [number, number]) : null,
      min_zoom: c.min_zoom,
      max_zoom: c.max_zoom,
      opacidade: Number(c.opacidade_padrao),
      datum: c.datum,
      bytes: equipe && c.bytes ? Number(c.bytes) : null,
      bytes_publico: c.publico_bytes ? Number(c.publico_bytes) : null,
      bbox,
      layers_ocultos: (c.layers_ocultos ?? []) as string[],
      // linhas apagadas na calibração e espessura das linhas (áudio do Carlos, 05/11)
      linhas_excluidas: (c.linhas_excluidas ?? []) as string[],
      espessura: Number(c.espessura_linha ?? 1) || 1,
      layers_cad: equipe ? diag?.layers ?? [] : [],
      // lotes clicáveis: quantos há e se foram gerados com a calibração de agora
      lotes: c.tipo === "vector" ? {
        total: c.lotes_total as number | null,
        gerados_em: c.lotes_gerados_em as string | null,
        defasados: c.lotes_total != null && c.lotes_assinatura !== [
          c.offset_leste_m ?? 0, c.offset_norte_m ?? 0, c.rotacao_graus ?? 0, c.escala ?? 1,
          [...((c.layers_ocultos ?? []) as string[])].sort().join("|"),
        ].join(";") + assinaturaExclusoes(c.linhas_excluidas as string[] | null) + assinaturaAjustes((c.ajustes_locais ?? []) as AjusteLocal[]) +
          assinaturaEdicoes((c.edicoes_geometria ?? []) as EdicaoGeometria[]),
      } : null,
      zona: equipe ? diag?.zona ?? null : null,
      // partes da planta com ajuste próprio (src/lib/geo/deslocar.ts)
      ajustes: (c.ajustes_locais ?? []) as AjusteLocal[],
      edicoes: (c.edicoes_geometria ?? []) as EdicaoGeometria[],
      transform: {
        offsetLesteM: Number(c.offset_leste_m ?? 0),
        offsetNorteM: Number(c.offset_norte_m ?? 0),
        rotacaoGraus: Number(c.rotacao_graus ?? 0),
        escala: Number(c.escala ?? 1) || 1,
      },
    };
  });

  return NextResponse.json(corpo, {
    // resposta da equipe tem o original: nunca em cache compartilhado
    headers: { "Cache-Control": fresco || equipe ? "private, no-store" : "public, max-age=60", Vary: "Cookie" },
  });
}
