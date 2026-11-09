import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ator } from "@/lib/authz";
import { falha } from "@/lib/erros";
import { logAudit } from "@/lib/audit";
import { limitar, respostaLimite } from "@/lib/seguranca/limite";
import { conferirArquivo, type TipoReal } from "@/lib/seguranca/arquivos";
import { urlArquivo } from "@/lib/seguranca/link-arquivo";
import { ehAnuncianteDoImovel } from "@/lib/acompanhamento/servidor";

/**
 * Arquivos de projeto da Minha área (item 29): PDF, imagem, DWG/DXF, KML/KMZ,
 * ligados a um desenho ou ao imóvel. Ficam no cofre privado `docs`, como os
 * documentos do imóvel, e abrem por /api/arquivos (confere dono a cada clique).
 *
 *   POST   multipart { arquivo, desenho_id? }
 *   DELETE ?arquivo=<id>
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACEITA_PROJETO: TipoReal[] = ["pdf", "jpg", "png", "webp", "heic", "gif", "dwg", "dxf", "kml", "zip"];
const MAX_BYTES = 25 * 1024 * 1024;
const MAX_ARQUIVOS = 200;

export async function POST(request: Request, ctx: RouteContext<"/api/imoveis/[id]/minha-area/arquivos">) {
  const { id } = await ctx.params;
  if (!UUID.test(id)) return falha(400, "dados_invalidos", "Imóvel inválido.");
  const a = await ator();
  if (!a) return falha(401, "sem_sessao", "Sessão expirada.");
  if (!(await ehAnuncianteDoImovel(a, id))) return falha(403, "sem_acesso", "Só o dono do imóvel anexa arquivos na Minha área.");
  const l = await limitar(`minha-area-arq:${a.userId}`, 60, 3600);
  if (!l.permitido) return respostaLimite(l, "anexar arquivos");

  const form = await request.formData();
  const arquivo = form.get("arquivo");
  const desenhoId = String(form.get("desenho_id") ?? "");
  if (!(arquivo instanceof File)) return falha(400, "dados_invalidos", "Envie o arquivo.");
  if (desenhoId && !UUID.test(desenhoId)) return falha(400, "dados_invalidos", "Desenho inválido.");

  const admin = supabaseAdmin();
  const { count, error: errTabela } = await admin.from("property_area_arquivos")
    .select("id", { count: "exact", head: true }).eq("property_id", id);
  if (errTabela) return falha(503, "recurso_indisponivel", "A Minha área ainda não está disponível.", { motivo: errTabela.message });
  if ((count ?? 0) >= MAX_ARQUIVOS) return falha(400, "limite", `Limite de ${MAX_ARQUIVOS} arquivos por imóvel.`);
  if (desenhoId) {
    const { data: d } = await admin.from("property_area_desenhos").select("id").eq("id", desenhoId).eq("property_id", id).maybeSingle();
    if (!d) return falha(404, "nao_encontrado", "Desenho não encontrado.");
  }

  // tipo pelo conteúdo, não pelo nome (auditoria 6.2)
  const conferido = await conferirArquivo(arquivo, ACEITA_PROJETO, MAX_BYTES);
  if (!conferido.ok) return falha(400, "arquivo_invalido", conferido.erro, { solucao: "Envie PDF, imagem, DWG, DXF, KML ou KMZ de até 25 MB." });

  const path = `imoveis/${id}/minha-area/${crypto.randomUUID()}.${conferido.arquivo.ext}`;
  const { error: upErro } = await admin.storage.from("docs")
    .upload(path, conferido.arquivo.bytes, { contentType: conferido.arquivo.contentType });
  if (upErro) return falha(502, "armazenamento", "Não foi possível guardar o arquivo.", { motivo: upErro.message });

  const nome = arquivo.name.replace(/[\u0000-\u001f]/g, "").slice(0, 200) || "arquivo";
  const { data, error } = await admin.from("property_area_arquivos").insert({
    property_id: id, desenho_id: desenhoId || null, storage_path: path, nome_arquivo: nome,
    tamanho_bytes: arquivo.size, enviado_por: a.userId,
  }).select("id, desenho_id, nome_arquivo, tamanho_bytes, created_at").single();
  if (error) {
    await admin.storage.from("docs").remove([path]).catch(() => undefined);
    return falha(500, "banco", "Não foi possível registrar o arquivo.", { motivo: error.message });
  }
  await logAudit({ user_id: a.userId, acao: "minha_area_arquivo", entidade: "property_area_arquivos", entidade_id: data.id, property_id: id, dados_depois: { nome } });
  return NextResponse.json({ ok: true, arquivo: { ...data, url: urlArquivo(path) } });
}

/** imoveis/<id>/minha-area/<arquivo>, sem subir de pasta */
function caminhoDaMinhaArea(path: string, propertyId: string) {
  const prefixo = `imoveis/${propertyId}/minha-area/`;
  return path.startsWith(prefixo) && /^[A-Za-z0-9._-]+$/.test(path.slice(prefixo.length)) && !path.includes("..");
}

export async function DELETE(request: Request, ctx: RouteContext<"/api/imoveis/[id]/minha-area/arquivos">) {
  const { id } = await ctx.params;
  if (!UUID.test(id)) return falha(400, "dados_invalidos", "Imóvel inválido.");
  const a = await ator();
  if (!a) return falha(401, "sem_sessao", "Sessão expirada.");
  if (!(await ehAnuncianteDoImovel(a, id))) return falha(403, "sem_acesso", "Sem acesso a este imóvel.");
  const arquivoId = new URL(request.url).searchParams.get("arquivo") ?? "";
  if (!UUID.test(arquivoId)) return falha(400, "dados_invalidos", "Arquivo inválido.");
  const admin = supabaseAdmin();
  const { data: arq } = await admin.from("property_area_arquivos").select("id, storage_path, nome_arquivo")
    .eq("id", arquivoId).eq("property_id", id).maybeSingle();
  if (!arq) return falha(404, "nao_encontrado", "Arquivo não encontrado.");
  // só apaga do cofre o que está na pasta da Minha área deste imóvel
  if (!caminhoDaMinhaArea(arq.storage_path, id)) return falha(400, "dados_invalidos", "Arquivo fora da Minha área.");
  const { error } = await admin.from("property_area_arquivos").delete().eq("id", arq.id);
  if (error) return falha(500, "banco", "Não foi possível apagar.", { motivo: error.message });
  await admin.storage.from("docs").remove([arq.storage_path]).catch(() => undefined);
  await logAudit({ user_id: a.userId, acao: "minha_area_arquivo_apagado", entidade: "property_area_arquivos", entidade_id: arq.id, property_id: id, dados_antes: { nome: arq.nome_arquivo } });
  return NextResponse.json({ ok: true });
}
