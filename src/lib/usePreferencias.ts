"use client";

/** Hook das preferências da conta (5.10). Tipos e validação: `preferencias.ts`. */

import { useCallback, useSyncExternalStore } from "react";
import { CHAVE_PREFERENCIAS, PREFERENCIAS_PADRAO, normalizar, type Preferencias } from "@/lib/preferencias";

// ---------------------------------------------------------------------------
// Cliente
// ---------------------------------------------------------------------------

/** O que a rota devolve além das preferências (o cabeçalho usa a foto). */
export type ContaResumo = { nome: string | null; avatar_url: string | null };

type Estado = { prefs: Preferencias; logado: boolean; conta: ContaResumo | null; carregado: boolean };

const EVENTO = "arini:preferencias";
let cache: Estado | null = null;
let pedido: Promise<Estado> | null = null;

function lerLocal(): Preferencias {
  try {
    const s = localStorage.getItem(CHAVE_PREFERENCIAS);
    return normalizar(s ? JSON.parse(s) : {});
  } catch {
    return PREFERENCIAS_PADRAO;
  }
}

function gravarLocal(p: Preferencias) {
  try { localStorage.setItem(CHAVE_PREFERENCIAS, JSON.stringify(p)); } catch { /* storage bloqueado */ }
}

/**
 * Há sessão do Supabase neste navegador? O cookie de sessão não é httpOnly
 * (ver seguranca/cookies.ts) e pode vir em pedaços (`...-auth-token.0`).
 * Sem ele, nem pergunta ao servidor: o visitante gerava um 401 em toda página.
 */
export function temSessao() {
  try {
    return /(?:^|;\s*)sb-[^=]*-auth-token/.test(document.cookie);
  } catch {
    return false;
  }
}

async function carregar(): Promise<Estado> {
  const local = lerLocal();
  if (!temSessao()) return { prefs: local, logado: false, conta: null, carregado: true };
  try {
    const res = await fetch("/api/conta/preferencias", { headers: { Accept: "application/json" } });
    const tipo = res.headers.get("content-type") ?? "";
    if (res.ok && tipo.includes("application/json")) {
      const d = await res.json();
      const prefs = normalizar(d.preferencias);
      gravarLocal(prefs);
      return { prefs, logado: true, conta: { nome: d.nome ?? null, avatar_url: d.avatar_url ?? null }, carregado: true };
    }
  } catch { /* sem rede: fica no que o navegador lembra */ }
  return { prefs: local, logado: false, conta: null, carregado: true };
}

/** Força reler do servidor (ex.: depois de trocar a foto em /conta). */
export function recarregarPreferencias() {
  pedido = carregar().then((e) => {
    cache = e;
    window.dispatchEvent(new CustomEvent(EVENTO));
    return e;
  });
  return pedido;
}

/** Estado do servidor e do primeiro render da hidratação: sempre o mesmo. */
const INICIAL: Estado = { prefs: PREFERENCIAS_PADRAO, logado: false, conta: null, carregado: false };

function assinar(avisar: () => void) {
  window.addEventListener(EVENTO, avisar);
  if (!pedido) {
    pedido = carregar().then((e) => {
      cache = e;
      window.dispatchEvent(new CustomEvent(EVENTO));
      return e;
    });
  }
  return () => window.removeEventListener(EVENTO, avisar);
}

const lerCache = () => cache ?? INICIAL;
const lerServidor = () => INICIAL;

export function usePreferencias() {
  // useSyncExternalStore e não useState(cache): um componente que hidrata
  // depois (Suspense, streaming) pegava o cache já preenchido por outro e
  // renderizava diferente do HTML do servidor (erro #418 intermitente). Na
  // hidratação vale `lerServidor`; depois, o cache compartilhado.
  const estado = useSyncExternalStore(assinar, lerCache, lerServidor);

  const salvar = useCallback(async (parcial: Partial<Preferencias>) => {
    const atual = cache ?? estado;
    const prefs = normalizar({ ...atual.prefs, ...parcial });
    cache = { ...atual, prefs, carregado: true };
    gravarLocal(prefs);
    window.dispatchEvent(new CustomEvent(EVENTO));
    if (!atual.logado) return true;
    try {
      const res = await fetch("/api/conta/preferencias", {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(parcial),
      });
      return res.ok;
    } catch {
      return false;
    }
  }, [estado]);

  return { ...estado, salvar };
}
