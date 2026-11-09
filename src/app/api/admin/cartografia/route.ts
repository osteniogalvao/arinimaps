import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { ator, temSetor } from "@/lib/authz";
import { conferirOrigem, respostaOrigemNegada } from "@/lib/seguranca/origem";
import { converterDxf, ErroDxf } from "@/lib/geo/dxf";
import { falha, falhaBanco } from "@/lib/erros";
import { publicarCopiaInicial } from "@/lib/geo/plantaPublica";

// Conversão de planta de cidade leva segundos, não milissegundos.
export const maxDuration = 300;

const MB = 1024 * 1024;
const LIMITE_MB = 200;

/** distância aproximada em km entre dois pontos em graus. */
function km(a: [number, number], b: [number, number]) {
  const R = 6371;
  const dLat = ((b[1] - a[1]) * Math.PI) / 180;
  const dLng = ((b[0] - a[0]) * Math.PI) / 180;
  const lat = ((a[1] + b[1]) / 2) * (Math.PI / 180);
  const x = dLng * Math.cos(lat);
  return Math.round(R * Math.hypot(x, dLat) * 10) / 10;
}

/**
 * Sobe camada de cartografia urbana:
 *  - .dxf  → convertido em fluxo para GeoJSON WGS84 e publicado na hora
 *  - imagem georreferenciada (.tif/.png/.jpg) → vira job de tiles para o worker
 *  - .dwg  → recusado com instrução (formato fechado; exportar DXF no CAD)
 *
 * Toda recusa responde com motivo medido e caminho de saída — ver src/lib/erros.ts.
 */
