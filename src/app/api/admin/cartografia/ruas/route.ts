import { NextResponse } from "next/server";
import { ator, temSetor } from "@/lib/authz";
import { falha } from "@/lib/erros";
import { ruasDoOsm } from "@/lib/cartografia/ruasOsm";

export const maxDuration = 120;

/**
 * Eixos das ruas do OpenStreetMap no retângulo pedido, para o "Encaixar pelas
 * ruas" da calibração (src/lib/geo/encaixeRuas.ts). Só leitura; restrito à
 * equipe com o setor de cartografia.
 */
export async function GET(request: Request) {
  const a = await ator();
  if (!a || !temSetor(a, "cartografia")) {
    return falha(403, "sem_permissao", "Restrito à equipe de cartografia da Arini.");
  }
  const caixa = (new URL(request.url).searchParams.get("bbox") ?? "").split(",").map(Number);
  if (caixa.length !== 4 || caixa.some((v) => !Number.isFinite(v))) {
    return falha(400, "bbox_invalida", "Informe o retângulo como oeste,sul,leste,norte.");
  }
  const [o, s, l, n] = caixa;
  if (o >= l || s >= n || o < -75 || l > -28 || s < -35 || n > 6) {
    return falha(400, "bbox_invalida", "O retângulo precisa estar dentro do Brasil.");
  }
  // uma cidade grande inteira cabe em ~0,15 grau; acima disso o OSM recusa ou demora demais
  if ((l - o) * (n - s) > 0.06) {
    return falha(400, "area_grande", "A área é grande demais para buscar as ruas de uma vez.", {
      motivo: `O retângulo tem ${((l - o) * 104).toFixed(0)} × ${((n - s) * 110).toFixed(0)} km.`,
      solucao: "Esconda as camadas do CAD que ficam longe da cidade (moldura, carimbo) ou aproxime o mapa e encaixe por partes.",
    });
  }
  try {
    const ruas = await ruasDoOsm([o, s, l, n]);
    return NextResponse.json({ ruas }, { headers: { "Cache-Control": "private, max-age=3600" } });
  } catch (e) {
    return falha(502, "osm_indisponivel", "O OpenStreetMap não respondeu agora.", {
      motivo: e instanceof Error ? e.message : String(e),
      solucao: "Tente de novo em um minuto. Enquanto isso, os pontos de controle continuam funcionando.",
    });
  }
}
