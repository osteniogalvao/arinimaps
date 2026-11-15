import { ator } from "@/lib/authz";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { corpoPedido, falha } from "@/lib/solicitacoes-planos-servidor";

const texto = (v: unknown, max: number) => typeof v === "string" && v.trim().length > 0 && v.length <= max;
const inteiro = (v: unknown, min: number) =>
  typeof v === "number" && Number.isInteger(v) && v >= min && v <= 2_147_483_647;
const linhas = (v: unknown) => Array.isArray(v) && v.length <= 32 && v.every((x) => texto(x, 240));

export async function PATCH(request: Request) {
  const a = await ator();
  if (!a || a.role !== "admin_central") return falha("Só a diretoria altera ofertas.", a ? 403 : 401);
  const body = await corpoPedido(request);
  if (!body || !texto(body.id, 80) || !inteiro(body.revisao, 1) || !texto(body.nome, 100) ||
      !texto(body.descricao, 600) || typeof body.ativo !== "boolean" ||
      ![body.preco_centavos, body.anual_centavos].every((v) => v === null || inteiro(v, 0)) ||
      !(body.prazo_dias === null || inteiro(body.prazo_dias, 1)) || !linhas(body.limites) || !linhas(body.detalhes)) {
    return falha("Confira os valores, o prazo e a descrição da oferta.", 400);
  }
  const { id, revisao, nome, descricao, preco_centavos, anual_centavos, prazo_dias, limites, detalhes, ativo } = body;
  const { error, data } = await supabaseAdmin().rpc("fn_editar_oferta_perfil", {
    p_ator: a.userId, p_id: id, p_revisao: revisao,
    p_dados: { nome, descricao, preco_centavos, anual_centavos, prazo_dias, limites, detalhes, ativo },
  });
  if (error?.code === "40001") return falha("Outra pessoa editou esta oferta. Recarregue a lista.", 409);
  if (error?.code === "P0002") return falha("Oferta não encontrada.", 404);
  if (error?.code === "23514") return falha("O preço precisa corresponder à modalidade desta oferta.", 400);
  if (error) return falha("Não foi possível salvar a oferta.", 503);
  return Response.json({ revisao: data });
}