export async function POST(request: Request) {
  // fora do matcher do proxy (arquivos grandes): a conferência de origem (CSRF) é aqui
  const origem = conferirOrigem(request);
  if (!origem.ok) return respostaOrigemNegada(origem.motivo);
  const a = await ator();
  if (!a || !temSetor(a, "cartografia")) {
    return falha(403, "sem_permissao", "Restrito à equipe da Arini.", {
      solucao: "Entre com uma conta da Arini para publicar cartografia.",
    });
  }

  /**
   * O arquivo vem como CORPO BRUTO, não como multipart.
   *
   * `request.formData()` monta o arquivo inteiro na memória antes de devolver
   * qualquer coisa — com 103 MB isso é o dobro em RAM só para começar a ler. Em
   * corpo bruto, `request.body` é um fluxo que o leitor de DXF consome direto,
   * e os metadados (nome, município) viajam na query string.
   */
  const q = new URL(request.url).searchParams;
  const municipality_id = q.get("municipality_id") ?? "";
  const nome = (q.get("nome") ?? "").trim();
  const nomeArquivo = q.get("arquivo") ?? "";
  const zona = q.get("zona") ? Number(q.get("zona")) : undefined;
  const tamanho = Number(request.headers.get("content-length") ?? 0);

  if (!request.body || !municipality_id || !nome || !nomeArquivo) {
    return falha(400, "campos_faltando", "Informe nome, município e o arquivo.", {
      motivo: [
        !nome && "nome da camada em branco",
        !municipality_id && "município não escolhido",
        (!request.body || !nomeArquivo) && "nenhum arquivo anexado",
      ].filter(Boolean).join("; ") || undefined,
      solucao: "Preencha os três campos antes de publicar.",
    });
  }

  const arquivo = { name: nomeArquivo, size: tamanho };
  const ext = (nomeArquivo.split(".").pop() ?? "").toLowerCase();

  if (ext === "dwg") {
    return falha(400, "formato_dwg", "DWG é formato fechado e não pode ser lido no servidor.", {
      motivo: "A leitura de DWG depende de biblioteca que só existe na máquina do desenvolvedor.",
      solucao: "No AutoCAD: Salvar como → DXF (qualquer versão) e envie o .dxf. A conversão aqui é automática.",
    });
  }
  if (arquivo.size > LIMITE_MB * MB) {
    return falha(400, "arquivo_grande", `Arquivo de ${(arquivo.size / MB).toFixed(0)} MB — o limite é ${LIMITE_MB} MB.`, {
      motivo: "Acima disso a conversão consome mais memória do que o servidor tem.",
      solucao: "No CAD, apague as camadas que não vão ao mapa (textos, cotas, paisagismo) e exporte de novo.",
      detalhes: { bytes: arquivo.size, limite_bytes: LIMITE_MB * MB },
    });
  }

  const admin = supabaseAdmin();

  // ---------- planta vetorial (DXF) ----------
  if (ext === "dxf") {
    let convertido;
    try {
      convertido = await converterDxf(request.body as ReadableStream<Uint8Array>, zona);
    } catch (e) {
      if (e instanceof ErroDxf) {
        return falha(400, "dxf_ilegivel", e.message, {
          motivo: e.motivo, solucao: e.solucao, detalhes: e.detalhes,
        });
      }
      const msg = e instanceof Error ? e.message : String(e);
      const semMemoria = /heap|memory|allocation/i.test(msg);
      return falha(semMemoria ? 507 : 500, semMemoria ? "sem_memoria" : "dxf_erro_interno",
        semMemoria ? "O servidor ficou sem memória ao converter a planta." : "Não foi possível ler o DXF.", {
          motivo: msg,
          solucao: semMemoria
            ? "Reduza o arquivo no CAD (apague camadas de texto, cotas e paisagismo) e envie de novo."
            : "Mande esta tela para o desenvolvedor — o motivo acima identifica onde parou.",
          detalhes: { bytes: arquivo.size, arquivo: arquivo.name },
        });
    }

    // ---- a planta caiu dentro do município escolhido? ----
    // A pergunta é de sobreposição, não de distância até o centro: município
    // rural grande tem centroide longe da mancha urbana (ver migration 0017).
    const [bx0, by0, bx1, by1] = convertido.bbox;
    const { data: ref } = await admin.rpc("fn_confere_planta", {
      p_municipality_id: municipality_id,
      p_x0: bx0, p_y0: by0, p_x1: bx1, p_y1: by1,
    });
    const conferencia = ref as {
      nome: string; tem_geom: boolean; intersecta: boolean | null;
      contido: boolean | null; distancia_km: number | null;
    } | null;
    const distanciaKm = conferencia?.distancia_km ?? null;

    if (conferencia?.intersecta === false && (distanciaKm ?? 0) > 30) {
      return falha(400, "planta_fora_do_municipio",
        `A planta caiu a ${distanciaKm} km de ${conferencia.nome}.`, {
          motivo: `O desenho foi lido como UTM zona ${convertido.zona} e o retângulo dele não encosta no território do município escolhido — o centro ficou em ${convertido.centro[1].toFixed(4)}, ${convertido.centro[0].toFixed(4)}.`,
          solucao: "Confira se o município selecionado é o certo. Se for, o desenho pode estar em outra zona UTM ou em datum diferente — informe a zona no envio.",
          detalhes: {
            centro_planta: convertido.centro, zona_detectada: convertido.zona,
            distancia_km: distanciaKm, municipio: conferencia.nome,
          },
        });
    }

    const corpo = Buffer.from(JSON.stringify(convertido.geojson));
    const path = `cartografia/vetor/${municipality_id}-${crypto.randomUUID()}.geojson`;
    const { error: upErro } = await admin.storage.from("media").upload(
      path, corpo, { contentType: "application/geo+json", upsert: true }
    );
    if (upErro) {
      return falha(502, "storage_recusou", "A planta foi convertida, mas o armazenamento recusou o arquivo.", {
        motivo: upErro.message,
        solucao: "Tente publicar de novo. Se repetir, o bucket de mídia pode estar sem espaço ou sem permissão.",
        detalhes: { path, bytes: corpo.length },
      });
    }

    // uma planta ativa por município: a nova substitui a anterior
    await admin.from("cartography_layers")
      .delete().eq("municipality_id", municipality_id).eq("tipo", "vector");

    const [x0, y0, x1, y1] = convertido.bbox;
    const { data: camada, error } = await admin.from("cartography_layers").insert({
      municipality_id, nome, tipo: "vector",
      source_path: path, tiles_path: path,
      status: "pronto", min_zoom: 12, max_zoom: 19, opacidade_padrao: 0.85,
      bytes: corpo.length,
      diagnostico: {
        ...convertido.diagnostico,
        zona: convertido.zona,
        bbox: convertido.bbox,
        centro: convertido.centro,
        distancia_municipio_km: distanciaKm,
        dentro_do_municipio: conferencia?.intersecta ?? null,
        arquivo: arquivo.name,
        bytes_dxf: arquivo.size,
        extensao_km: [
          km([x0, y0], [x1, y0]),
          km([x0, y0], [x0, y1]),
        ],
      },
    }).select("id").single();
    if (error) return falhaBanco("camada_nao_gravou", error);

    // cópia pública em caminho próprio: o mapa público nunca recebe a URL do original
    let avisoPublico: string | null = null;
    try {
      await publicarCopiaInicial(admin, camada.id, corpo, convertido.geojson as GeoJSON.FeatureCollection);
    } catch (e) {
      avisoPublico = e instanceof Error ? e.message : String(e);
    }

    // planta nova → lotes clicáveis novos. A geração leva de segundos a mais de
    // um minuto, então vai para a fila do worker (ou `node scripts/gera-lotes.mjs`).
    await admin.from("jobs").insert({ tipo: "gerar_lotes", payload: { layer_id: camada.id } });

    await logAudit({
      user_id: a.userId, acao: "cartografia_dxf_publicada",
      entidade: "cartography_layers", entidade_id: camada.id,
      dados_depois: { nome, linhas: convertido.linhas, zona: convertido.zona, bytes: corpo.length },
    });

    const d = convertido.diagnostico;
    const avisos: string[] = [];
    if (avisoPublico) {
      avisos.push(`A planta ainda não aparece no mapa público (${avisoPublico}). Salve a calibração uma vez para gerar o arquivo público.`);
    }
    if (conferencia?.intersecta === false) {
      avisos.push(`O desenho não encosta no território de ${conferencia.nome} (${distanciaKm} km de distância) — confira se o município é o certo.`);
    } else if (conferencia?.contido === false) {
      avisos.push(`Parte da planta passa dos limites de ${conferencia.nome}. Normal quando o desenho cobre o entorno; estranho se for muito.`);
    }
    if (corpo.length > 8 * MB) {
      avisos.push(`A planta tem ${(corpo.length / MB).toFixed(1)} MB e pode ficar lenta no celular. Esconda as camadas de CAD que não são cadastro na tela de calibração.`);
    }
    if (d.blocosNaoResolvidos > 0) {
      avisos.push(`${d.blocosNaoResolvidos} blocos do CAD não tinham definição no arquivo e não foram desenhados.`);
    }

    return NextResponse.json({
      ok: true,
      id: camada.id,
      tipo: "vetorial",
      linhas: convertido.linhas,
      layers_cad: convertido.layersCad,
      zona: convertido.zona,
      bbox: convertido.bbox,
      centro: convertido.centro,
      distancia_municipio_km: distanciaKm,
      dentro_do_municipio: conferencia?.intersecta ?? null,
      municipio: conferencia?.nome ?? null,
      bytes: corpo.length,
      diagnostico: d,
      avisos,
      // o relógio começa no primeiro byte que chega: com leitura em fluxo, o
      // envio e a conversão acontecem ao mesmo tempo
      mensagem: `Planta publicada: ${convertido.linhas.toLocaleString("pt-BR")} linhas em ${convertido.layersCad} camadas do CAD, recebidas e convertidas em ${d.segundos}s.`,
    });
  }

  // ---------- imagem georreferenciada (vira tiles no worker) ----------
  const path = `cartografia/${municipality_id}/${crypto.randomUUID()}.${ext || "tif"}`;
  const { error: upError } = await admin.storage.from("media")
    .upload(path, Buffer.from(await request.arrayBuffer()), {
      contentType: request.headers.get("content-type") || "application/octet-stream",
    });
  if (upError) {
    return falha(502, "storage_recusou", "O armazenamento recusou a imagem.", {
      motivo: upError.message,
      solucao: "Tente de novo; se repetir, avise o desenvolvedor.",
      detalhes: { path },
    });
  }

  const { data: layer, error } = await admin.from("cartography_layers")
    .insert({ municipality_id, nome, tipo: "raster", source_path: path, bytes: arquivo.size })
    .select("id").single();
  if (error) return falhaBanco("camada_nao_gravou", error);

  await admin.from("jobs").insert({ tipo: "tile_raster", payload: { layer_id: layer.id, source_path: path } });
  await logAudit({
    user_id: a.userId, acao: "cartografia_enviada",
    entidade: "cartography_layers", entidade_id: layer.id, dados_depois: { nome, path },
  });

  return NextResponse.json({
    ok: true, tipo: "raster", id: layer.id,
    avisos: ["A geração de tiles depende do worker. Enquanto ele não estiver no ar, a camada fica pendente."],
    mensagem: "Imagem enviada — o worker vai gerar os tiles e a camada entra no mapa.",
  });
}
