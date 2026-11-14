import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { SITUACOES_PEDIDO, type SelecaoPedido } from "@/lib/solicitacoes-planos";

const campos = "id,status,selecao,cotacao,created_at,updated_at";
const paginaTamanho = 30;
export const ehUuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(v);
export const falha = (error: string, status: number) => Response.json({ error }, { status });

export function erroPedido(codigo: string) {
  switch (codigo) {
    case "P0002": return falha("Solicitação não encontrada.", 404);
    case "42501": return falha("Acesso negado.", 403);
    case "23505": return falha("Esta chave já foi usada para outra solicitação.", 409);
    case "55000": return falha("A situação do pedido mudou. Atualize a lista.", 409);
    case "22023": return falha("Situação inválida.", 400);
    default: return falha("Pedidos indisponíveis no momento. Tente novamente.", 503);
  }
}

const ehObjeto = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

// Limita também corpos enviados sem Content-Length antes de montar o JSON.
export async function corpoPedido(req: Request): Promise<Record<string, unknown> | null> {
  const reader = req.body?.getReader();
  if (!reader) return null;
  const partes: Uint8Array[] = [];
  try {
    let tamanho = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      tamanho += value.byteLength;
      if (tamanho > 8192) { await reader.cancel(); return null; }
      partes.push(value);
    }
    const v: unknown = JSON.parse(Buffer.concat(partes).toString("utf8"));
    return ehObjeto(v) ? v : null;
  } catch { return null; } finally { reader.releaseLock(); }
}

export function selecaoDoCorpo(v: Record<string, unknown>): SelecaoPedido | null {
  if (typeof v.planoId !== "string" || v.planoId.length > 80 || (v.ciclo !== "mensal" && v.ciclo !== "anual")
      || (v.profissao !== undefined && (typeof v.profissao !== "string" || v.profissao.trim().length > 150))
      || (v.areaTotalHa !== undefined && (typeof v.areaTotalHa !== "number" || !Number.isFinite(v.areaTotalHa) || v.areaTotalHa <= 0))) return null;
  const lista = v.adicionais === undefined ? [] : v.adicionais;
  if (!Array.isArray(lista) || lista.length > 32) return null;
  const adicionais: { id: string; quantidade: number }[] = [];
  for (const item of lista) {
    if (!ehObjeto(item) || typeof item.id !== "string" || item.id.length > 80 ||
        typeof item.quantidade !== "number" || !Number.isSafeInteger(item.quantidade) || item.quantidade < 1) return null;
    adicionais.push({ id: item.id, quantidade: item.quantidade });
  }
  adicionais.sort((a, b) => a.id.localeCompare(b.id, "en"));
  const profissao = typeof v.profissao === "string" ? v.profissao.trim() : "";
  return { planoId: v.planoId, ciclo: v.ciclo, adicionais, ...(profissao ? { profissao } : {}),
    ...(typeof v.areaTotalHa === "number" ? { areaTotalHa: v.areaTotalHa } : {}) };
}

export async function listarPedidos(req: Request, usuario: string | null) {
  const params = new URL(req.url).searchParams;
  const pagina = Number(params.get("pagina") ?? 1);
  const situacao = params.get("status");
  if (!Number.isSafeInteger(pagina) || pagina < 1 || pagina > 1_000_000 ||
      (situacao !== null && !Object.hasOwn(SITUACOES_PEDIDO, situacao))) return falha("Filtro inválido.", 400);
  const inicio = (pagina - 1) * paginaTamanho;
  let consulta = supabaseAdmin().from("solicitacoes_planos")
    .select(usuario ? campos : campos + ",user_id,email_contato,perfil:profiles!solicitacoes_planos_user_id_fkey(nome,telefone),vagas_cofre:cofre_concessoes(quantidade)");
  if (usuario) consulta = consulta.eq("user_id", usuario);
  if (situacao) consulta = consulta.eq("status", situacao);
  const { data, error } = await consulta.order("created_at", { ascending: false })
    .order("id", { ascending: false }).range(inicio, inicio + paginaTamanho);
  if (error) return erroPedido(error.code);
  return Response.json({ solicitacoes: data.slice(0, paginaTamanho), temMais: data.length > paginaTamanho });
}

export async function mudarPedido(req: Request, usuario: string, central: boolean) {
  const body = await corpoPedido(req);
  if (!body || !ehUuid(body.id) || typeof body.status !== "string" ||
      !(central ? ["em_analise", "concluido", "cancelado"] : ["cancelado"]).includes(body.status)) {
    return falha("Informe o pedido e uma situação válida.", 400);
  }
  const { data, error } = await supabaseAdmin().rpc("fn_atualizar_solicitacao_plano", {
    p_ator: usuario, p_id: body.id, p_status: body.status, p_central: central,
  }).select(campos).single();
  return error ? erroPedido(error.code) : Response.json({ solicitacao: data });
}
