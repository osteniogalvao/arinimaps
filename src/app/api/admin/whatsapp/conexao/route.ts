import { NextResponse } from "next/server";
import { ator, temSetor } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import { urlDoSite } from "@/lib/compartilhar";
import { numeroDaApiWhatsapp, provedorWhatsapp } from "@/lib/meta";
import { evolutionConectar, evolutionConfigurada, evolutionEstado, evolutionPreparar, EvolutionErro } from "@/lib/whatsapp/evolution";

/**
 * Conexão do WhatsApp (Diretoria). GET: provedor, estado e número.
 * POST {acao:"preparar"}: cria a instância na Evolution e aponta o webhook.
 * POST {acao:"qr"}: QR Code para ler no celular do número.
 */
const semCache = { headers: { "Cache-Control": "private, no-store" } };

export async function GET() {
  const a = await ator();
  if (!temSetor(a, "diretoria")) return NextResponse.json({ error: "Restrito à Diretoria." }, { status: 403 });
  const provedor = provedorWhatsapp();
  const pendentes = [
    !process.env.EVOLUTION_API_URL && "EVOLUTION_API_URL",
    !process.env.EVOLUTION_API_KEY && "EVOLUTION_API_KEY",
    !process.env.EVOLUTION_INSTANCE && "EVOLUTION_INSTANCE",
    (process.env.EVOLUTION_WEBHOOK_TOKEN ?? "").length < 16 && "EVOLUTION_WEBHOOK_TOKEN (16+ caracteres)",
  ].filter(Boolean);
  let estado: string | null = null, erro: string | null = null;
  if (provedor === "evolution") {
    estado = await evolutionEstado().catch((e) => { erro = e instanceof EvolutionErro ? e.mensagem : "Evolution indisponível."; return null; });
  }
  const numero = estado === "open" || provedor === "meta" ? await numeroDaApiWhatsapp().catch(() => null) : null;
  return NextResponse.json({
    provedor, estado, erro, numero, pendentes: evolutionConfigurada() ? pendentes.slice(3) : pendentes,
    cotacoes: process.env.EVOLUTION_COTACOES_INSTANCE ?? null,
  }, semCache);
}

export async function POST(request: Request) {
  const a = await ator();
  if (!temSetor(a, "diretoria")) return NextResponse.json({ error: "Restrito à Diretoria." }, { status: 403 });
  if (!evolutionConfigurada()) return NextResponse.json({ error: "Configure EVOLUTION_API_URL, EVOLUTION_API_KEY e EVOLUTION_INSTANCE na VPS." }, { status: 409 });
  const b = await request.json().catch(() => ({}));
  const canal = b?.linha === "cotacoes" ? process.env.EVOLUTION_COTACOES_INSTANCE : undefined;
  if (b?.linha === "cotacoes" && !canal) return NextResponse.json({ error: "EVOLUTION_COTACOES_INSTANCE não configurada." }, { status: 409 });
  try {
    if (b?.acao === "preparar") {
      if ((process.env.EVOLUTION_WEBHOOK_TOKEN ?? "").length < 16)
        return NextResponse.json({ error: "Defina EVOLUTION_WEBHOOK_TOKEN (16+ caracteres) antes de ligar o webhook." }, { status: 409 });
      const r = await evolutionPreparar(urlDoSite(), canal);
      await logAudit({ user_id: a!.userId, acao: "whatsapp_evolution_preparado", entidade: "whatsapp", dados_depois: r });
      return NextResponse.json(r, semCache);
    }
    if (b?.acao === "qr") return NextResponse.json(await evolutionConectar(canal), semCache);
  } catch (e) {
    if (e instanceof EvolutionErro) return NextResponse.json({ error: e.mensagem }, { status: 502 });
    throw e;
  }
  return NextResponse.json({ error: "Ação inválida." }, { status: 400 });
}
