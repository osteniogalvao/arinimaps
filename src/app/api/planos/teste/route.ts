import { ator } from "@/lib/authz";
import { corpoPedido } from "@/lib/solicitacoes-planos-servidor";
import { supabaseAdmin } from "@/lib/supabase/admin";

const ofertas = new Set(["corretor_teste", "produtor_teste", "tecnico_teste", "proprietario_gratuito"]);
const erros: Record<string, [number, string]> = {
  P8101: [403, "perfil_incompativel"],
  P8102: [409, "teste_utilizado"],
  P8103: [409, "plano_protegido"],
  P8104: [409, "plano_indisponivel"],
};

export async function POST(request: Request) {
  const a = await ator();
  if (!a) return Response.json({ error: "Entre na sua conta para ativar o plano.", codigo: "sem_sessao" }, { status: 401 });
  const corpo = await corpoPedido(request);
  if (typeof corpo?.planoId !== "string" || !ofertas.has(corpo.planoId)) {
    return Response.json({ error: "Escolha um dos planos gratuitos disponíveis.", codigo: "plano_invalido" }, { status: 400 });
  }
  const { data, error } = await supabaseAdmin().rpc("fn_ativar_plano_gratuito", { p_titular: a.userId, p_plano: corpo.planoId });
  if (!error) return Response.json(data);
  const esperado = erros[error.code];
  if (esperado) return Response.json({ error: error.message, codigo: esperado[1] }, { status: esperado[0] });
  return Response.json({ error: "Não foi possível confirmar a ativação. Tente novamente.", codigo: "indisponivel" }, { status: 503 });
}
