import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ator } from "@/lib/authz";
import { conferirRecurso, respostaNegacao } from "@/lib/planos-servidor";
import { limitar, respostaLimite } from "@/lib/seguranca/limite";
import { falha, falhaBanco } from "@/lib/erros";
import { logAudit } from "@/lib/audit";
import { ariniEmail, sendEmail } from "@/lib/notify";
import { ehTipoSolicitacao, TIPO_SOLICITACAO_LABEL } from "@/lib/cartografia/solicitacoes";
import { lerArquivos, referenciaValida, resolverReferencia, subirArquivos } from "@/lib/cartografia/servidor";

const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const GEOMETRIAS = ["Point", "Polygon", "MultiPolygon"];

/**
 * Abre uma solicitação cartográfica (requisitos §2): "não encontrei meu
 * imóvel" / "o mapa está divergente". Ganha protocolo, entra na fila da
 * Cartografia e vira tarefa do setor. A geometria enviada fica guardada na
 * solicitação — NÃO vira a divisa oficial de nada até a Matriz aplicar.
 */
export async function POST(request: Request) {
  const a = await ator();
  if (!a) {
    return falha(401, "sem_sessao", "Entre na sua conta para abrir a solicitação.", {
      solucao: "A solicitação ganha protocolo e fica ligada à sua conta.",
    });
  }
  const { negacao } = await conferirRecurso(request, { id: a.userId, role: a.role }, "solicitacao_cartografica");
  if (negacao) return respostaNegacao(negacao);

  const limite = await limitar(`cartografia:solicitar:${a.userId}`, 10, 3600);
  if (!limite.permitido) return respostaLimite(limite, "abertura de solicitação");

  const form = await request.formData().catch(() => null);
  if (!form) {
    return falha(400, "corpo_invalido", "O pedido chegou sem dados.", { solucao: "Recarregue a página e tente de novo." });
  }
  let dados: Record<string, unknown>;
  try {
    dados = JSON.parse(String(form.get("dados") ?? "{}"));
  } catch {
    return falha(400, "corpo_invalido", "Os dados do formulário não puderam ser lidos.", { solucao: "Recarregue a página e tente de novo." });
  }

  // --- validação ---
  const tipo = dados.tipo;
  if (!ehTipoSolicitacao(tipo)) {
    return falha(400, "tipo_invalido", "Escolha o tipo da solicitação.");
  }
  const descricao = typeof dados.descricao === "string" ? dados.descricao.trim().slice(0, 4000) : "";
  const referencia = referenciaValida(dados.referencia) ? dados.referencia : null;
  const municipalityId = typeof dados.municipality_id === "string" && RE_UUID.test(dados.municipality_id) ? dados.municipality_id : null;
  const propertyId = typeof dados.property_id === "string" && RE_UUID.test(dados.property_id) ? dados.property_id : null;

  let ponto: GeoJSON.Point | null = null;
  const p = dados.ponto as { lng?: unknown; lat?: unknown } | null | undefined;
  if (p && typeof p === "object") {
    const lng = Number(p.lng), lat = Number(p.lat);
    if (!Number.isFinite(lng) || !Number.isFinite(lat) || Math.abs(lng) > 180 || Math.abs(lat) > 90) {
      return falha(400, "ponto_invalido", "O ponto marcado no mapa é inválido.", { solucao: "Marque o ponto de novo." });
    }
    ponto = { type: "Point", coordinates: [lng, lat] };
  }

  let geom: GeoJSON.Geometry | null = null;
  const g = dados.geometria as GeoJSON.Geometry | null | undefined;
  if (g && typeof g === "object") {
    if (!GEOMETRIAS.includes(g.type) || !("coordinates" in g) || !Array.isArray(g.coordinates)) {
      return falha(400, "geometria_invalida", "A área desenhada é inválida.", {
        motivo: `Tipo ${String(g.type)} não aceito.`, solucao: "Desenhe um polígono ou marque um ponto.",
      });
    }
    if (g.type === "Point") ponto = ponto ?? (g as GeoJSON.Point);
    else geom = g;
  }

  const { arquivos, erro: erroArquivos } = await lerArquivos(form);
  if (erroArquivos) return falha(400, "arquivo_invalido", erroArquivos);

  const dispensaDescricao = tipo === "inclusao" && (geom || ponto);
  if (descricao.length < 10 && !dispensaDescricao) {
    return falha(400, "descricao_curta", "Descreva o que está errado ou faltando no mapa.", {
      solucao: "Uma frase basta — o que você esperava ver e o que aparece.",
    });
  }
  if (!ponto && !geom && !referencia && !arquivos.length) {
    return falha(400, "sem_localizacao", "Indique onde fica o imóvel.", {
      solucao: "Marque um ponto, desenhe a área, clique num imóvel do mapa ou anexe um KML/PDF.",
    });
  }

  const admin = supabaseAdmin();

  // referência clicada no mapa (CAR ou lote): a divisa vem do nosso banco
  let referenciaRotulo: string | null = null;
  let municipalityFinal = municipalityId;
  if (referencia) {
    const ref = await resolverReferencia(referencia);
    if (!ref) {
      return falha(400, "referencia_invalida", "O imóvel clicado no mapa não foi encontrado.", {
        solucao: "Volte ao mapa e clique de novo na área, ou desenhe a área aqui.",
      });
    }
    referenciaRotulo = ref.rotulo;
    if (!geom) geom = ref.geometry;
    if (!municipalityFinal) municipalityFinal = ref.municipality_id;
  }

  // imóvel ligado: só o responsável por ele (ou a equipe)
  if (propertyId) {
    const { data: imovel } = await admin.from("properties").select("id, owner_id, partner_id").eq("id", propertyId).maybeSingle();
    if (!imovel) return falha(404, "imovel_nao_encontrado", "Imóvel não encontrado.");
    const meu = a.ehArini || (a.ownerId && imovel.owner_id === a.ownerId) || (a.partnerId && imovel.partner_id === a.partnerId);
    if (!meu) return falha(403, "imovel_de_terceiro", "Este imóvel não está na sua conta.", { solucao: "Abra a solicitação sem vincular o imóvel." });
  }

  // --- grava ---
  const { data: req, error: erroInsert } = await admin.from("cartographic_requests").insert({
    user_id: a.userId,
    property_id: propertyId,
    municipality_id: municipalityFinal,
    tipo,
    descricao,
    referencia,
  }).select("id, protocolo").single();
  if (erroInsert) return falhaBanco("solicitacao_nao_gravada", erroInsert);

  if (ponto || geom) {
    const { error: erroGeo } = await admin.rpc("fn_cart_request_set_geometry", {
      p_id: req.id, p_ponto: ponto, p_geom: geom,
    });
    if (erroGeo) {
      await admin.from("cartographic_requests").delete().eq("id", req.id);
      return falha(400, "geometria_invalida", "A área desenhada não pôde ser gravada.", {
        motivo: erroGeo.message, solucao: "Desenhe a área de novo, sem cruzar as linhas.",
      });
    }
  }

  const { salvos, falharam } = await subirArquivos(req.protocolo, arquivos);
  if (salvos.length) await admin.from("cartographic_requests").update({ arquivos: salvos }).eq("id", req.id);

  const rotuloTipo = TIPO_SOLICITACAO_LABEL[tipo];
  await admin.from("cartographic_request_events").insert({
    request_id: req.id, user_id: a.userId, de_status: null, para_status: "recebida",
    mensagem: "Solicitação recebida", interno: false,
  });

  // vira tarefa da Cartografia (fila do setor na Matriz)
  await admin.from("tasks").insert({
    origem: "automatica", regra: "solicitacao_cartografica", chave_evento: `solicitacao_cartografica:${req.id}`,
    titulo: `Solicitação ${req.protocolo} — ${rotuloTipo}`,
    descricao: [
      descricao || null,
      referenciaRotulo ? `Referência: ${referenciaRotulo}` : null,
      salvos.length ? (salvos.length === 1 ? "1 arquivo anexado" : `${salvos.length} arquivos anexados`) : null,
      `Abrir: /admin/cartografia/solicitacoes/${req.id}`,
    ].filter(Boolean).join("\n").slice(0, 4000),
    setor: "cartografia",
    criado_por: a.userId,
    prioridade: "normal",
    property_id: propertyId,
  });

  await logAudit({
    user_id: a.userId,
    acao: "solicitacao_cartografica_criada",
    entidade: "cartographic_requests",
    entidade_id: req.id,
    property_id: propertyId,
    dados_depois: {
      protocolo: req.protocolo, tipo, referencia, ponto: !!ponto, geometria: !!geom,
      arquivos: salvos.length, arquivos_falharam: falharam,
    },
  });

  ariniEmail().then((para) => sendEmail(
    para,
    `Solicitação cartográfica ${req.protocolo}: ${rotuloTipo}`,
    `Nova solicitação na fila da Cartografia.\n\nProtocolo: ${req.protocolo}\nTipo: ${rotuloTipo}` +
      `${referenciaRotulo ? `\nReferência: ${referenciaRotulo}` : ""}\n\n${descricao || "(sem descrição)"}` +
      `\n\nAbrir: ${process.env.NEXT_PUBLIC_SITE_URL ?? ""}/admin/cartografia/solicitacoes/${req.id}`
  )).catch(() => undefined);

  return NextResponse.json({ ok: true, id: req.id, protocolo: req.protocolo, arquivos_falharam: falharam });
}

/** As solicitações de quem está logado, da mais nova para a mais antiga. */
export async function GET() {
  const a = await ator();
  if (!a) return falha(401, "sem_sessao", "Entre na sua conta para ver suas solicitações.");
  const { data, error } = await supabaseAdmin().from("cartographic_requests")
    .select("id, protocolo, tipo, status, created_at, updated_at, resposta")
    .eq("user_id", a.userId).order("created_at", { ascending: false }).limit(200);
  if (error) return falhaBanco("lista_falhou", error);
  return NextResponse.json({ ok: true, solicitacoes: data ?? [] });
}
