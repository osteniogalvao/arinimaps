import { NextResponse } from "next/server";
import { currentUser } from "@/lib/supabase/server";
import { acessoDe } from "@/lib/planos-servidor";
import { exigirAparelhoAtivo, registrarDownload, usoDownloads } from "@/lib/seguranca/uso";

/**
 * Downloads de KML/KMZ por mês (limites por assinatura, 26/11/2026). O arquivo
 * é montado no navegador; antes de salvar, a tela registra aqui e só baixa se
 * couber na cota do plano.
 *   GET  → { usados, limite }   (limite 0 = sem limite)
 *   POST { formato: "kml"|"kmz", origem } → 200 ou 429 com a explicação
 */
export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Entre na sua conta." }, { status: 401 });
  return NextResponse.json(await usoDownloads(user.id, await acessoDe(user.id)), { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Entre na sua conta para baixar o arquivo." }, { status: 401 });
  const corpo = await request.json().catch(() => null) as { formato?: string; origem?: string } | null;
  const formato = corpo?.formato === "kml" ? "kml" : corpo?.formato === "kmz" ? "kmz" : null;
  if (!formato) return NextResponse.json({ error: "Formato inválido." }, { status: 400 });
  const acesso = await acessoDe(user.id);
  const aparelho = await exigirAparelhoAtivo(request, user.id, acesso);
  if (aparelho) return aparelho;
  const negado = await registrarDownload(request, user.id, acesso, formato, String(corpo?.origem ?? "mapa"));
  if (negado) return negado;
  return NextResponse.json({ ok: true });
}
