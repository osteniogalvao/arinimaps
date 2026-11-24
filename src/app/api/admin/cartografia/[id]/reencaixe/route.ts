import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { ator, temSetor } from "@/lib/authz";
import { falha, falhaBanco } from "@/lib/erros";
import { conferirOrigem, respostaOrigemNegada } from "@/lib/seguranca/origem";

/**
 * Reencaixa TODOS os anúncios de lote do município nos lotes desta planta.
 * Para quando a planta oficial entra no lugar da provisória: a geração de
 * lotes já reencaixa os anúncios órfãos sozinha; o botão força a conferência
 * de todos, inclusive os que ainda apontam para lotes da planta antiga.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/admin/cartografia/[id]/reencaixe">) {
  const { id } = await ctx.params;
  const origem = conferirOrigem(request);
  if (!origem.ok) return respostaOrigemNegada(origem.motivo);
  const a = await ator();
  if (!a || a.somenteLeitura || !temSetor(a, "cartografia")) {
    return falha(403, "sem_permissao", "Restrito à equipe da Arini.", {
      solucao: "Entre com uma conta da Arini com acesso à cartografia.",
    });
  }
  const { data, error } = await supabaseAdmin().rpc("fn_reencaixar_anuncios", {
    p_layer_id: id, p_todos: true, p_user_id: a.userId,
  });
  if (error) return falhaBanco("reencaixe_falhou", error);

  await logAudit({
    user_id: a.userId, acao: "anuncios_reencaixados",
    entidade: "cartography_layers", entidade_id: id, dados_depois: data,
  });
  return NextResponse.json(data);
}
