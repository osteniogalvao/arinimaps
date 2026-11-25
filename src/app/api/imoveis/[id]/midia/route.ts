import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { ator, temSetor, type Ator } from "@/lib/authz";
import { limitar, respostaLimite } from "@/lib/seguranca/limite";
import { registrarEventoImovel } from "@/lib/imovel/eventos";
import { recusaPorArmazenamento } from "@/lib/armazenamento";
import { VIDEO_MAX_MB } from "@/lib/midia/limites";

/**
 * Vídeos do imóvel enviados pelo anunciante.
 *
 * O arquivo NÃO passa pelo servidor do site: a rota entrega uma autorização de
 * envio de uso único e o navegador manda o vídeo direto para o armazenamento.
 * Vídeo grande atravessando o servidor ocuparia memória e conexão à toa — e
 * a VPS é pequena.
 *
 * Limite de 500 MB por vídeo (pedido do Stenio, 24/11/2026). O limite de envio
 * do Supabase Storage (Settings > Storage > Upload file size limit) precisa
 * estar em 500 MB ou mais, senão o armazenamento recusa o arquivo.
 */
const MAX_BYTES = VIDEO_MAX_MB * 1024 * 1024;
const MAX_VIDEOS = 3;
const TIPOS: Record<string, string> = { "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov" };

async function podeEditar(a: Ator, propertyId: string) {
  // equipe: mídia do anúncio é do setor de Operações (diretoria atua em todos)
  if (a.ehArini) return temSetor(a, "operacoes");
  const { data: p } = await supabaseAdmin().from("properties").select("owner_id, partner_id").eq("id", propertyId).single();
  return !!p && ((!!a.ownerId && p.owner_id === a.ownerId) || (!!a.partnerId && p.partner_id === a.partnerId));
}

/** Passo 1: pede a autorização de envio. */
export async function POST(request: Request, ctx: RouteContext<"/api/imoveis/[id]/midia">) {
  const { id } = await ctx.params;
  const a = await ator();
  if (!a) return NextResponse.json({ error: "Sessão expirada." }, { status: 401 });
  if (!(await podeEditar(a, id))) return NextResponse.json({ error: "Sem acesso a este imóvel." }, { status: 403 });

  const limite = await limitar(`midia:${a.userId}`, 20, 3600);
  if (!limite.permitido) return respostaLimite(limite, "envio");

  const b = await request.json().catch(() => ({}));
  const ext = TIPOS[String(b.tipo)];
  if (!ext) return NextResponse.json({ error: "Formato de vídeo não aceito. Use MP4, MOV ou WebM." }, { status: 400 });
  const tamanho = Number(b.tamanho);
  if (!Number.isFinite(tamanho) || tamanho <= 0 || tamanho > MAX_BYTES) {
    return NextResponse.json({
      error: `O vídeo tem ${(tamanho / 1048576).toFixed(0)} MB e o limite é ${VIDEO_MAX_MB} MB. Grave em 1080p ou corte o vídeo em partes.`,
    }, { status: 400 });
  }

  const admin = supabaseAdmin();
  const { count } = await admin.from("property_media").select("id", { count: "exact", head: true })
    .eq("property_id", id).eq("tipo", "video");
  if ((count ?? 0) >= MAX_VIDEOS) {
    return NextResponse.json({ error: `Cada imóvel aceita até ${MAX_VIDEOS} vídeos. Remova um para enviar outro.` }, { status: 400 });
  }

  if (!a.ehArini) {
    const cota = await recusaPorArmazenamento(a.userId, a.acesso, tamanho);
    if (cota) return NextResponse.json({ error: cota }, { status: 413 });
  }
  const path = `properties/${id}/video-${crypto.randomUUID()}.${ext}`;
  const { data, error } = await admin.storage.from("media").createSignedUploadUrl(path);
  if (error || !data) return NextResponse.json({ error: error?.message ?? "Armazenamento indisponível." }, { status: 502 });
  return NextResponse.json({ path, token: data.token });
}

/** Passo 2: o envio terminou — registra o vídeo no imóvel. */
export async function PUT(request: Request, ctx: RouteContext<"/api/imoveis/[id]/midia">) {
  const { id } = await ctx.params;
  const a = await ator();
  if (!a) return NextResponse.json({ error: "Sessão expirada." }, { status: 401 });
  if (!(await podeEditar(a, id))) return NextResponse.json({ error: "Sem acesso a este imóvel." }, { status: 403 });

  const path = String((await request.json().catch(() => ({}))).path ?? "");
  // o caminho tem de ser deste imóvel: ninguém registra arquivo de outro
  if (!path.startsWith(`properties/${id}/video-`)) return NextResponse.json({ error: "Arquivo inválido." }, { status: 400 });

  const admin = supabaseAdmin();
  const nome = path.split("/").pop()!;
  const { data: arquivos } = await admin.storage.from("media").list(`properties/${id}`, { search: nome });
  if (!arquivos?.some((f) => f.name === nome)) {
    return NextResponse.json({ error: "O vídeo não chegou ao armazenamento. Tente enviar de novo." }, { status: 400 });
  }

  const { count } = await admin.from("property_media").select("id", { count: "exact", head: true }).eq("property_id", id);
  const { data, error } = await admin.from("property_media")
    .insert({ property_id: id, tipo: "video", storage_path: path, ordem: (count ?? 0) + 1 }).select("id").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  // o worker converte para MP4 720p (toca em iPhone e Android, 4–6× menor)
  await admin.from("jobs").insert({ tipo: "otimizar_video", payload: { media_id: data.id } });
  await logAudit({ user_id: a.userId, acao: "video_anexado", entidade: "property_media", entidade_id: data.id, property_id: id });
  void registrarEventoImovel({ propertyId: id, tipo: "midia", userId: a.userId, partnerId: a.partnerId, request, detalhe: { acao: "video_anexado", path } });
  return NextResponse.json({ ok: true, id: data.id });
}

export async function DELETE(request: Request, ctx: RouteContext<"/api/imoveis/[id]/midia">) {
  const { id } = await ctx.params;
  const a = await ator();
  if (!a) return NextResponse.json({ error: "Sessão expirada." }, { status: 401 });
  if (!(await podeEditar(a, id))) return NextResponse.json({ error: "Sem acesso a este imóvel." }, { status: 403 });

  const mediaId = String((await request.json().catch(() => ({}))).media_id ?? "");
  const admin = supabaseAdmin();
  const { data: m } = await admin.from("property_media").select("id, storage_path, tipo")
    .eq("id", mediaId).eq("property_id", id).eq("tipo", "video").maybeSingle();
  if (!m) return NextResponse.json({ error: "Vídeo não encontrado." }, { status: 404 });

  await admin.from("property_media").delete().eq("id", m.id);
  await admin.storage.from("media").remove([m.storage_path]);
  await logAudit({ user_id: a.userId, acao: "video_removido", entidade: "property_media", entidade_id: m.id, property_id: id });
  void registrarEventoImovel({ propertyId: id, tipo: "midia", userId: a.userId, partnerId: a.partnerId, request, detalhe: { acao: "video_removido", path: m.storage_path } });
  return NextResponse.json({ ok: true });
}
