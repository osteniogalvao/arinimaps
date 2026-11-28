import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { ator, temSetor } from "@/lib/authz";
import { falha, falhaBanco } from "@/lib/erros";
import { conferirOrigem, respostaOrigemNegada } from "@/lib/seguranca/origem";
import { converterDxf, ErroDxf } from "@/lib/geo/dxf";
import { CorpoMuitoGrande, limitarFluxo } from "@/lib/seguranca/corpo-limitado";
import { resumoTextos, salvarTextosPlanta } from "@/lib/cartografia/textosPlanta";

const MB = 1024 * 1024;
const LIMITE_MB = 200;

/**
 * Lê do DXF só os números de quadra e lote e as áreas escritas, para uma
 * planta que JÁ está publicada (áudio do Carlos, 28/11/2026: "o número das
 * quadras e os números do lote não estão puxando... metragem do terreno,
 * número da quadra e número do lote"). As linhas, a calibração e as peças
 * encaixadas não mudam. Depois a fila gera os lotes de novo e aplica tudo.
 *
 * O DXF vem como corpo bruto (como no envio da planta), não multipart.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/admin/cartografia/[id]/textos">) {
  const { id } = await ctx.params;
  const origem = conferirOrigem(request);
  if (!origem.ok) return respostaOrigemNegada(origem.motivo);
  const a = await ator();
  if (!a || a.somenteLeitura || !temSetor(a, "cartografia")) {
    return falha(403, "sem_permissao", "Restrito à equipe da Arini.", {
      solucao: "Entre com uma conta da Arini com acesso à cartografia.",
    });
  }
  if (!request.body) return falha(400, "sem_arquivo", "Envie o arquivo DXF da planta.");

  const admin = supabaseAdmin();
  const { data: camada, error: erroCamada } = await admin.from("cartography_layers")
    .select("id, nome, tipo, diagnostico").eq("id", id).maybeSingle();
  if (erroCamada) return falhaBanco("camada_nao_lida", erroCamada);
  if (!camada || camada.tipo !== "vector") return falha(404, "planta_nao_encontrada", "Planta vetorial não encontrada.");

  // mesma zona UTM que a planta usou, para o texto cair onde a linha caiu
  const zonaPlanta = Number((camada.diagnostico as { zona?: unknown } | null)?.zona);
  let convertido;
  try {
    convertido = await converterDxf(limitarFluxo(request.body, LIMITE_MB * MB), Number.isFinite(zonaPlanta) ? zonaPlanta : undefined);
  } catch (e) {
    if (e instanceof CorpoMuitoGrande) return falha(413, "arquivo_grande", `O DXF passa do limite de ${LIMITE_MB} MB.`);
    if (e instanceof ErroDxf) return falha(400, "dxf_ilegivel", e.message, { motivo: e.motivo, solucao: e.solucao });
    return falha(500, "dxf_erro_interno", "Não foi possível ler o DXF.", { motivo: e instanceof Error ? e.message : String(e) });
  }
  const resumo = resumoTextos(convertido.textos);
  if (!convertido.textos.length) {
    return falha(400, "sem_textos", "O DXF não tem números de quadra, de lote nem áreas escritas.", {
      solucao: "Confira se os textos das quadras e lotes não ficaram numa camada desligada ou só no Layout ao exportar o DXF.",
    });
  }
  const erro = await salvarTextosPlanta(admin, id, convertido.textos);
  if (erro) return falha(502, "storage_recusou", "O armazenamento recusou os números lidos.", { motivo: erro });

  const { count } = await admin.from("jobs").select("id", { count: "exact", head: true })
    .eq("tipo", "gerar_lotes").eq("status", "pendente").contains("payload", { layer_id: id });
  if (!count) {
    const { error: erroJob } = await admin.from("jobs").insert({ tipo: "gerar_lotes", payload: { layer_id: id } });
    if (erroJob) return falhaBanco("fila_nao_gravou", erroJob);
  }

  await logAudit({
    user_id: a.userId, acao: "cartografia_textos_lidos",
    entidade: "cartography_layers", entidade_id: id, dados_depois: resumo,
  });
  return NextResponse.json({ ok: true, ...resumo });
}
