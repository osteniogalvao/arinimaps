import { currentUser } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { pdfDaArea, type SecaoPdf } from "@/lib/relatorio/pdf-area";
import { perfilDaArea } from "@/lib/relatorio/territorio";
import { limiteLeituraMapa } from "@/lib/geo/limiteMemoria";

/**
 * GET /api/conta/monitoramento/{id}/relatorio — relatório mensal da área
 * monitorada (17/11/2026, o "FarmScan" do Dados Fazenda): situação de cada
 * fonte acompanhada, ocorrências dos últimos 30 dias, uso do solo e chuva.
 * Só o titular baixa; o aviso do dia 1º (worker) traz este link.
 */
export const maxDuration = 90;

const FONTES: Record<string, string> = {
  inpe_queimadas: "Focos de calor (INPE)", ibama_embargos: "Embargos (IBAMA)",
  prodes_cerrado: "Desmatamento no Cerrado (PRODES/INPE)", sigef: "Parcelas certificadas (SIGEF/INCRA)",
};
const U = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i;
const data = (s: string | null) => (s ? new Date(s).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }) : "ainda sem leitura");

type Relatorio = {
  nome: string; hectares: number; ativo: boolean; aceite_em: string; geometria: GeoJSON.Polygon | GeoJSON.MultiPolygon;
  leituras: { fonte: string; lida_em: string | null; falhou: boolean; registros: number }[];
  eventos: { fonte: string; titulo: string; codigo: string; detectado_em: string; novo: boolean }[];
};

export async function GET(request: Request, ctx: RouteContext<"/api/conta/monitoramento/[id]/relatorio">) {
  const bloqueio = await limiteLeituraMapa(request, "geo");
  if (bloqueio) return bloqueio;
  const u = await currentUser();
  if (!u) return Response.json({ error: "Entre para baixar o relatório da sua área." }, { status: 401 });
  const { id } = await ctx.params;
  if (!U.test(id)) return Response.json({ error: "Área inválida." }, { status: 400 });

  const desde = new Date(Date.now() - 30 * 86_400_000);
  const { data: r, error } = await supabaseAdmin().rpc("monitor_relatorio", { p_titular: u.id, p_area: id, p_desde: desde.toISOString() });
  if (error) return Response.json({ error: "O relatório está indisponível agora." }, { status: 503 });
  const rel = r as Relatorio | null;
  if (!rel?.geometria) return Response.json({ error: "Área não encontrada nesta conta." }, { status: 404 });

  const mes = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "America/Sao_Paulo" }).format(new Date());
  const novos = rel.eventos.filter((e) => e.novo).length;
  const secoes: SecaoPdf[] = [{ titulo: "Resumo do mês", linhas: [
    `Área: ${rel.nome}`,
    `Tamanho: ${Number(rel.hectares).toLocaleString("pt-BR")} ha`,
    `Período: ${desde.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })} a ${new Date().toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}`,
    `Situação: ${rel.ativo ? "monitoramento ativo" : "monitoramento encerrado"} desde ${new Date(rel.aceite_em).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}`,
    rel.eventos.length
      ? `Ocorrências no período: ${rel.eventos.length} (${novos} novas, ${rel.eventos.length - novos} atualizações)`
      : "Ocorrências no período: nenhuma mudança registrada pelas fontes acompanhadas.",
  ] }, { titulo: "Fontes acompanhadas", linhas: rel.leituras.length ? rel.leituras.map((l) =>
    `${FONTES[l.fonte] ?? l.fonte}: ${l.registros} registro(s) na área hoje · última leitura ${data(l.lida_em)}${l.falhou ? " · a fonte não respondeu na última tentativa" : ""}`)
    : ["Nenhuma fonte ativa nesta área."] }];
  if (rel.eventos.length) secoes.push({ titulo: "Ocorrências dos últimos 30 dias", linhas: rel.eventos.slice(0, 60).map((e) =>
    `${data(e.detectado_em)}: ${e.titulo} (${e.novo ? "novo" : "atualizado"}) · código ${e.codigo}`) });
  // uso do solo e chuva: as mesmas seções do relatório territorial; uma fonte fora não derruba o PDF
  try { secoes.push(...await perfilDaArea(rel.geometria, `monitor:${id}`, Number(rel.hectares), new Set(["uso", "clima"]))); }
  catch (e) { console.error("relatório mensal: perfil da área falhou:", e instanceof Error ? e.message : e); }
  secoes.push({ titulo: "Sobre este relatório", linhas: [
    "Retrato gerado a partir das leituras automáticas das fontes oficiais escolhidas no monitoramento. Não substitui certidão, vistoria ou laudo técnico.",
  ] });

  const bytes = await pdfDaArea(`Relatório mensal · ${mes}`, rel.nome.slice(0, 40), secoes, rel.geometria, "desenho");
  return new Response(new Uint8Array(bytes).buffer, { headers: {
    "Content-Type": "application/pdf", "Cache-Control": "private, no-store",
    "Content-Disposition": `inline; filename="ARINI-monitoramento-${id.slice(0, 8)}.pdf"`,
  } });
}
