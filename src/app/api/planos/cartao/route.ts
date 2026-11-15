import { ator } from "@/lib/authz";
import { asaasBuscarCobranca } from "@/lib/asaas";
import { conferirCartao, mesmaCobranca } from "@/lib/assinatura-cartao";
import { checkoutAtivo } from "@/lib/assinaturas-cotadas";
import { limitar, respostaLimite } from "@/lib/seguranca/limite";
import { corpoPedido, ehUuid, falha } from "@/lib/solicitacoes-planos-servidor";
import { supabaseAdmin } from "@/lib/supabase/admin";

export async function POST(req: Request) {
  const a = await ator();
  if (!a) return falha("Entre para gerenciar o cartão.", 401);
  const limite = await limitar("cartao-assinatura:" + a.userId, 12, 300);
  if (!limite.permitido) return respostaLimite(limite, "operações");
  const dados = await corpoPedido(req);
  if (!dados || !ehUuid(dados.id) || !["autorizar","revogar","conferir"].includes(String(dados.acao)))
    return falha("Operação inválida.", 400);
  const db = supabaseAdmin();
  const {data: s, error} = await db.from("assinaturas_cotadas").select("id,titular,nicho,plano,ciclo,recorrente,adicionais,cliente,aceite,cancelado")
    .eq("id", dados.id).eq("titular", a.userId).maybeSingle();
  if (error) return falha("Não foi possível consultar a assinatura.", 503);
  if (!s) return falha("Assinatura indisponível.", 404);
  const revogar = dados.acao === "revogar";
  if (!revogar && (!s.aceite || s.cancelado || s.nicho !== a.nicho || !s.cliente))
    return falha("Confira o perfil e a assinatura vigente.", 409);
  if (!revogar && !checkoutAtivo()) return falha("O Asaas está indisponível.", 503);
  try {
    if (dados.acao === "conferir") {
      const ativo = await conferirCartao(s.id, s.cliente);
      return Response.json({mensagem: ativo ? "Cartão confirmado para as próximas renovações." :
        "Confira o pagamento da fatura escolhida. O Asaas precisa confirmar o cartão informado e permitir sua reutilização."});
    }
    if (!revogar) {
      if (dados.aceito !== true || typeof dados.final !== "string" || !/^\d{4}$/.test(dados.final) || !ehUuid(dados.origem))
        return falha("Informe os quatro últimos dígitos e autorize a renovação.", 400);
      if (s.plano !== dados.plano || s.ciclo !== dados.ciclo || s.recorrente !== dados.recorrente || s.adicionais !== dados.adicionais)
        return falha("Os valores da proposta mudaram. Atualize a página.", 409);
      const {data: f, error: erroFatura} = await db.from("faturas_cotadas").select("id,valor,pagamento")
        .eq("id", dados.origem).eq("assinatura", s.id).eq("componente", "plano").eq("status","aberta").is("operacao", null).maybeSingle();
      if (erroFatura) throw Error();
      const c = f?.pagamento ? await asaasBuscarCobranca(f.pagamento) : null;
      if (!f || !mesmaCobranca(c, f, s.cliente) || c?.status !== "PENDING")
        return falha("Escolha uma fatura do plano que ainda aguarde pagamento.", 409);
    }
    const r = await db.rpc("assinatura_autorizar_cartao", {
      p_titular:a.userId, p_id:s.id, p_origem:revogar ? null : dados.origem, p_final:revogar ? null : dados.final,
      p_plano:s.plano, p_ciclo:s.ciclo, p_recorrente:s.recorrente, p_adicionais:s.adicionais,
    });
    if (r.error) return falha("A assinatura mudou. Atualize os dados antes de continuar.", 409);
    return Response.json({mensagem: revogar ? "Autorização revogada para as próximas cobranças." :
      "Autorização registrada. Pague a fatura escolhida com esse cartão no Asaas."});
  } catch { return falha("Não foi possível conferir a operação com o Asaas. Tente novamente.", 503); }
}
