import "server-only";
import { NextResponse } from "next/server";
import { ipDoPedido, respostaLimite, type Limite } from "@/lib/seguranca/limite";
import { bloqueioAtivo, COOKIE_BLOQUEIO, fichaDeAcesso } from "@/lib/seguranca/bloqueio";

/**
 * Limite de requisições das LEITURAS DO MAPA (tiles e /api/geo), por IP, em
 * memória do processo (roadmap 6.14).
 *
 * POR QUE NÃO O `limitar()` DO BANCO. Uma tela de mapa pede de 20 a 60 tiles a
 * cada movimento, e um usuário navegando faz centenas por minuto. Contar cada
 * um no banco (`fn_rate_limit`) colocaria uma ida e volta ao Postgres na frente
 * de cada tile — dobraria a latência e o limite viraria o gargalo que ele
 * deveria evitar. Aqui a conta é um Map no processo: custo de microssegundos.
 *
 * O PREÇO. Cada instância do servidor conta separado e o contador zera no
 * reinício. Para leitura de mapa isso é aceitável: o objetivo é cortar robô
 * raspando a malha inteira, não contabilidade exata. O limite do banco
 * continua nos endpoints caros (login, cadastro, consulta de área), onde uma
 * ida ao banco a mais não pesa e a precisão importa.
 *
 * JANELA DESLIZANTE APROXIMADA. Dois baldes fixos (o atual e o anterior); a
 * contagem é atual + anterior × fração da janela anterior que ainda vale. É o
 * esquema clássico de limitador de borda: memória constante por IP e sem a
 * rajada dupla na virada de uma janela fixa.
 *
 * Os tetos ficam muito acima do uso normal: cada movimento do mapa pede algumas
 * dezenas de tiles (CAR + lotes), então 3.000 em 5 minutos são mais de uma
 * centena de movimentos sem parar — e o navegador ainda guarda tile em cache.
 */
type Balde = { inicio: number; atual: number; anterior: number };

const MAX_CHAVES = 50_000;
const baldes = new Map<string, Balde>();
let ultimaLimpeza = Date.now();

export const LIMITES_MAPA = {
  tiles: { max: 3000, janelaS: 300 },
  geo: { max: 600, janelaS: 300 },
} as const;

/** Conta mais uma requisição para a chave e diz se ainda pode. */
export function limitarEmMemoria(chave: string, max: number, janelaS: number, agora = Date.now()): Limite {
  const janela = janelaS * 1000;
  limpar(agora, janela);
  let b = baldes.get(chave);
  if (!b) {
    if (baldes.size >= MAX_CHAVES) baldes.delete(baldes.keys().next().value as string);
    b = { inicio: agora - (agora % janela), atual: 0, anterior: 0 };
    baldes.set(chave, b);
  }
  const inicioAtual = agora - (agora % janela);
  if (inicioAtual !== b.inicio) {
    // virou a janela: o atual vira anterior (ou zera, se ficou mais de uma janela parado)
    b.anterior = inicioAtual - b.inicio === janela ? b.atual : 0;
    b.atual = 0;
    b.inicio = inicioAtual;
  }
  const pesoAnterior = 1 - (agora - b.inicio) / janela;
  const estimado = b.atual + b.anterior * pesoAnterior;
  if (estimado >= max) {
    return { permitido: false, restante: 0, liberaEm: new Date(b.inicio + janela) };
  }
  b.atual++;
  return { permitido: true, restante: Math.max(0, Math.floor(max - estimado - 1)), liberaEm: null };
}

function limpar(agora: number, janela: number) {
  if (agora - ultimaLimpeza < 60_000) return;
  ultimaLimpeza = agora;
  for (const [k, b] of baldes) if (agora - b.inicio > 2 * janela) baldes.delete(k);
}

/**
 * Atalho para as rotas do mapa: devolve a resposta pronta quando o pedido não
 * pode seguir, ou null para seguir. Duas travas, nesta ordem:
 *
 * 1. SITE_SENHA (src/lib/seguranca/bloqueio.ts). `api/geo` e `api/tiles` ficam
 *    fora do matcher do proxy (desempenho do zoom), então a trava do site
 *    inteiro precisa ser conferida aqui também. A ficha esperada (HMAC da senha)
 *    é calculada uma vez por processo; cada pedido só lê o cookie e compara.
 * 2. Limite por IP em memória (acima).
 */
export async function limiteLeituraMapa(request: Request, tipo: keyof typeof LIMITES_MAPA) {
  if (bloqueioAtivo() && !(await acessoLiberado(request))) {
    return NextResponse.json({ error: "Site em acesso restrito." }, { status: 401 });
  }
  const { max, janelaS } = LIMITES_MAPA[tipo];
  const l = limitarEmMemoria(`${tipo}:${ipDoPedido(request)}`, max, janelaS);
  return l.permitido ? null : respostaLimite(l, "leitura do mapa");
}

// ficha guardada por senha: trocar a SITE_SENHA (novo deploy/reinício) recalcula
let fichaCache: { senha: string; ficha: Promise<string> } | null = null;

async function acessoLiberado(request: Request) {
  const valor = lerCookie(request.headers.get("cookie"), COOKIE_BLOQUEIO);
  if (!valor) return false;
  const senha = process.env.SITE_SENHA ?? "";
  if (!fichaCache || fichaCache.senha !== senha) fichaCache = { senha, ficha: fichaDeAcesso() };
  const certa = await fichaCache.ficha;
  if (valor.length !== certa.length) return false;
  let d = 0;
  for (let i = 0; i < valor.length; i++) d |= valor.charCodeAt(i) ^ certa.charCodeAt(i);
  return d === 0;
}

function lerCookie(cabecalho: string | null, nome: string) {
  if (!cabecalho) return undefined;
  for (const parte of cabecalho.split(";")) {
    const i = parte.indexOf("=");
    if (i > 0 && parte.slice(0, i).trim() === nome) {
      try { return decodeURIComponent(parte.slice(i + 1).trim()); } catch { return undefined; }
    }
  }
  return undefined;
}

/** Só para teste: zera os contadores. */
export function _zerarLimitesMapa() {
  baldes.clear();
}
