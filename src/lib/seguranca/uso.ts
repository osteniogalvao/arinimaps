import "server-only";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { lerConfiguracoes, numero } from "@/lib/settings";
import { ipDoPedido, limitar, respostaLimite } from "@/lib/seguranca/limite";
import type { Acesso } from "@/lib/planos";

/**
 * Limites de uso por assinatura (áudio do Carlos, 26/11/2026 22h39, e tabela
 * do Stenio). Dois níveis:
 *  · trava contra robô, igual para todos: consultas por minuto;
 *  · limite "bom" do plano: consultas por dia, downloads de KML/KMZ por mês e
 *    aparelhos ao mesmo tempo. Cada plano pode ter a sua cota (Admin > Planos);
 *    sem cota no plano, vale o padrão de Configurações > Segurança.
 *
 * A equipe da Matriz não entra em nenhum deles. Se o banco falhar (ou a
 * migration 0175 ainda não tiver rodado), a ação PASSA: limite é proteção
 * contra abuso, não pode travar o uso normal.
 */

export type LimitesUso = { consultasMinuto: number; consultasDia: number; downloadsMes: number; aparelhos: number };

export async function limitesDeUso(acesso: Acesso): Promise<LimitesUso> {
  const cfg = await lerConfiguracoes();
  const cota = (id: string, padrao: number) => {
    const v = acesso.cotas?.[id];
    return v != null && Number.isFinite(Number(v)) ? Number(v) : padrao;
  };
  return {
    consultasMinuto: numero(cfg, "limite_consultas_minuto", 20),
    consultasDia: cota("consultas_area_dia", numero(cfg, "limite_consultas_dia", 100)),
    downloadsMes: cota("downloads_arquivos_mes", numero(cfg, "limite_downloads_mes", 300)),
    aparelhos: cota("aparelhos_simultaneos", numero(cfg, "limite_aparelhos", 1)),
  };
}

/** Início do dia e do mês no horário de Brasília (UTC−3, sem horário de verão). */
function inicioBrasilia(unidade: "dia" | "mes") {
  const agora = new Date(Date.now() - 3 * 3600_000);
  const d = new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), unidade === "dia" ? agora.getUTCDate() : 1, 3));
  return d;
}

const espera = (ms: number) => {
  const h = Math.ceil(ms / 3600_000);
  return h <= 1 ? "menos de uma hora" : h < 24 ? `${h} horas` : `${Math.ceil(h / 24)} dias`;
};

const respostaUso = (mensagem: string, solucao: string, liberaEm: Date) => {
  const seg = Math.max(60, Math.ceil((liberaEm.getTime() - Date.now()) / 1000));
  return NextResponse.json({ error: mensagem, solucao, codigo: "limite_uso" }, { status: 429, headers: { "Retry-After": String(seg) } });
};

/**
 * Confere as consultas (minuto e dia) antes de uma consulta NOVA. Devolve a
 * resposta 429 pronta ou null. Conta o minuto aqui; o dia é lido do registro
 * `consultas_area_log`, que a consulta grava logo depois.
 */
export async function conferirConsultas(userId: string, acesso: Acesso): Promise<NextResponse | null> {
  if (acesso.equipe) return null;
  const lim = await limitesDeUso(acesso);
  if (lim.consultasMinuto > 0) {
    const r = await limitar(`consulta-min:${userId}`, lim.consultasMinuto, 60);
    if (!r.permitido) return respostaLimite(r, "consulta (mais de " + lim.consultasMinuto + " por minuto)");
  }
  if (lim.consultasDia > 0) {
    const inicio = inicioBrasilia("dia");
    const { count, error } = await supabaseAdmin().from("consultas_area_log")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId).eq("acao", "consulta").gte("created_at", inicio.toISOString());
    if (!error && (count ?? 0) >= lim.consultasDia) {
      const amanha = new Date(inicio.getTime() + 86400_000);
      return respostaUso(
        `Você chegou ao limite de ${lim.consultasDia} consultas por dia${acesso.planNome ? ` do plano ${acesso.planNome}` : ""}.`,
        `A cota volta à meia-noite (horário de Brasília), em ${espera(amanha.getTime() - Date.now())}. Para consultar mais, escolha um plano maior em /planos.`,
        amanha,
      );
    }
  }
  return null;
}

