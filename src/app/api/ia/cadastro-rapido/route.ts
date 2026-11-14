import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { ator, temSetor } from "@/lib/authz";
import { falha } from "@/lib/erros";
import { logAudit } from "@/lib/audit";
import { lerConfiguracoes } from "@/lib/settings";
import { ehParceiro, podeAnunciar } from "@/lib/perfis";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { limitar, respostaLimite } from "@/lib/seguranca/limite";
import { tipoReal } from "@/lib/seguranca/arquivos";
import { iaConfigurada, modeloIa } from "@/lib/ia/config";
import { transcricaoConfigurada, transcreverAudio } from "@/lib/ia/transcricao";
import { extrairAnuncio, LIMITES_CADASTRO_RAPIDO as LIM, type MidiaParaIa } from "@/lib/ia/cadastroRapidoNucleo";

export const maxDuration = 120;
export const dynamic = "force-dynamic";

/**
 * Cadastro rápido com a Ari (2ª etapa do cliente, item 4).
 *
 * POST multipart: `descricao` (texto livre), `fotos` (já reduzidas pelo
 * navegador), `docs` (PDF ou imagem: matrícula, CAR, escritura) e `audio`
 * opcional. Devolve o JSON com os campos do anúncio; o formulário de
 * /painel/novo abre preenchido e o anúncio segue o fluxo normal
 * (POST /api/imoveis → análise da Central).
 *
 * NADA é gravado aqui: os arquivos vão só para o modelo e são descartados.
 * As fotos e documentos que ficam são os que o anunciante enviar depois, pelo
 * formulário, no fluxo de anúncio que já existe.
 *
 * GET devolve o estado (IA ligada, transcrição de áudio ligada, limites) para
 * a tela decidir o que mostrar.
 */
const LIMITES_CHAMADAS = [
  ["min", 2, 60],
  ["hora", 8, 3600],
  ["dia", 20, 86400],
] as const;

async function conferirAcesso() {
  if (!iaConfigurada()) {
    return { erro: falha(503, "ia_desligada", "O cadastro rápido depende da Ari, que está em configuração.", {
      motivo: "A chave do provedor de IA ainda não foi instalada no servidor.",
      solucao: "Preencha o formulário normalmente, logo abaixo.",
    }) };
  }
  const cfg = await lerConfiguracoes();
  if (cfg.ia_chat_ativo === false) {
    return { erro: falha(503, "ia_desligada", "A Ari está desligada no momento.", {
      motivo: "Desligada pela Arini em Configurações.", solucao: "Preencha o formulário normalmente, logo abaixo.",
    }) };
  }
  const a = await ator();
  if (!a) return { erro: falha(401, "sem_sessao", "Entre na sua conta para anunciar.") };
  if (!podeAnunciar(a.role, a.nicho) || !a.acesso.recursos.has("anunciar") || (a.ehArini && !temSetor(a, "operacoes", "comercial"))) {
    return { erro: falha(403, "sem_permissao", "Sua conta não anuncia imóveis.", {
      solucao: "Confira o perfil de anunciante e os recursos do seu plano com a Arini.",
    }) };
  }
  // mesma regra do POST /api/imoveis: conta recusada ou suspensa não usa a Ari
  // (cada chamada custa IA); parceiro só depois de aprovado
  if (!a.ehArini) {
    const admin = supabaseAdmin();
    if (a.role === "proprietario") {
      const { data } = await admin.from("owners").select("status").eq("profile_id", a.userId).maybeSingle();
      if (!data || !["solicitado", "em_analise", "pendente", "aprovado", "ativo"].includes(data.status)) {
        return { erro: falha(403, "conta_nao_liberada", "Seu cadastro de proprietário não está liberado para anunciar.", {
          solucao: "Fale com a Arini.",
        }) };
      }
    } else if (ehParceiro(a.role)) {
      const { data } = await admin.from("partners").select("status").eq("profile_id", a.userId).maybeSingle();
      if (!data || !["aprovado", "ativo"].includes(data.status)) {
        return { erro: falha(403, "conta_em_analise", "Seu cadastro de parceiro ainda está em análise pela Arini.") };
      }
    }
  }
  return { a };
}

