import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ator } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import { lerEmpreendimento, podeGerirEmpreendimento } from "@/lib/empreendimento/espelho";
import { STATUS_ESPELHO_LABEL, type StatusEspelho } from "@/lib/empreendimento/tipos";

/** Reserva no máximo por 90 dias; renovar é reservar de novo. */
const RESERVA_MAX_DIAS = 90;
const DESTINO: Record<string, StatusEspelho> = { reservar: "reservado", vender: "vendido", liberar: "disponivel" };
const PERMITIDO_DE: Record<StatusEspelho, StatusEspelho[]> = {
  reservado: ["disponivel", "reservado"],
  vendido: ["disponivel", "reservado"],
  disponivel: ["reservado", "vendido"],
};

const texto = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

/**
 * POST { unidade_id, acao: reservar | vender | liberar, reserva_ate?, cliente_nome?,
 *        opportunity_id?, valor_venda?, observacao? }
 * Muda a situação comercial de um lote do espelho de vendas e registra quem e quando.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/empreendimentos/[id]/espelho">) {
  const { id } = await ctx.params;
  const a = await ator();
  if (!a) return NextResponse.json({ error: "Sessão expirada." }, { status: 401 });
  const emp = await lerEmpreendimento(id);
  if (!emp) return NextResponse.json({ error: "Empreendimento não encontrado." }, { status: 404 });
  if (!podeGerirEmpreendimento(a, emp)) return NextResponse.json({ error: "Sem acesso a este empreendimento." }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const para = DESTINO[body.acao as string];
  if (!para) return NextResponse.json({ error: "Ação inválida." }, { status: 400 });
  if (typeof body.unidade_id !== "string") return NextResponse.json({ error: "Informe o lote." }, { status: 400 });

  const admin = supabaseAdmin();
  const { data: unidade } = await admin.from("properties").select("id, codigo, status")
    .eq("id", body.unidade_id).eq("parent_property_id", emp.id).maybeSingle();
  if (!unidade) return NextResponse.json({ error: "Lote não pertence a este empreendimento." }, { status: 400 });

  const { data: atual, error: erroTabela } = await admin.from("property_espelho")
    .select("status, reserva_ate").eq("property_id", unidade.id).maybeSingle();
  if (erroTabela) {
    return NextResponse.json({ error: "O espelho de vendas ainda não foi ativado (migration 0061)." }, { status: 503 });
  }
  let de: StatusEspelho = (atual?.status as StatusEspelho | undefined)
    ?? (["vendido", "historico"].includes(unidade.status) ? "vendido" : "disponivel");
  if (de === "reservado" && atual?.reserva_ate && new Date(atual.reserva_ate).getTime() < Date.now()) de = "disponivel";
  if (!PERMITIDO_DE[para].includes(de)) {
    return NextResponse.json({ error: `Um lote ${STATUS_ESPELHO_LABEL[de].toLowerCase()} não pode ficar ${STATUS_ESPELHO_LABEL[para].toLowerCase()}. Libere antes.` }, { status: 409 });
  }

  let reservaAte: string | null = null;
  if (para === "reservado") {
    const d = typeof body.reserva_ate === "string" ? new Date(`${body.reserva_ate.slice(0, 10)}T23:59:59-03:00`) : null;
    if (!d || Number.isNaN(d.getTime()) || d.getTime() < Date.now()) {
      return NextResponse.json({ error: "Informe um prazo de reserva a partir de hoje." }, { status: 400 });
    }
    if (d.getTime() > Date.now() + RESERVA_MAX_DIAS * 86400000) {
      return NextResponse.json({ error: `A reserva vale no máximo ${RESERVA_MAX_DIAS} dias.` }, { status: 400 });
    }
    reservaAte = d.toISOString();
  }

  const cliente = para === "disponivel" ? null : texto(body.cliente_nome, 160);
  if (para === "vendido" && !cliente) return NextResponse.json({ error: "Informe o comprador." }, { status: 400 });

  // a negociação ligada tem de ser deste lote
  let opportunityId: string | null = null;
  if (para !== "disponivel" && typeof body.opportunity_id === "string" && body.opportunity_id) {
    const { data: opp } = await admin.from("opportunities").select("id")
      .eq("id", body.opportunity_id).eq("property_id", unidade.id).maybeSingle();
    if (!opp) return NextResponse.json({ error: "A negociação escolhida não é deste lote." }, { status: 400 });
    opportunityId = opp.id;
  }
  const valorVenda = para === "vendido" && Number(body.valor_venda) > 0 ? Math.min(Number(body.valor_venda), 1e12) : null;
  const observacao = texto(body.observacao, 1000);
  const agora = new Date().toISOString();

  const { error } = await admin.from("property_espelho").upsert({
    property_id: unidade.id, empreendimento_id: emp.id, status: para,
    reserva_ate: reservaAte, cliente_nome: cliente, opportunity_id: opportunityId,
    valor_venda: valorVenda, observacao, alterado_por: a.userId, alterado_em: agora,
  }, { onConflict: "property_id" });
  if (error) return NextResponse.json({ error: "Não foi possível salvar. Tente de novo." }, { status: 500 });

  await admin.from("property_espelho_eventos").insert({
    property_id: unidade.id, empreendimento_id: emp.id, de, para, reserva_ate: reservaAte,
    cliente_nome: cliente, opportunity_id: opportunityId, motivo: observacao, autor: a.userId,
  });
  await logAudit({
    user_id: a.userId, acao: `espelho_${para}`, entidade: "property_espelho", entidade_id: unidade.id,
    property_id: unidade.id, opportunity_id: opportunityId,
    dados_antes: { status: de }, dados_depois: { status: para, reserva_ate: reservaAte, valor_venda: valorVenda },
  });
  return NextResponse.json({ ok: true });
}
