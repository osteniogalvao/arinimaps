import { NextResponse } from "next/server";
import { limiteLeituraMapa } from "@/lib/geo/limiteMemoria";
import { limiteMunicipio, municipiosIbge } from "@/lib/geo/carImportacao";

/**
 * Busca de município no Brasil inteiro para a caixa de busca do mapa (item 23).
 *
 *  - `?q=uberaba` → até 6 municípios do IBGE cujo nome casa (começo do nome
 *    primeiro), com UF e código;
 *  - `?cod=3170107` → o retângulo do município ([oeste, sul, leste, norte]),
 *    da malha do IBGE, para o mapa enquadrar.
 *
 * A lista dos 5.570 municípios fica um dia na memória do servidor
 * (municipiosIbge) e cada retângulo, enquanto o processo viver: o IBGE só é
 * consultado na primeira vez.
 */

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

const retangulos = new Map<number, [number, number, number, number]>();
// cache negativo: o IBGE não deu a malha deste código; não pergunta de novo por 10 min
const falhas = new Map<number, number>();
const ESPERA_FALHA = 10 * 60_000;

function retanguloDe(g: GeoJSON.Geometry): [number, number, number, number] | null {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  const andar = (c: unknown): void => {
    if (Array.isArray(c) && typeof c[0] === "number") {
      const [x, y] = c as [number, number];
      if (x < w) w = x; if (x > e) e = x; if (y < s) s = y; if (y > n) n = y;
    } else if (Array.isArray(c)) c.forEach(andar);
  };
  andar((g as { coordinates?: unknown }).coordinates);
  return Number.isFinite(w) ? [w, s, e, n] : null;
}

export async function GET(request: Request): Promise<Response> {
  const bloqueio = await limiteLeituraMapa(request, "geo");
  if (bloqueio) return bloqueio;
  const url = new URL(request.url);
  const cache = { "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800" };

  const cod = Number(url.searchParams.get("cod"));
  if (cod) {
    if (!/^\d{7}$/.test(String(cod))) return NextResponse.json({ error: "Código IBGE inválido." }, { status: 400 });
    let bbox = retangulos.get(cod) ?? null;
    if (!bbox) {
      // só busca a malha de um código que existe na lista do IBGE: sem isso,
      // qualquer número de 7 dígitos virava um pedido ao IBGE
      const lista = await municipiosIbge();
      if (!lista) return NextResponse.json({ error: "O IBGE não respondeu agora." }, { status: 502 });
      if (!lista.some((m) => m.cod_ibge === cod)) return NextResponse.json({ error: "Município não encontrado." }, { status: 404 });
      const falhou = falhas.get(cod);
      if (falhou && Date.now() - falhou < ESPERA_FALHA) {
        return NextResponse.json({ error: "O IBGE não respondeu agora." }, { status: 502 });
      }
      const g = await limiteMunicipio(cod);
      bbox = g ? retanguloDe(g) : null;
      if (bbox) { retangulos.set(cod, bbox); falhas.delete(cod); }
      else falhas.set(cod, Date.now());
    }
    if (!bbox) return NextResponse.json({ error: "O IBGE não respondeu agora." }, { status: 502 });
    return NextResponse.json({ cod, bbox }, { headers: cache });
  }

  const q = norm((url.searchParams.get("q") ?? "").slice(0, 80));
  if (q.length < 3) return NextResponse.json({ municipios: [] });
  const lista = await municipiosIbge();
  if (!lista) return NextResponse.json({ municipios: [], error: "O IBGE não respondeu agora." }, { status: 502 });
  const achados = lista
    .map((m) => ({ ...m, chave: norm(m.nome) }))
    .filter((m) => m.chave.includes(q))
    .sort((a, b) => Number(!a.chave.startsWith(q)) - Number(!b.chave.startsWith(q)) || a.chave.length - b.chave.length)
    .slice(0, 6)
    .map(({ cod_ibge, nome, uf }) => ({ cod: cod_ibge, nome, uf }));
  return NextResponse.json({ municipios: achados }, { headers: cache });
}
