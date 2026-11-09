import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { ator, temSetor, type Ator } from "@/lib/authz";
import { falha } from "@/lib/erros";
import { ariniEmail, sendEmail } from "@/lib/notify";
import { registrarEventoImovel } from "@/lib/imovel/eventos";
import { CAMPOS_REVISAO, CAMPOS_REVISAO_CARACTERISTICAS, CAMPO_REVISAO_LABEL, validarDadosRevisao, valorRevisao, type DadosRevisao } from "@/lib/imovel/revisao";

/**
 * Alteração de anúncio publicado (Fluxograma §9): o anunciante propõe uma
 * NOVA VERSÃO dos dados; a versão pública continua no ar até a Matriz aprovar
 * (ou rejeitar) em /api/admin/decisao com alvo "revisao".
 */
type Imovel = {
  id: string; codigo: string; status: string; owner_id: string | null; partner_id: string | null;
  titulo: string; descricao: string; valor: number | null; area_declarada: number | null;
  condicoes_venda: string | null; aceita_permuta: boolean; aceita_financiamento: boolean;
  caracteristicas: Record<string, unknown> | null;
};

async function carregar(a: Ator, id: string): Promise<{ p: Imovel } | { resposta: NextResponse }> {
  const { data } = await supabaseAdmin().from("properties")
    .select("id, codigo, status, owner_id, partner_id, titulo, descricao, valor, area_declarada, condicoes_venda, aceita_permuta, aceita_financiamento, caracteristicas")
    .eq("id", id).maybeSingle();
  if (!data) return { resposta: falha(404, "nao_encontrado", "Imóvel não encontrado.") };
  const p = data as Imovel;
  // equipe: anúncio é do setor de Operações (diretoria atua em todos)
  const dono = (a.ehArini && temSetor(a, "operacoes")) || (!!a.ownerId && p.owner_id === a.ownerId) || (!!a.partnerId && p.partner_id === a.partnerId);
  if (!dono) return { resposta: falha(403, "sem_acesso", "Sem acesso a este imóvel.") };
  return { p };
}

