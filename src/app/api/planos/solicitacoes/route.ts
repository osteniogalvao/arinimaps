import { ator } from "@/lib/authz";
import { PLANOS_CATALOGO, comPrecoVigente, cotarPlano } from "@/lib/planos-catalogo";
import { limitar, respostaLimite } from "@/lib/seguranca/limite";
import { corpoPedido, ehUuid, erroPedido, falha, listarPedidos, mudarPedido, selecaoDoCorpo } from "@/lib/solicitacoes-planos-servidor";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { contratarDireto } from "@/lib/contratacao-direta";

export async function GET(req: Request) {
  const a = await ator();
  if (!a) return falha("Entre na sua conta para consultar seus pedidos.", 401);
  return listarPedidos(req, a.userId);
}

export async function POST(req: Request) {
  const a = await ator();
  if (!a) return falha("Entre na sua conta para solicitar um plano.", 401);
  const chave = req.headers.get("Idempotency-Key");
  if (!ehUuid(chave)) return falha("Chave de solicitação inválida.", 400);
  const body = await corpoPedido(req);
  const selecao = body && selecaoDoCorpo(body);
  if (!selecao) return falha("Seleção de plano inválida.", 400);
  let cotacao: ReturnType<typeof cotarPlano>;
  const modelo = PLANOS_CATALOGO.find((p) => p.id === selecao.planoId);
  if (!modelo) return falha("Plano desconhecido.", 400);
  // Rejeita complementos e quantidades inválidos antes de consultar o banco.
  try { cotarPlano({ ...selecao, ciclo: "mensal" }); } catch (e) {
    return falha(e instanceof Error ? e.message : "Seleção inválida.", 400);
  }
  const { data: preco, error: erroPreco } = await supabaseAdmin().from("plans")
    .select("id,preco_mensal,preco_anual_centavos,primeiro_mes_centavos").eq("id", modelo.id).eq("ativo", true).maybeSingle();
  if (erroPreco) return falha("A tabela de preços está indisponível.", 503);
  if (!preco) return falha("Este plano está indisponível.", 409);
  try { cotacao = cotarPlano(selecao, [comPrecoVigente(modelo, preco)]); } catch (e) {
    return falha(e instanceof Error ? e.message : "Seleção de plano inválida.", 400);
  }
  const limite = await limitar("solicitacao-plano:" + a.userId, 30, 3600);
  if (!limite.permitido) return respostaLimite(limite, "solicitar um plano");
  const { data, error } = await supabaseAdmin().rpc("fn_solicitar_plano", {
    p_user_id: a.userId, p_chave: chave, p_selecao: selecao, p_cotacao: cotacao,
  }).select("id,status,selecao,cotacao,created_at,updated_at").single();
  if (error) return erroPedido(error.code);
  // Contratação direta (23/11/2026): com o aceite marcado na página do plano,
  // a proposta é liberada e a fatura sai na hora. Senão, segue para a Central.
  if (body.contratar === true && body.aceito === true && !cotacao.sobOrcamento) {
    const direto = await contratarDireto(a.userId, data.id);
    return Response.json({ solicitacao: data, ...direto });
  }
  return Response.json({ solicitacao: data });
}

export async function PATCH(req: Request) {
  const a = await ator();
  if (!a) return falha("Entre na sua conta para cancelar o pedido.", 401);
  return mudarPedido(req, a.userId, false);
}
