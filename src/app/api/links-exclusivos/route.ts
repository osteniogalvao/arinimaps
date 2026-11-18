import { NextResponse } from "next/server";
import { ator } from "@/lib/authz";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { limitar, respostaLimite } from "@/lib/seguranca/limite";
import { urlDoSite } from "@/lib/compartilhar";

/**
 * Cria um link exclusivo do Tour 3D de um imóvel anunciado (áudio do Carlos,
 * 18/11/2026). Só com conta: o link registra quem o gerou.
 */
export async function POST(req: Request) {
  const a = await ator();
  if (!a) return NextResponse.json({ error: "Entre na sua conta para gerar o link exclusivo." }, { status: 401 });
  const corpo = await req.json().catch(() => null) as { codigo?: unknown; destinatario?: unknown; destino?: unknown; dias?: unknown } | null;
  const codigo = typeof corpo?.codigo === "string" ? corpo.codigo.trim().toUpperCase() : "";
  if (!/^AIB-\d{6}$/.test(codigo)) return NextResponse.json({ error: "Imóvel inválido." }, { status: 400 });
  const destino = corpo?.destino === "ficha" ? "ficha" : "tour";
  const destinatario = typeof corpo?.destinatario === "string" ? corpo.destinatario.trim().slice(0, 80) || null : null;
  const dias = Math.min(30, Math.max(1, Math.round(Number(corpo?.dias) || 7)));

  const limite = await limitar("links-exclusivos:" + a.userId, 30, 3600);
  if (!limite.permitido) return respostaLimite(limite, "gerar link exclusivo");

  const admin = supabaseAdmin();
  const { data: imovel } = await admin.rpc("fn_property_public", { p_codigo: codigo });
  const im = imovel as { status?: string; geometry?: unknown } | null;
  if (!im || !["publicado", "em_negociacao"].includes(im.status ?? "")) {
    return NextResponse.json({ error: "Só imóveis anunciados têm link exclusivo." }, { status: 404 });
  }
  if (destino === "tour" && !im.geometry) {
    return NextResponse.json({ error: "Este imóvel ainda não tem a divisa no mapa, então não tem Tour 3D." }, { status: 409 });
  }
  const expira = new Date(Date.now() + dias * 86_400_000).toISOString();
  const { data, error } = await admin.from("links_exclusivos")
    .insert({ criado_por: a.userId, codigo, destino, destinatario, expira_em: expira })
    .select("token, expira_em").single();
  if (error || !data) {
    console.error("[links-exclusivos] criar:", error?.message);
    return NextResponse.json({ error: "Não foi possível gerar o link agora. Se persistir, a migration 0152 pode não ter sido aplicada." }, { status: 503 });
  }
  return NextResponse.json({ url: `${urlDoSite()}/x/${data.token}`, token: data.token, expira_em: data.expira_em });
}