export async function POST(request: Request, ctx: RouteContext<"/api/imoveis/[id]/revisao">) {
  const { id } = await ctx.params;
  const a = await ator();
  if (!a) return falha(401, "sem_sessao", "Sessão expirada.");
  const r = await carregar(a, id);
  if ("resposta" in r) return r.resposta;
  const { p } = r;

  if (!["publicado", "em_negociacao"].includes(p.status)) {
    return falha(400, "nao_publicado", "Imóvel ainda não publicado: edite o cadastro normalmente.", {
      solucao: "Enquanto o anúncio está em análise, fale com a Arini para ajustar os dados.",
    });
  }

  const b = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b || typeof b !== "object") return falha(400, "dados_invalidos", "Envie os campos que quer alterar.");
  const v = validarDadosRevisao(b);
  if (!v.ok) return falha(400, "dados_invalidos", v.erro);

  // só o que de fato mudou entra na proposta
  const dados: Record<string, unknown> = {};
  const anteriores: Record<string, unknown> = {};
  // campos de coluna e os que vivem em `caracteristicas` (tour virtual, item 9)
  for (const campo of [...CAMPOS_REVISAO, ...CAMPOS_REVISAO_CARACTERISTICAS]) {
    if (!(campo in v.dados)) continue;
    const novo = (v.dados as Record<string, unknown>)[campo];
    const atual = ((CAMPOS_REVISAO_CARACTERISTICAS as readonly string[]).includes(campo)
      ? (p.caracteristicas ?? {})[campo]
      : (p as unknown as Record<string, unknown>)[campo]) ?? null;
    if (JSON.stringify(novo ?? null) === JSON.stringify(atual)) continue;
    dados[campo] = novo ?? null;
    anteriores[campo] = atual;
  }
  if (!Object.keys(dados).length) return falha(400, "sem_mudanca", "Nada mudou em relação ao anúncio atual.");

  const admin = supabaseAdmin();
  const { data: pendente } = await admin.from("property_revisions").select("id, versao")
    .eq("property_id", id).eq("status", "pendente").maybeSingle();
  if (pendente) {
    return falha(409, "revisao_pendente", `Já existe uma alteração (versão ${pendente.versao}) aguardando a Matriz.`, {
      solucao: "Cancele a proposta pendente no painel para enviar outra.",
    });
  }
  const { data: ultima } = await admin.from("property_revisions").select("versao")
    .eq("property_id", id).order("versao", { ascending: false }).limit(1).maybeSingle();
  const versao = (ultima?.versao ?? 0) + 1;

  const { data: rev, error } = await admin.from("property_revisions").insert({
    property_id: id, versao, dados, dados_anteriores: anteriores, created_by: a.userId,
  }).select("id").single();
  if (error) return falha(500, "banco", "Não foi possível registrar a proposta.", { motivo: error.message });

  const resumo = Object.keys(dados)
    .map((c) => `${CAMPO_REVISAO_LABEL[c as keyof typeof CAMPO_REVISAO_LABEL] ?? c}: ${valorRevisao(c, anteriores[c])} → ${valorRevisao(c, dados[c])}`)
    .join("\n");

  void registrarEventoImovel({
    propertyId: id, tipo: "revisao", userId: a.userId, partnerId: a.partnerId, request,
    detalhe: { revisao_id: rev.id, versao, campos: Object.keys(dados) },
  });
  await logAudit({
    user_id: a.userId, acao: "revisao_proposta", entidade: "property_revisions", entidade_id: rev.id,
    property_id: id, dados_antes: anteriores, dados_depois: { versao, ...dados },
  });
  // fila de Operações: a Matriz decide pela ficha do imóvel
  await admin.from("tasks").insert({
    titulo: `Alteração proposta — ${p.codigo}`.slice(0, 200),
    descricao: `Versão ${versao} do anúncio ${p.codigo} aguarda decisão.\n\n${resumo}`.slice(0, 4000),
    setor: "operacoes", criado_por: a.userId, prioridade: "normal", property_id: id,
  });
  ariniEmail().then((to) => sendEmail(
    to, `Alteração proposta — ${p.codigo}`,
    `O anunciante propôs a versão ${versao} do anúncio ${p.codigo} (${p.titulo}).\n\n${resumo}\n\nDecida em ${process.env.NEXT_PUBLIC_SITE_URL}/admin/imoveis/${id}`
  )).catch(() => undefined);

  return NextResponse.json({ ok: true, id: rev.id, versao });
}

/** Cancela a própria proposta pendente. */
export async function DELETE(request: Request, ctx: RouteContext<"/api/imoveis/[id]/revisao">) {
  const { id } = await ctx.params;
  const a = await ator();
  if (!a) return falha(401, "sem_sessao", "Sessão expirada.");
  const r = await carregar(a, id);
  if ("resposta" in r) return r.resposta;

  const admin = supabaseAdmin();
  const { data: pendente } = await admin.from("property_revisions").select("id, versao, dados")
    .eq("property_id", id).eq("status", "pendente").maybeSingle();
  if (!pendente) return falha(404, "sem_pendente", "Não há alteração pendente para cancelar.");

  const { error } = await admin.from("property_revisions")
    .update({ status: "cancelada", revisada_por: a.userId, revisada_em: new Date().toISOString() })
    .eq("id", pendente.id).eq("status", "pendente");
  if (error) return falha(500, "banco", "Não foi possível cancelar.", { motivo: error.message });

  await admin.from("tasks").update({ status: "cancelada" })
    .eq("property_id", id).eq("setor", "operacoes").eq("status", "aberta").ilike("titulo", "Alteração proposta — %");
  await logAudit({
    user_id: a.userId, acao: "revisao_cancelada", entidade: "property_revisions", entidade_id: pendente.id,
    property_id: id, dados_antes: { versao: pendente.versao, dados: pendente.dados as DadosRevisao },
  });
  void registrarEventoImovel({ propertyId: id, tipo: "revisao", userId: a.userId, partnerId: a.partnerId, request, detalhe: { revisao_id: pendente.id, versao: pendente.versao, acao: "cancelada" } });
  return NextResponse.json({ ok: true });
}
