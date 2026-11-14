import { ator, temSetor } from "@/lib/authz";
import { falha, listarPedidos, mudarPedido } from "@/lib/solicitacoes-planos-servidor";

export async function GET(req: Request) {
  const a = await ator();
  if (!a) return falha("Entre na sua conta.", 401);
  if (!temSetor(a, "financeiro", "diretoria")) return falha("Acesso restrito à Diretoria e ao Financeiro.", 403);
  return listarPedidos(req, null);
}

export async function PATCH(req: Request) {
  const a = await ator();
  if (!a) return falha("Entre na sua conta.", 401);
  if (!temSetor(a, "financeiro", "diretoria")) return falha("Acesso restrito à Diretoria e ao Financeiro.", 403);
  return mudarPedido(req, a.userId, true);
}
