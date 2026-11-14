import { ator,temSetor } from "@/lib/authz";
import { falha } from "@/lib/erros";
import { corpoPedido,ehUuid } from "@/lib/solicitacoes-planos-servidor";
import { supabaseAdmin } from "@/lib/supabase/admin";

export async function POST(req: Request) {
  const a = await ator();
  if (!a || !temSetor(a,"financeiro","diretoria")) return falha(a ? 403 : 401,"sem_acesso","Operação restrita ao Financeiro e à Diretoria.");
  const dados = await corpoPedido(req);
  if (!dados || !ehUuid(dados.id)) return falha(400,"pedido","Pedido inválido.");
  const { data, error } = await supabaseAdmin().rpc("cofre_conceder_vagas",{p_ator:a.userId,p_pedido:dados.id});
  if (error?.code === "P0002") return falha(404,"pedido","Pedido não encontrado.");
  if (error && ["55000","22023","22003"].includes(error.code)) return falha(409,"pedido","Confira o perfil do titular, as vagas solicitadas e a conclusão do pedido.");
  if (error) return falha(503,"cofre","Não foi possível confirmar a concessão.");
  return Response.json({ concedidas:data });
}
