import { gzipSync } from "node:zlib";
import { NextResponse } from "next/server";
import { limiteLeituraMapa } from "@/lib/geo/limiteMemoria";

/**
 * Tiles vetoriais (MVT) da malha do CAR e dos lotes urbanos, gerados no banco
 * (migration 0031). `/api/tiles/car/{z}/{x}/{y}.pbf` e `/api/tiles/lotes/…`.
 *
 * Por que existe: o mapa baixava GeoJSON inteiro a cada movimento e o MapLibre
 * refatiava tudo no navegador — zoom "atrasado" e malha escondida de longe.
 * Um tile pesa de 5 a 150 KB (gzip reduz 3–4×), o navegador guarda em cache e
 * desenha direto da GPU.
 *
 * O PostgREST do Supabase não devolve bytea cru (406), então a função
 * `fn_tile_*` entrega o tile em base64 e o servidor decodifica. As funções são
 * fechadas para anon: só o servidor pede.
 *
 * Limite por IP em memória (3.000 tiles / 5 min, src/lib/geo/limiteMemoria.ts):
 * contar cada tile no banco poria uma ida ao Postgres na frente de cada tile.
 */
const CAMADAS: Record<string, { fn: string; minZoom: number; maxZoom: number }> = {
  car: { fn: "fn_tile_car", minZoom: 7, maxZoom: 13 },
  lotes: { fn: "fn_tile_lotes", minZoom: 15, maxZoom: 17 },
};

const CACHE = "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800";

// Cache em memória do processo: o mesmo tile pedido por vários usuários (ou
// pelo mesmo, ao voltar) não refaz a consulta no banco. Pequeno e com prazo —
// o CAR e os lotes mudam só em reimportação.
const MEMORIA_MAX = 400;
const MEMORIA_TTL_MS = 60 * 60_000;
const memoria = new Map<string, { raw: Buffer; gz: Buffer; em: number }>();
function lembrar(chave: string, raw: Buffer, gz: Buffer) {
  if (memoria.size >= MEMORIA_MAX) {
    const primeira = memoria.keys().next().value;
    if (primeira) memoria.delete(primeira);
  }
  memoria.set(chave, { raw, gz, em: Date.now() });
}

export async function GET(request: Request, ctx: RouteContext<"/api/tiles/[camada]/[z]/[x]/[y]">) {
  const bloqueio = await limiteLeituraMapa(request, "tiles");
  if (bloqueio) return bloqueio;
  const { camada, z: zs, x: xs, y: ys } = await ctx.params;
  const cfg = CAMADAS[camada];
  if (!cfg) return NextResponse.json({ error: "Camada desconhecida." }, { status: 404 });

  const z = Number(zs), x = Number(xs), y = Number(ys.replace(/\.(pbf|mvt)$/i, ""));
  const max = 2 ** z;
  if (![z, x, y].every(Number.isInteger) || z < 0 || z > 22 || x < 0 || y < 0 || x >= max || y >= max) {
    return NextResponse.json({ error: "Tile inválido." }, { status: 400 });
  }
  // fora da faixa da camada: tile vazio, cacheável — o mapa nem deveria pedir
  if (z < cfg.minZoom || z > cfg.maxZoom) {
    return new NextResponse(null, { status: 204, headers: { "Cache-Control": CACHE } });
  }

  // `?v=` muda quando o CAR sob demanda grava uma área nova: o mapa pede de
  // novo e este cache não pode devolver o tile antigo (vazio)
  const versao = new URL(request.url).searchParams.get("v") ?? "";
  const chaveTile = `${camada}/${z}/${x}/${y}/${versao}`;
  const aceitaGzip = /gzip/.test(request.headers.get("accept-encoding") ?? "");
  const lembrado = memoria.get(chaveTile);
  if (lembrado && Date.now() - lembrado.em < MEMORIA_TTL_MS) {
    return responder(lembrado.raw.length ? (aceitaGzip ? lembrado.gz : lembrado.raw) : null, aceitaGzip);
  }

  const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/${cfg.fn}`;
  const chave = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      apikey: chave, Authorization: `Bearer ${chave}`,
      "Content-Type": "application/json", Accept: "application/json",
    },
    body: JSON.stringify({ z, x, y }),
    // o tile de uma área não muda de minuto em minuto; o cache do fetch do Next ajuda em SSR
    cache: "no-store",
  });
  if (!res.ok) {
    const texto = await res.text().catch(() => "");
    console.error(`tile ${camada}/${z}/${x}/${y} falhou: ${res.status} ${texto.slice(0, 200)}`);
    return NextResponse.json({ error: "Falha ao gerar o tile." }, { status: 502 });
  }
  const b64 = (await res.json().catch(() => null)) as string | null;
  const corpo = b64 ? Buffer.from(b64, "base64") : Buffer.alloc(0);
  const gz = corpo.length ? gzipSync(corpo) : Buffer.alloc(0);
  lembrar(chaveTile, corpo, gz);
  return responder(corpo.length ? (aceitaGzip ? gz : corpo) : null, aceitaGzip);
}

function responder(saida: Buffer | null, gzip: boolean) {
  if (!saida) return new NextResponse(null, { status: 204, headers: { "Cache-Control": CACHE } });
  return new NextResponse(new Uint8Array(saida), {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.mapbox-vector-tile",
      "Cache-Control": CACHE,
      ...(gzip ? { "Content-Encoding": "gzip" } : {}),
      Vary: "Accept-Encoding",
    },
  });
}
