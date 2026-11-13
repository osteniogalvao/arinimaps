import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { ator, temSetor } from "@/lib/authz";
import { ADAPTADORES, consultarFontes, linhaParaGravar, type Bbox, type LinhaConsulta, type ResultadoFonte } from "@/lib/rural/adaptadores";
import { buscarEVincularPois } from "@/lib/overpass";
import { registrarEventoImovel } from "@/lib/imovel/eventos";

export const maxDuration = 120;

/** Roda a consulta territorial: cruza a geometria do imóvel com as fontes oficiais. */
export async function POST(request: Request, ctx: RouteContext<"/api/imoveis/[id]/consulta-rural">) {
  const { id } = await ctx.params;
  const a = await ator();
  if (!a || !temSetor(a, "operacoes", "cartografia")) {
    return NextResponse.json({ error: "A consulta territorial do anúncio é dos setores de Operações e Cartografia." }, { status: 403 });
  }

  const { raio_m = 5000 } = await request.json().catch(() => ({}));
  const admin = supabaseAdmin();

  const { data: bboxRaw, error: bboxErro } = await admin.rpc("fn_property_bbox", {
    p_property_id: id, p_buffer_m: raio_m,
  });
  if (bboxErro || !bboxRaw) {
    return NextResponse.json({ error: "Imóvel sem geometria — desenhe a área antes de consultar." }, { status: 400 });
  }
  const bbox = bboxRaw as Bbox;

  // todas as fontes ao vivo em paralelo, e as que falharem de novo depois de uma
  // pausa (órgão fora do ar por alguns segundos); nenhuma derruba a consulta
  const [resultados, { data: guardadas }] = await Promise.all([
    consultarFontes(ADAPTADORES, bbox) as Promise<ResultadoFonte[]>,
    admin.from("consultas_rurais").select("fonte_id, resultado, quantidade, incide, erro, consultado_em")
      .eq("property_id", id).eq("raio_m", raio_m),
  ]);
  const anteriores = new Map((guardadas ?? []).map((c) => [c.fonte_id as string, c as unknown as LinhaConsulta]));

  for (const r of resultados) {
    // fonte que caiu agora não apaga a resposta válida de antes: fica a anterior, com a data dela
    const linha = linhaParaGravar(r, anteriores.get(r.fonte_id), { origem: r.origem ?? null }); // origem: 3.15
    await admin.from("consultas_rurais").upsert({
      property_id: id,
      fonte_id: r.fonte_id,
      raio_m,
      ...linha,
    }, { onConflict: "property_id,fonte_id,raio_m" });
    await admin.from("fontes_externas")
      .update({ ultima_consulta: new Date().toISOString() })
      .eq("id", r.fonte_id);
  }

  // POIs e acessos reaproveitam o motor que já alimenta a página do imóvel
  const pois = await buscarEVincularPois(id).catch(() => 0);

  void registrarEventoImovel({ propertyId: id, tipo: "consulta", userId: a.userId, request, detalhe: { raio_m } });
  await logAudit({
    user_id: a.userId, acao: "consulta_rural_executada",
    entidade: "consultas_rurais", property_id: id,
    dados_depois: { raio_m, fontes: resultados.map((r) => ({ id: r.fonte_id, n: r.quantidade, erro: r.erro })) },
  });

  return NextResponse.json({
    ok: true,
    raio_m,
    pois_vinculados: pois,
    fontes: resultados.map((r) => ({
      id: r.fonte_id, quantidade: r.quantidade, incide: r.incide, erro: r.erro,
      // havia resposta válida guardada: ela continua no relatório
      manteve_anterior: !!r.erro && !!anteriores.get(r.fonte_id) && !anteriores.get(r.fonte_id)!.erro,
    })),
  });
}

/** Relatório territorial consolidado (o que já foi consultado). */
export async function GET(_request: Request, ctx: RouteContext<"/api/imoveis/[id]/consulta-rural">) {
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Imóvel inválido." }, { status: 400 });
  // Revisão de APIs (6.2): o relatório de anúncio publicado é público (painel do
  // mapa); o de anúncio em análise, reprovado ou rascunho só para a equipe e
  // para o responsável — antes qualquer um lia de qualquer imóvel pelo id.
  const { data: p } = await supabaseAdmin().from("properties").select("status, owner_id, partner_id").eq("id", id).maybeSingle();
  if (!p) return NextResponse.json({ error: "Imóvel não encontrado." }, { status: 404 });
  if (!["publicado", "em_negociacao", "vendido"].includes(p.status)) {
    const a = await ator();
    const responsavel = !!a && ((!!a.ownerId && a.ownerId === p.owner_id) || (!!a.partnerId && a.partnerId === p.partner_id));
    if (!a?.ehArini && !responsavel) return NextResponse.json({ error: "Imóvel não encontrado." }, { status: 404 });
  }
  const { data, error } = await supabaseAdmin().rpc("fn_consulta_rural", { p_property_id: id });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
