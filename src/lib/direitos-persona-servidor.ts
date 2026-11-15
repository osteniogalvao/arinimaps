import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ITENS_POR_RECURSO, permiteItem, personaDaMatriz, type NivelItem } from "@/lib/direitos-persona";
import { montarAcesso, type Plano, type RecursoId } from "@/lib/planos";

/** Direitos da sessão ativa, incluídos os ajustes vigentes do plano. */
export async function acessoComMatriz(role: string, plano: Plano | null, nicho: string | null,
  validoAte: string | null, entrada: string | null, userId?: string) {
  const acesso = montarAcesso(role, plano, nicho, validoAte);
  const persona = personaDaMatriz(nicho, entrada);
  // Contas legadas de consulta e de franquia têm catálogo próprio.
  if (!persona || acesso.equipe) return acesso;

  const itens = Object.entries(ITENS_POR_RECURSO);
  const planoVigente = plano?.ativo && !acesso.vencido ? plano : null;
  const { data, error } = await supabaseAdmin().rpc("fn_niveis_itens_persona", {
    p_persona: persona, p_plano: planoVigente?.id ?? null, p_itens: itens.map(([, d]) => d.id),
  });
  if (error) console.error("Falha ao consultar a matriz de direitos", error.code);
  const niveis = new Map((data as NivelItem[] | null)?.map(n => [n.id, n]));
  const habilitaveis = planoVigente && montarAcesso(role, {
    ...planoVigente, recursos: [...planoVigente.recursos, ...itens.map(([r]) => r)],
  }, nicho, validoAte).recursos;
  const ia = niveis.get(ITENS_POR_RECURSO.chat_ia!.id);
  let creditoAvulso = false;
  if (userId && permiteItem(ia, "operar", true) && !acesso.recursos.has("chat_ia")) {
    const { data: lote } = await supabaseAdmin().from("ari_lotes").select("id")
      .eq("titular", userId).eq("nicho", nicho ?? "").in("carteira", ["compra", "cortesia"])
      .eq("bloqueado", false).gt("validade", new Date().toISOString()).gt("saldo", 0).limit(1);
    creditoAvulso = !!lote?.length;
  }
  const franquia = Number(planoVigente?.cotas?.creditos_ari_mes ?? 0) > 0;
  for (const [nome, d] of itens) {
    const recurso = nome as RecursoId;
    const nivel = niveis.get(d.id);
    const carteira = recurso === "chat_ia" && (creditoAvulso || franquia);
    const contratado = !!planoVigente?.recursos.includes(recurso) || carteira;
    if (!permiteItem(nivel, d.acao, contratado)) acesso.recursos.delete(recurso);
    else if (carteira || (nivel?.liberado === true && habilitaveis?.has(recurso))) acesso.recursos.add(recurso);
  }
  for (const comum of ["mapa", "ficha_basica", "interesse"]) acesso.recursos.add(comum);
  return acesso;
}
