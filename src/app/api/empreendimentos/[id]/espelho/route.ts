import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ator } from "@/lib/authz";
import { lerEmpreendimento, podeGerirEmpreendimento } from "@/lib/empreendimento/espelho";
import { validarProjeto } from "@/lib/empreendimento/projeto";
import { limitar, ipDoPedido, respostaLimite } from "@/lib/seguranca/limite";
import { supabaseServer } from "@/lib/supabase/server";

const acoes = ["reservar", "vender", "liberar", "reserva_online", "cancelar_minha"];
const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const erro = (error: string, status: number) => NextResponse.json({ error }, { status });
const privado = { "Cache-Control": "private, no-store", Vary: "Cookie" };
function falhou(code: string) {
  if (code === "42501") return erro("Sua conta não pode realizar esta ação neste lote.", 403);
  if (code === "P0002") return erro("Empreendimento ou lote não encontrado.", 404);
  if (code === "P0001") return erro("O lote ou as condições de reserva mudaram. Confira o espelho atualizado.", 409);
  if (["22023", "22P02", "23514", "22007", "22008", "22003"].includes(code)) return erro("Confira o prazo, o comprador e a negociação informados.", 400);
  return erro("Não foi possível atualizar o espelho agora.", 503);
}

export async function GET(request: Request, ctx: RouteContext<"/api/empreendimentos/[id]/espelho">) {
  const { id } = await ctx.params;
  if (!uuid.test(id)) return erro("Empreendimento inválido.", 400);
  const { data: sessao } = await (await supabaseServer()).auth.getClaims();
  const usuario = sessao?.claims.sub;
  const limite = await limitar("estoque:" + (usuario ?? ipDoPedido(request)), usuario ? 120 : 1200, 60);
  if (!limite.permitido) return respostaLimite(limite, "consulta ao estoque");
  const { data, error } = await supabaseAdmin().rpc("espelho_estoque_publico", { p_emp: id, p_ator: sessao?.claims.sub ?? null });
  if (error) return falhou(error.code);
  if (!data) return erro("Empreendimento não encontrado.", 404);
  return NextResponse.json(data, { headers: privado });
}

const texto = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

export async function POST(request: Request, ctx: RouteContext<"/api/empreendimentos/[id]/espelho">) {
  const { id } = await ctx.params;
  const a = await ator();
  if (!a) return erro("Entre na sua conta para continuar.", 401);
  if (!uuid.test(id)) return erro("Empreendimento inválido.", 400);
  const body = await request.json().catch(() => null);
  if (!body || !acoes.includes(body.acao) || !uuid.test(body.unidade_id) || !("versao" in body)) return erro("Ação ou lote inválido. Atualize a página.", 400);
  const db = supabaseAdmin();
  if (body.acao === "reserva_online") {
    // Uma confirmação repetida da própria reserva não consome a franquia de novas tentativas.
    const {data: minha} = await db.from("property_espelho").select("reserva_ate").eq("property_id", body.unidade_id)
      .eq("empreendimento_id",id).eq("reservado_por",a.userId).eq("status","reservado").gt("reserva_ate",new Date().toISOString()).maybeSingle();
    if (!minha) {
      const ip = ipDoPedido(request);
      const limites = await Promise.all([
        limitar("reservar-lote:conta:" + id + ":" + a.userId, 5, 60),
        ...(ip === "desconhecido" ? [] : [limitar("reservar-lote:ip:" + id + ":" + ip, 30, 60)]),
      ]);
      const esgotado = limites.find(x => !x.permitido);
      if (esgotado) return respostaLimite(esgotado,"nova reserva neste empreendimento");
    }
  }
  const dados = {
    cliente_nome: texto(body.cliente_nome, 160), observacao: texto(body.observacao, 1000),
    valor_venda: Number(body.valor_venda) > 0 ? Math.min(Number(body.valor_venda), 999999999999.99) : null,
    opportunity_id: body.opportunity_id || null,
    reserva_ate: typeof body.reserva_ate === "string" ? body.reserva_ate.slice(0, 10) + "T23:59:59-03:00" : null,
  };
  const { error } = await db.rpc("espelho_mudar_lote", {
    p_emp: id, p_lote: body.unidade_id, p_ator: a.userId, p_acao: body.acao, p_versao: body.versao, p_dados: dados,
  });
  if (error) return falhou(error.code);
  return NextResponse.json({ ok: true }, { headers: privado });
}

export async function PATCH(request: Request, ctx: RouteContext<"/api/empreendimentos/[id]/espelho">) {
  const { id } = await ctx.params;
  const a = await ator();
  if (!a) return erro("Entre na sua conta para continuar.", 401);
  const emp = uuid.test(id) ? await lerEmpreendimento(id) : null;
  if (!emp || !podeGerirEmpreendimento(a, emp)) return erro("Sem acesso ao empreendimento.", 403);
  const body = await request.json().catch(() => null);
  if (!body || typeof body.online !== "boolean" || typeof body.pre !== "boolean" || !("versao" in body)) return erro("Confira os dados da configuração.", 400);
  const horas = body.horas == null ? null : Number(body.horas);
  if ((horas !== null && (!Number.isInteger(horas) || horas < 1 || horas > 2160)) || (body.online && horas === null)) return erro("Defina o prazo entre uma hora e 90 dias.", 400);
  const projeto = validarProjeto(body.projeto);
  if (projeto === false) return erro("Informe um endereço HTTPS válido do projeto 3D ou do visualizador.", 400);
  const { error } = await supabaseAdmin().rpc("espelho_configurar", {
    p_emp: id, p_ator: a.userId, p_online: body.online, p_horas: horas, p_projeto: projeto, p_pre: body.pre, p_versao: body.versao,
  });
  if (error) return falhou(error.code);
  return NextResponse.json({ ok: true });
}
