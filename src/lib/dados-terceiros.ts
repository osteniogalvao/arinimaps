import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { acessoAtual } from "@/lib/planos-servidor";
import type { Acesso } from "@/lib/planos";

/**
 * Pedido de 18/11/2026: visitante e conta gratuita veem só os imóveis à venda.
 * Área do CAR ou lote urbano sem anúncio é "imóvel de terceiro" e não mostra
 * dado nenhum (área, matrícula, ambiental, medidas) a quem não tem o recurso
 * `dados_terceiros` no plano. A Matriz vê tudo.
 *
 * Exceções, para não travar o próprio dono:
 *  · área com anúncio ativo (aí o caminho é a ficha do imóvel);
 *  · CAR guardado no cofre da própria conta;
 *  · CAR de um imóvel que a conta anunciou (qualquer status).
 */
export const temDadosTerceiros = (a: Acesso | null | undefined) => !!a && (a.equipe || a.recursos.has("dados_terceiros"));

export type AlvoTerceiro = { car?: string | null; lote?: string | null };

/** Código do anúncio ativo da área, quando ela está à venda. */
export async function anuncioDaArea(alvo: AlvoTerceiro): Promise<string | null> {
  const admin = supabaseAdmin();
  if (alvo.car) {
    const { data } = await admin.from("properties").select("codigo").eq("car_codigo", alvo.car)
      .in("status", ["publicado", "em_negociacao"]).limit(1).maybeSingle();
    return (data?.codigo as string | undefined) ?? null;
  }
  if (alvo.lote) {
    const { data } = await admin.rpc("fn_lote", { p_id: alvo.lote });
    return ((data as { properties?: { anuncio?: string | null } } | null)?.properties?.anuncio) ?? null;
  }
  return null;
}

async function areaDaConta(userId: string, car: string) {
  const admin = supabaseAdmin();
  const [{ data: cofre }, { data: anunciado }] = await Promise.all([
    admin.from("cofre_propriedades").select("id").eq("titular_id", userId).ilike("car", car).limit(1),
    admin.from("properties").select("id, owner:owners!inner(profile_id)").eq("car_codigo", car).eq("owner.profile_id", userId).limit(1),
  ]);
  return !!cofre?.length || !!anunciado?.length;
}

/**
 * Pode ver os dados desta área? `true` também quando ela está à venda: o dado
 * do anúncio é público. Devolve o código do anúncio para quem quiser levar à ficha.
 */
export async function podeVerArea(alvo: AlvoTerceiro, sessao?: { userId: string | null; acesso: Acesso }) {
  const { userId, acesso } = sessao ?? await acessoAtual();
  if (temDadosTerceiros(acesso)) return { pode: true, anuncio: null as string | null, userId, acesso };
  const anuncio = await anuncioDaArea(alvo).catch(() => null);
  if (anuncio) return { pode: true, anuncio, userId, acesso };
  if (userId && alvo.car && await areaDaConta(userId, alvo.car).catch(() => false)) return { pode: true, anuncio: null, userId, acesso };
  return { pode: false, anuncio: null, userId, acesso };
}

/** Resposta padrão das rotas quando a área é de terceiro. */
export function respostaTerceiro(logado: boolean) {
  return Response.json({
    error: logado
      ? "Esta área não está à venda. Dados de imóveis de terceiros fazem parte dos planos de consulta."
      : "Esta área não está à venda. Entre com um plano de consulta para ver os dados de imóveis de terceiros.",
    solucao: logado ? "/planos" : "/entrar",
    codigo: "dados_terceiros",
  }, { status: logado ? 403 : 401, headers: { "Cache-Control": "private, no-store" } });
}
