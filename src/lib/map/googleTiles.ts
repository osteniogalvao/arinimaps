import "server-only";

/**
 * SATÉLITE DO GOOGLE (Map Tiles API, 2D), decidido pelo Stenio em 25/11/2026
 * depois da comparação Esri × Mapbox × Google em Iturama e União de Minas
 * (project-files/arini/satelites-pagos-2026-11-25): só o Google mostra lote,
 * telhado e carro com nitidez no z19–z20.
 *
 * O Google vale para TODOS os zooms do modo satélite. Os termos do Google Maps
 * Platform (3.2.3(e), "No Use With Non-Google Maps") proíbem usar o mapa do
 * Google "com ou perto de" um mapa de outra empresa, então não misturamos
 * Esri de longe e Google de perto, nem tile de reserva de outra fonte.
 *
 * COMO FUNCIONA. O servidor cria a sessão (POST createSession, vale ~2 semanas)
 * e guarda em memória. O mapa pede /api/satelite/google/{z}/{x}/{y}; a rota
 * responde 302 para o tile no Google, com a sessão e a chave. O navegador baixa
 * direto do Google (o servidor não guarda nem repassa a imagem: os termos
 * proíbem cache de tile fora do cabeçalho que o Google manda).
 *
 * A chave vai no endereço do tile, como qualquer chave de mapa no navegador.
 * Restrinja-a no Google Cloud: só a Map Tiles API e só os domínios do site
 * (referenciadores HTTP). A sessão é criada daqui com o Referer do site, para
 * passar na mesma restrição.
 *
 * TETO DE GASTO. Dois níveis: (1) a cota diária da Map Tiles API no Google
 * Cloud, que é o teto de verdade; (2) GOOGLE_TILES_LIMITE_DIA aqui, contado por
 * processo (zera à meia-noite e no reinício). Passou do teto, a rota responde
 * 429 e o mapa fica sem foto até o dia seguinte; a base de ruas continua.
 */

const CHAVE = process.env.GOOGLE_MAPS_TILES_KEY?.trim() || "";
const SITE = (process.env.NEXT_PUBLIC_SITE_URL || "https://arinibrasil.com.br").replace(/\/+$/, "") + "/";
const LIMITE_DIA = Number(process.env.GOOGLE_TILES_LIMITE_DIA) || 20_000;

export const googleConfigurado = () => !!CHAVE;

let sessao: { id: string; expira: number } | null = null;
let pedindo: Promise<string> | null = null;

async function criarSessao(): Promise<string> {
  const resposta = await fetch(`https://tile.googleapis.com/v1/createSession?key=${encodeURIComponent(CHAVE)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Referer: SITE },
    // 512 px por tile (alta densidade) pelo mesmo preço de um tile: nítido em
    // tela retina sem pedir 4× mais tiles.
    body: JSON.stringify({ mapType: "satellite", language: "pt-BR", region: "BR", scale: "scaleFactor2x", highDpi: true }),
    signal: AbortSignal.timeout(8000),
  });
  if (!resposta.ok) throw new Error(`createSession ${resposta.status}`);
  const dados = (await resposta.json()) as { session?: string; expiry?: string };
  if (!dados.session) throw new Error("createSession sem sessão");
  // renova um dia antes de vencer
  const expira = (Number(dados.expiry) || Date.now() / 1000 + 86_400) * 1000 - 86_400_000;
  sessao = { id: dados.session, expira };
  return dados.session;
}

export async function sessaoGoogle(): Promise<string> {
  if (sessao && sessao.expira > Date.now()) return sessao.id;
  pedindo ??= criarSessao().finally(() => { pedindo = null; });
  return pedindo;
}

let dia = "";
let usados = 0;

/** Conta um tile no dia; false quando passou do teto. */
export function cabeNoLimiteDoDia(): boolean {
  const hoje = new Date().toISOString().slice(0, 10);
  if (hoje !== dia) { dia = hoje; usados = 0; }
  usados += 1;
  return usados <= LIMITE_DIA;
}

export async function urlTileGoogle(z: number, x: number, y: number): Promise<string> {
  const id = await sessaoGoogle();
  return `https://tile.googleapis.com/v1/2dtiles/${z}/${x}/${y}?session=${encodeURIComponent(id)}&key=${encodeURIComponent(CHAVE)}`;
}

/** Crédito das imagens na área da tela (exigido pelos termos). */
export async function creditosGoogle(zoom: number, norte: number, sul: number, leste: number, oeste: number): Promise<string> {
  const id = await sessaoGoogle();
  const q = new URLSearchParams({
    session: id, key: CHAVE, zoom: String(zoom),
    north: String(norte), south: String(sul), east: String(leste), west: String(oeste),
  });
  const resposta = await fetch(`https://tile.googleapis.com/tile/v1/viewport?${q}`, {
    headers: { Referer: SITE }, signal: AbortSignal.timeout(6000),
  });
  if (!resposta.ok) throw new Error(`viewport ${resposta.status}`);
  const dados = (await resposta.json()) as { copyright?: string };
  return dados.copyright ?? "";
}
