import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { lerConfiguracoes, numero } from "@/lib/settings";
import { medirRelevo } from "@/lib/avaliacao/terreno";
import {
  avaliarAptidao, preAvaliar, METODOLOGIA_VERSAO,
  type Alvo, type Comparavel, type Incidencia, type ResultadoAptidao, type ResultadoPreAvaliacao,
} from "@/lib/avaliacao/metodologia";

/**
 * Junta os dados (banco + modelo de elevação), chama a metodologia pura e
 * grava cada resultado em `avaliacoes` com entradas, saídas e versão.
 * Nunca dispara consulta nova às fontes oficiais: usa só o que já foi
 * consultado (consultas_rurais do imóvel ou consultas_area do CAR vinculado).
 */

export type Contexto = { alvo: Alvo; comparaveis: Comparavel[] };

export async function carregarContexto(propertyId: string, raioKm: number): Promise<Contexto | null> {
  const { data, error } = await supabaseAdmin().rpc("fn_avaliacao_contexto", { p_property_id: propertyId, p_raio_km: raioKm });
  if (error) throw new Error(error.message);
  const ctx = data as { alvo: Alvo | null; comparaveis: Comparavel[] } | null;
  if (!ctx?.alvo) return null;
  return { alvo: ctx.alvo, comparaveis: ctx.comparaveis ?? [] };
}

/** Incidências já consultadas: as do imóvel e, se houver CAR vinculado, as da área do CAR. A mais recente por fonte vence. */
export async function incidenciasJaConsultadas(alvo: Alvo): Promise<{ incidencias: Incidencia[]; fontesInativas: string[] }> {
  const admin = supabaseAdmin();
  const [{ data: rurais }, { data: area }, { data: fontes }] = await Promise.all([
    admin.from("consultas_rurais").select("fonte_id, incide, quantidade, erro, consultado_em, resultado").eq("property_id", alvo.id).eq("raio_m", 0),
    alvo.car_codigo
      ? admin.from("consultas_area").select("fonte_id, incide, quantidade, erro, consultado_em, resultado").eq("chave", `car:${alvo.car_codigo}`).eq("raio_m", 0)
      : Promise.resolve({ data: [] as never[] }),
    admin.from("fontes_externas").select("id, nome, ativa"),
  ]);
  const nome = new Map((fontes ?? []).map((f) => [f.id as string, f.nome as string]));
  const porFonte = new Map<string, Incidencia>();
  for (const r of [...(rurais ?? []), ...(area ?? [])] as {
    fonte_id: string; incide: boolean | null; quantidade: number | null; erro: string | null; consultado_em: string | null;
    resultado: { itens?: { titulo: string; detalhe?: string }[] } | null;
  }[]) {
    const atual = porFonte.get(r.fonte_id);
    if (atual && String(atual.consultado_em) >= String(r.consultado_em)) continue;
    porFonte.set(r.fonte_id, {
      fonte_id: r.fonte_id, nome: nome.get(r.fonte_id) ?? r.fonte_id,
      incide: r.erro ? null : r.incide, quantidade: r.quantidade, erro: r.erro, consultado_em: r.consultado_em,
      itens: (r.resultado?.itens ?? []).slice(0, 5).map((i) => ({ titulo: String(i.titulo ?? ""), detalhe: i.detalhe ? String(i.detalhe) : undefined })),
    });
  }
  return {
    incidencias: [...porFonte.values()],
    fontesInativas: (fontes ?? []).filter((f) => !f.ativa).map((f) => f.id as string),
  };
}

export type ResultadoAvaliacao = {
  pre_avaliacao?: ResultadoPreAvaliacao & { id: string };
  aptidao?: (ResultadoAptidao & { id: string }) | { indisponivel: string };
};

export async function avaliarImovel(propertyId: string, userId: string | null, quer: { pre: boolean; aptidao: boolean }): Promise<ResultadoAvaliacao | null> {
  const cfg = await lerConfiguracoes();
  const minComparaveis = numero(cfg, "pre_avaliacao_min_comparaveis", 5);
  const raioKm = numero(cfg, "pre_avaliacao_raio_km", 60);
  const ctx = await carregarContexto(propertyId, raioKm);
  if (!ctx) return null;
  const { alvo, comparaveis } = ctx;
  const { incidencias, fontesInativas } = await incidenciasJaConsultadas(alvo);
  const admin = supabaseAdmin();
  const saida: ResultadoAvaliacao = {};

  // o que entra na trilha: o imóvel como estava, os comparáveis e as incidências (sem a geometria inteira)
  const entradasBase = {
    alvo: { ...alvo, geometria: alvo.geometria ? { type: alvo.geometria.type } : null },
    incidencias: incidencias.map((i) => ({ fonte_id: i.fonte_id, incide: i.incide, quantidade: i.quantidade, consultado_em: i.consultado_em })),
  };

  if (quer.pre) {
    const r = preAvaliar(alvo, comparaveis, incidencias, { minComparaveis });
    const { data } = await admin.from("avaliacoes").insert({
      property_id: propertyId, user_id: userId, tipo: "pre_avaliacao", metodologia_versao: METODOLOGIA_VERSAO,
      entradas: { ...entradasBase, comparaveis, parametros: { minComparaveis, raioKm } }, resultado: r,
    }).select("id").single();
    saida.pre_avaliacao = { ...r, id: data?.id ?? "" };
  }

  if (quer.aptidao) {
    if (alvo.tipo !== "rural") {
      saida.aptidao = { indisponivel: "A aptidão territorial vale só para imóveis rurais." };
    } else {
      const relevo = await medirRelevo(alvo.geometria);
      const r = avaliarAptidao(alvo, relevo, incidencias, fontesInativas);
      const { data } = await admin.from("avaliacoes").insert({
        property_id: propertyId, user_id: userId, tipo: "aptidao", metodologia_versao: METODOLOGIA_VERSAO,
        entradas: { ...entradasBase, fontes_inativas: fontesInativas }, resultado: r,
      }).select("id").single();
      saida.aptidao = { ...r, id: data?.id ?? "" };
    }
  }
  return saida;
}

/** Para quem não é da equipe: tira o detalhe por comparável (valores de venda são dado de negociação). */
export function versaoPublica(r: ResultadoAvaliacao): ResultadoAvaliacao {
  if (r.pre_avaliacao?.situacao === "estimado") {
    return { ...r, pre_avaliacao: { ...r.pre_avaliacao, detalhe: [] } };
  }
  return r;
}
