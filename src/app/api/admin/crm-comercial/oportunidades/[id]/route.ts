import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ator, podeOperarOportunidade, temSetor } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import { marcarPrimeiroAtendimento } from "@/lib/central";
import { INTERACOES, INTERACAO_IDS, TEMPERATURAS, limparEtiquetas } from "@/lib/crm-comercial";

/**
 * Painel do CRM na oportunidade (migration 0147):
 *   { acao: "classificar", temperatura?, etiquetas? }
 *   { acao: "proxima_acao", texto, quando }   (texto vazio limpa)
 *   { acao: "interacao", tipo, texto, proxima_acao?, quando? }
 */
export async function PATCH(request: Request, ctx: RouteContext<"/api/admin/crm-comercial/oportunidades/[id]">) {
  const { id } = await ctx.params;
  const a = await ator();
  if (!temSetor(a, "comercial", "diretoria")) return NextResponse.json({ error: "Restrito ao Comercial." }, { status: 403 });
  if (!(await podeOperarOportunidade(a!, id))) return NextResponse.json({ error: "Sem acesso a esta oportunidade." }, { status: 403 });
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const admin = supabaseAdmin();
  const falta = (msg: string) => /column|0147/.test(msg)
    ? NextResponse.json({ error: "Falta rodar a migration 0147 (CRM comercial)." }, { status: 400 })
    : NextResponse.json({ error: "Não foi possível salvar." }, { status: 503 });

  if (b.acao === "classificar") {
    const mud: Record<string, unknown> = {};
    if ("temperatura" in b) mud.temperatura = TEMPERATURAS.includes(b.temperatura as never) ? b.temperatura : null;
    if ("etiquetas" in b) mud.etiquetas = limparEtiquetas(b.etiquetas);
    if (!Object.keys(mud).length) return NextResponse.json({ error: "Nada para salvar." }, { status: 400 });
    const { error } = await admin.from("opportunities").update(mud).eq("id", id);
    if (error) return falta(error.message);
    await logAudit({ user_id: a!.userId, acao: "oportunidade_classificada", entidade: "opportunities", entidade_id: id, opportunity_id: id, dados_depois: mud });
    return NextResponse.json({ ok: true });
  }

  const proxima = () => {
    const texto = typeof b.proxima_acao === "string" ? b.proxima_acao.trim().slice(0, 200) : typeof b.texto === "string" && b.acao === "proxima_acao" ? b.texto.trim().slice(0, 200) : "";
    const quando = typeof b.quando === "string" && b.quando ? new Date(b.quando) : null;
    if (texto && (!quando || Number.isNaN(+quando))) return { erro: "Escolha a data e a hora da próxima ação." };
    return { texto: texto || null, quando: texto ? quando!.toISOString() : null };
  };

  if (b.acao === "proxima_acao") {
    const p = proxima();
    if ("erro" in p) return NextResponse.json({ error: p.erro }, { status: 400 });
    const { error } = await admin.from("opportunities").update({ proxima_acao: p.texto, proxima_acao_em: p.quando }).eq("id", id);
    if (error) return falta(error.message);
    if (p.texto) {
      await admin.from("opportunity_events").insert({ opportunity_id: id, tipo: "agenda", autor: a!.userId,
        descricao: `Próxima ação: ${p.texto} (${new Date(p.quando!).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" })})` });
    }
    return NextResponse.json({ ok: true });
  }

  if (b.acao === "interacao") {
    const tipo = INTERACAO_IDS.includes(String(b.tipo)) ? String(b.tipo) : null;
    const texto = typeof b.texto === "string" ? b.texto.trim().slice(0, 4000) : "";
    if (!tipo) return NextResponse.json({ error: "Escolha o tipo de contato." }, { status: 400 });
    if (!texto) return NextResponse.json({ error: "Descreva o contato." }, { status: 400 });
    const p = proxima();
    if ("erro" in p) return NextResponse.json({ error: p.erro }, { status: 400 });
    const rotulo = INTERACOES.find((i) => i.id === tipo)!.rotulo;
    const { error: e1 } = await admin.from("opportunity_events").insert({
      opportunity_id: id, tipo, autor: a!.userId, descricao: tipo === "anotacao" ? texto : `${rotulo}: ${texto}`,
    });
    if (e1) return NextResponse.json({ error: "Não foi possível registrar." }, { status: 503 });
    const mud: Record<string, unknown> = tipo === "anotacao" ? {} : { ultimo_contato_em: new Date().toISOString() };
    if (p.texto) { mud.proxima_acao = p.texto; mud.proxima_acao_em = p.quando; }
    else if (b.concluir_proxima === true) { mud.proxima_acao = null; mud.proxima_acao_em = null; }
    if (Object.keys(mud).length) {
      const { error } = await admin.from("opportunities").update(mud).eq("id", id);
      if (error) return falta(error.message);
    }
    if (tipo !== "anotacao") await marcarPrimeiroAtendimento(id, a!.userId);
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Ação inválida." }, { status: 400 });
}