export async function GET() {
  const r = await conferirAcesso();
  if (r.erro) {
    const corpo = await r.erro.json();
    return NextResponse.json({ ligado: false, motivo: corpo.error, transcricao: false });
  }
  return NextResponse.json({
    ligado: true,
    transcricao: transcricaoConfigurada(),
    limites: {
      fotos: LIM.fotos, documentos: LIM.documentos, descricao: LIM.descricao,
      docPdfMb: LIM.docPdfBytes / 1048576, docImagemMb: LIM.docImagemBytes / 1048576, audioMb: LIM.audioBytes / 1048576,
      porHora: LIMITES_CHAMADAS[1][1], porDia: LIMITES_CHAMADAS[2][1],
    },
  }, { headers: { "Cache-Control": "private, no-store" } });
}

const TIPO_IMAGEM = { jpg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif" } as const;

export async function POST(request: Request) {
  const acesso = await conferirAcesso();
  if (acesso.erro) return acesso.erro;
  const userId = acesso.a.userId;

  // sem content-length (envio em partes) não dá para saber o tamanho antes de ler: recusa
  const tamanho = request.headers.get("content-length");
  if (tamanho === null || !/^\d+$/.test(tamanho)) {
    return falha(411, "tamanho_ausente", "Não foi possível conferir o tamanho do envio.", { solucao: "Tente de novo." });
  }
  if (Number(tamanho) > LIM.totalBytes + LIM.audioBytes + 1024 * 1024) {
    return falha(413, "envio_grande", "O material passou do tamanho máximo do cadastro rápido.", {
      motivo: `Até ${LIM.totalBytes / 1048576} MB entre fotos e documentos por envio.`,
      solucao: "Mande menos documentos ou PDFs menores; o restante você anexa no formulário.",
    });
  }

  for (const [janela, max, seg] of LIMITES_CHAMADAS) {
    const l = await limitar(`iacad:${janela}:${userId}`, max, seg);
    if (!l.permitido) return respostaLimite(l, "cadastro rápido");
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return falha(400, "corpo_invalido", "Não foi possível ler o envio.", { solucao: "Tente de novo." });
  }

  let descricao = String(form.get("descricao") ?? "").slice(0, LIM.descricao).trim();
  const fotosArq = form.getAll("fotos").filter((f): f is File => f instanceof File && f.size > 0);
  const docsArq = form.getAll("docs").filter((f): f is File => f instanceof File && f.size > 0);
  const audio = form.get("audio");

  if (fotosArq.length > LIM.fotos) return falha(400, "fotos_demais", `Envie até ${LIM.fotos} fotos.`);
  if (docsArq.length > LIM.documentos) return falha(400, "docs_demais", `Envie até ${LIM.documentos} documentos no cadastro rápido.`);

  const avisos: string[] = [];
  let total = 0;

  // ---- áudio: transcreve se houver serviço; senão aceita e avisa
  if (audio instanceof File && audio.size > 0) {
    if (audio.size > LIM.audioBytes) {
      avisos.push(`O áudio passa de ${LIM.audioBytes / 1048576} MB e foi ignorado.`);
    } else if (!audio.type.startsWith("audio/") && !audio.type.startsWith("video/")) {
      avisos.push("O arquivo de áudio não foi reconhecido e foi ignorado.");
    } else if (transcricaoConfigurada()) {
      const t = await transcreverAudio(audio);
      if (t) descricao = `${descricao}\n\nTranscrição do áudio do anunciante:\n${t}`.trim();
      else avisos.push("Não consegui transcrever o áudio agora; usei só o texto e os arquivos.");
    } else {
      avisos.push("Transcrição indisponível. A análise usa o texto, as fotos e os documentos enviados.");
    }
  }

  // ---- fotos: o tipo é conferido pelo conteúdo, não pelo nome
  const fotos: MidiaParaIa[] = [];
  const fotosLidas: number[] = [];
  for (const [i, f] of fotosArq.entries()) {
    if (f.size > LIM.fotoBytes) { avisos.push(`A foto ${i + 1} veio grande demais e não foi analisada.`); continue; }
    const bytes = Buffer.from(await f.arrayBuffer());
    const tipo = tipoReal(new Uint8Array(bytes.subarray(0, 64)), f.name);
    if (!tipo || !(tipo in TIPO_IMAGEM)) { avisos.push(`A foto ${i + 1} está num formato que a Ari não lê (ex.: HEIC) e não foi analisada.`); continue; }
    total += bytes.length;
    fotos.push({ tipo: "imagem", media_type: TIPO_IMAGEM[tipo as keyof typeof TIPO_IMAGEM], base64: bytes.toString("base64") });
    fotosLidas.push(i);
  }

  // ---- documentos
  const documentos: MidiaParaIa[] = [];
  const docsLidos: number[] = [];
  for (const [i, d] of docsArq.entries()) {
    const bytes = Buffer.from(await d.arrayBuffer());
    const tipo = tipoReal(new Uint8Array(bytes.subarray(0, 64)), d.name);
    const nome = d.name || `documento ${i + 1}`;
    if (tipo === "pdf") {
      if (bytes.length > LIM.docPdfBytes) { avisos.push(`${nome} passa de ${LIM.docPdfBytes / 1048576} MB e não foi lido (anexe no formulário).`); continue; }
      documentos.push({ tipo: "pdf", base64: bytes.toString("base64") });
    } else if (tipo && tipo in TIPO_IMAGEM) {
      if (bytes.length > LIM.docImagemBytes) { avisos.push(`${nome} passa de ${LIM.docImagemBytes / 1048576} MB e não foi lido.`); continue; }
      documentos.push({ tipo: "imagem", media_type: TIPO_IMAGEM[tipo as keyof typeof TIPO_IMAGEM], base64: bytes.toString("base64") });
    } else {
      avisos.push(`${nome} não é PDF nem imagem legível pela Ari (HEIC, Word e CAD ficam de fora) e não foi lido.`);
      continue;
    }
    total += bytes.length;
    docsLidos.push(i);
  }

  if (total > LIM.totalBytes) {
    return falha(413, "envio_grande", "O material passou do tamanho máximo do cadastro rápido.", {
      motivo: `Até ${LIM.totalBytes / 1048576} MB entre fotos e documentos por envio.`,
      solucao: "Mande menos documentos ou PDFs menores; o restante você anexa no formulário.",
    });
  }
  if (!descricao && !fotos.length && !documentos.length) {
    return falha(400, "sem_material", "Escreva uma descrição ou anexe fotos e documentos para a Ari ler.");
  }

  let resultado: Awaited<ReturnType<typeof extrairAnuncio>>;
  try {
    resultado = await extrairAnuncio(new Anthropic(), modeloIa(), { descricao, fotos, documentos });
  } catch (e) {
    console.error("cadastro rápido falhou:", e);
    return falha(502, "ia_falhou", "A Ari não conseguiu ler o material agora.", {
      solucao: "Tente de novo em instantes ou preencha o formulário normalmente.",
    });
  }
  const ex = resultado.extracao;
  if (!ex) {
    return falha(422, "sem_extracao", "A Ari não conseguiu montar o anúncio com esse material.", {
      solucao: "Escreva um pouco mais sobre o imóvel (tipo, município, área, valor) e tente de novo.",
    });
  }

  // os índices do modelo contam só o que foi lido; a tela precisa dos índices do envio original
  ex.fotos.ordem = ex.fotos.ordem.map((i) => fotosLidas[i]);
  for (let i = 0; i < fotosArq.length; i++) if (!ex.fotos.ordem.includes(i)) ex.fotos.ordem.push(i);
  ex.fotos.capa = ex.fotos.capa == null ? null : fotosLidas[ex.fotos.capa];
  ex.fotos.problemas = ex.fotos.problemas.map((p) => ({ ...p, indice: fotosLidas[p.indice] }));
  ex.documentos = ex.documentos.map((d) => ({ ...d, indice: docsLidos[d.indice] }));

  await logAudit({
    user_id: userId, acao: "ia_cadastro_rapido", entidade: "ia", entidade_id: null,
    dados_depois: {
      fotos: fotos.length, documentos: documentos.length, caracteres: descricao.length,
      tokens_entrada: resultado.uso.entrada, tokens_saida: resultado.uso.saida, modelo: modeloIa(),
      confianca: ex.confianca,
    },
  });
  return NextResponse.json({ ok: true, extracao: ex, avisos });
}
