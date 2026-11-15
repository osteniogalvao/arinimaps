import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { currentUser } from "@/lib/supabase/server";
import { falha } from "@/lib/erros";
import { limitar, respostaLimite, ipDoPedido } from "@/lib/seguranca/limite";
import { registrarEventoImovel } from "@/lib/imovel/eventos";
import { STATUS_VITRINE } from "@/lib/imovel/vitrine";
import {
  COOKIE_FAVORITOS, codigoValido, codigosFavoritosDaConta, juntarCookieNaConta, lerCodigosDoCookie,
} from "@/lib/imovel/favoritos";


/**
 * GET  /api/favoritos                          → { codigos: [...] }
 * POST /api/favoritos { codigo, favorito }     → marca/desmarca; { codigos, total }
 *
 * Com conta grava na tabela `favoritos`; sem conta, no cookie `arini_fav`.
 * Na primeira chamada depois de entrar, o que estava no cookie vai para a conta.
 */
export async function GET() {
  const user = await currentUser();
  const jar = await cookies();
  const doCookie = lerCodigosDoCookie(jar.get(COOKIE_FAVORITOS)?.value);
  if (!user) return NextResponse.json({ codigos: doCookie }, { headers: { "Cache-Control": "no-store" } });
  if (doCookie.length) {
    await juntarCookieNaConta(user.id, doCookie);
    jar.delete(COOKIE_FAVORITOS);
  }
  return NextResponse.json({ codigos: await codigosFavoritosDaConta(user.id) }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return falha(401, "sem_sessao", "Entre para salvar favoritos.");
  const l = await limitar(`favorito:${ipDoPedido(request)}`, 120, 600);
  if (!l.permitido) return respostaLimite(l, "favoritar");

  const corpo = await request.json().catch(() => null) as { codigo?: unknown; favorito?: unknown } | null;
  const codigo = typeof corpo?.codigo === "string" ? corpo.codigo.trim().toUpperCase() : null;
  if (!codigoValido(codigo)) return falha(400, "codigo_invalido", "Código de imóvel inválido.");
  const marcar = corpo?.favorito !== false;

  const admin = supabaseAdmin();
  // só imóvel que está na vitrine pode ser favoritado
  const { data: imovel } = await admin.from("properties").select("id").eq("codigo", codigo)
    .in("status", [...STATUS_VITRINE]).maybeSingle();
  if (!imovel) return falha(404, "imovel_nao_encontrado", "Imóvel não encontrado.");

  const jar = await cookies();
  const doCookie = lerCodigosDoCookie(jar.get(COOKIE_FAVORITOS)?.value);
  if (doCookie.length) {
    await juntarCookieNaConta(user.id, doCookie.filter((c) => c !== codigo));
    jar.delete(COOKIE_FAVORITOS);
  }
  if (marcar) {
    const { error } = await admin.from("favoritos").upsert(
      { user_id: user.id, property_id: imovel.id }, { onConflict: "user_id,property_id", ignoreDuplicates: true },
    );
    if (error) return falha(500, "favorito_falhou", "Não foi possível salvar o favorito. Tente de novo.");
    void registrarEventoImovel({ propertyId: imovel.id, tipo: "favorito", userId: user.id, request, detalhe: { codigo } });
  } else {
    await admin.from("favoritos").delete().eq("user_id", user.id).eq("property_id", imovel.id);
  }
  const codigos = await codigosFavoritosDaConta(user.id);
  return NextResponse.json({ codigos, total: codigos.length });
}
