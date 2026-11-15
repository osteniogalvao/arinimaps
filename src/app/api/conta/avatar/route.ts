import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { currentUser } from "@/lib/supabase/server";
import { falha } from "@/lib/erros";
import { logAudit } from "@/lib/audit";
import { limitar, respostaLimite } from "@/lib/seguranca/limite";
import { conferirArquivo } from "@/lib/seguranca/arquivos";

/**
 * Foto do perfil (4.6) — à parte da selfie da exclusividade, que é prova
 * jurídica e fica no bucket privado. A foto é pública (bucket `media`), em
 * `avatars/<user_id>/<ts>.webp`; a anterior é apagada.
 *
 * O navegador já manda a imagem reduzida para 512 px em WebP; aqui só se
 * confere tipo e tamanho, porque o cliente não é confiável.
 */
const TIPOS = ["image/webp", "image/jpeg", "image/png"];
const MAX = 3 * 1024 * 1024;

/** Caminho no bucket a partir da URL pública, se for uma foto desta conta. */
function caminhoDaFoto(url: string | null | undefined, userId: string): string | null {
  if (!url) return null;
  const m = /\/storage\/v1\/object\/public\/media\/(avatars\/[^?]+)/.exec(url);
  return m && m[1].startsWith(`avatars/${userId}/`) ? decodeURIComponent(m[1]) : null;
}

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return falha(401, "sem_sessao", "Sessão expirada.", { solucao: "Entre de novo." });
  const limite = await limitar(`conta:avatar:${user.id}`, 10, 3600);
  if (!limite.permitido) return respostaLimite(limite, "envio de foto");

  const form = await request.formData().catch(() => null);
  const arquivo = form?.get("foto");
  if (!(arquivo instanceof File)) return falha(400, "sem_arquivo", "Envie a foto.");
  if (!TIPOS.includes(arquivo.type)) {
    return falha(400, "tipo_invalido", "Formato não aceito.", { solucao: "Use JPG, PNG ou WebP." });
  }
  // o bucket é público: o conteúdo precisa ser imagem de verdade (bytes), não só o tipo declarado
  const conferido = await conferirArquivo(arquivo, ["jpg", "png", "webp"], MAX);
  if (!conferido.ok) return falha(400, "tipo_invalido", conferido.erro, { solucao: "Use JPG, PNG ou WebP de até 3 MB." });

  const admin = supabaseAdmin();
  const path = `avatars/${user.id}/${Date.now()}.${conferido.arquivo.ext}`;
  const { error: upErro } = await admin.storage.from("media")
    .upload(path, conferido.arquivo.bytes, { contentType: conferido.arquivo.contentType, cacheControl: "31536000", upsert: false });
  if (upErro) return falha(500, "erro_storage", "Não foi possível guardar a foto.", { motivo: upErro.message });

  const url = admin.storage.from("media").getPublicUrl(path).data.publicUrl;
  const { data: antes } = await admin.from("profiles").select("avatar_url").eq("user_id", user.id).single();
  const { data: salvo, error } = await admin.from("profiles").update({ avatar_url: url }).eq("user_id", user.id).eq("ativo",true).select("user_id").maybeSingle();
  if (error || !salvo) {
    await admin.storage.from("media").remove([path]);
    return falha(500, "erro_banco", "Não foi possível salvar a foto.", { motivo: error?.message ?? "Conta inativa." });
  }
  const velha = caminhoDaFoto(antes?.avatar_url, user.id);
  if (velha) await admin.storage.from("media").remove([velha]);

  await logAudit({ user_id: user.id, acao: "foto_perfil_alterada", entidade: "profiles", entidade_id: user.id });
  return NextResponse.json({ ok: true, avatar_url: url });
}

export async function DELETE() {
  const user = await currentUser();
  if (!user) return falha(401, "sem_sessao", "Sessão expirada.", { solucao: "Entre de novo." });
  const admin = supabaseAdmin();
  const { data: antes } = await admin.from("profiles").select("avatar_url").eq("user_id", user.id).single();
  await admin.from("profiles").update({ avatar_url: null }).eq("user_id", user.id);
  const velha = caminhoDaFoto(antes?.avatar_url, user.id);
  if (velha) await admin.storage.from("media").remove([velha]);
  await logAudit({ user_id: user.id, acao: "foto_perfil_removida", entidade: "profiles", entidade_id: user.id });
  return NextResponse.json({ ok: true });
}