/** Quantos KML/KMZ a conta baixou no mês e quanto o plano permite. */
export async function usoDownloads(userId: string, acesso: Acesso) {
  const lim = await limitesDeUso(acesso);
  const { count, error } = await supabaseAdmin().from("arquivos_baixados_log")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId).gte("created_at", inicioBrasilia("mes").toISOString());
  return { usados: error ? null : count ?? 0, limite: acesso.equipe ? 0 : lim.downloadsMes };
}

/**
 * Registra um download de KML/KMZ, se couber no mês. Devolve a resposta 429
 * pronta ou null (liberado e já contado).
 */
export async function registrarDownload(request: Request, userId: string, acesso: Acesso, formato: "kml" | "kmz", origem: string): Promise<NextResponse | null> {
  const lim = await limitesDeUso(acesso);
  // download em rajada também é robô: o mesmo teto por minuto das consultas
  if (!acesso.equipe && lim.consultasMinuto > 0) {
    const r = await limitar(`download-min:${userId}`, lim.consultasMinuto, 60);
    if (!r.permitido) return respostaLimite(r, "download");
  }
  if (!acesso.equipe && lim.downloadsMes > 0) {
    const { usados } = await usoDownloads(userId, acesso);
    if (usados !== null && usados >= lim.downloadsMes) {
      const inicio = inicioBrasilia("mes");
      const proximo = new Date(Date.UTC(inicio.getUTCFullYear(), inicio.getUTCMonth() + 1, 1, 3));
      return respostaUso(
        `Você chegou ao limite de ${lim.downloadsMes} downloads de KML/KMZ do mês${acesso.planNome ? ` no plano ${acesso.planNome}` : ""}.`,
        "A cota volta no dia 1º. Para baixar mais, escolha um plano maior em /planos.",
        proximo,
      );
    }
  }
  try {
    await supabaseAdmin().from("arquivos_baixados_log").insert({ user_id: userId, formato, origem: origem.slice(0, 60), ip: ipDoPedido(request) });
  } catch { /* registro é best-effort */ }
  return null;
}

// --------------------------------------------------------------- aparelhos

export const COOKIE_APARELHO = "arini_aparelho";
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

export function aparelhoDoPedido(request: Request): string | null {
  const cookie = request.headers.get("cookie") ?? "";
  const m = cookie.match(new RegExp(`(?:^|;\\s*)${COOKIE_APARELHO}=([^;]+)`));
  const v = m ? decodeURIComponent(m[1]) : "";
  return UUID.test(v) ? v : null;
}

/**
 * Situação do aparelho deste pedido na conta:
 *  · "livre"   — regra desligada, equipe, ou o banco não respondeu;
 *  · "ativo"   — este aparelho está entre os permitidos;
 *  · "novo"    — o aparelho ainda não se registrou (precisa entrar);
 *  · "removido"— outro aparelho entrou depois e este saiu da conta.
 */
export async function situacaoAparelho(request: Request, userId: string, acesso: Acesso): Promise<"livre" | "ativo" | "novo" | "removido"> {
  if (acesso.equipe) return "livre";
  const lim = await limitesDeUso(acesso);
  if (lim.aparelhos <= 0) return "livre";
  const aparelho = aparelhoDoPedido(request);
  if (!aparelho) return "novo";
  const { data, error } = await supabaseAdmin().from("aparelhos_ativos")
    .select("aparelho").eq("user_id", userId).eq("aparelho", aparelho).maybeSingle();
  if (error) return "livre";
  return data ? "ativo" : "removido";
}

/** Registra este aparelho como o mais novo da conta (os mais antigos além do limite saem). */
export async function entrarComAparelho(request: Request, userId: string, acesso: Acesso, aparelho: string) {
  const lim = await limitesDeUso(acesso);
  await supabaseAdmin().rpc("fn_aparelho_entrar", {
    p_user: userId, p_aparelho: aparelho, p_max: acesso.equipe ? 0 : lim.aparelhos,
    p_ua: request.headers.get("user-agent") ?? "", p_ip: ipDoPedido(request),
  });
}

/** Para rotas sensíveis: 409 quando outro aparelho entrou na conta depois deste. */
export async function exigirAparelhoAtivo(request: Request, userId: string, acesso: Acesso): Promise<NextResponse | null> {
  const s = await situacaoAparelho(request, userId, acesso);
  if (s !== "removido") return null;
  return NextResponse.json({
    error: "Sua conta foi aberta em outro aparelho e este foi desconectado.",
    solucao: "Entre de novo para continuar aqui. O plano permite um aparelho por vez.",
    codigo: "outro_aparelho",
  }, { status: 409 });
}
