import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ator, temSetor } from "@/lib/authz";
import { briefing } from "@/lib/ia/central";
import { iaConfigurada } from "@/lib/ia/config";

/** Próxima ação sugerida pela IA para uma oportunidade, a partir do histórico dela. */
export async function GET(request: Request) {
  const a = await ator();
  if (!temSetor(a, "comercial", "diretoria")) return NextResponse.json({ error: "Restrito ao Comercial." }, { status: 403 });
  if (!iaConfigurada()) return NextResponse.json({ desligada: true });
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Oportunidade inválida." }, { status: 400 });
  const admin = supabaseAdmin();
  const [{ data: opp }, { data: eventos }, { data: visitas }, { data: propostas }] = await Promise.all([
    admin.from("opportunities").select("codigo, etapa, qualificacao, created_at, primeiro_atendimento_em, property:properties(codigo, tipo, valor, area_declarada)").eq("id", id).maybeSingle(),
    admin.from("opportunity_events").select("tipo, descricao, created_at").eq("opportunity_id", id).order("created_at", { ascending: false }).limit(25),
    admin.from("visits").select("data_hora, status, relatorio").eq("opportunity_id", id).order("data_hora", { ascending: false }).limit(5),
    admin.from("proposals").select("numero_rodada, autor_lado, valor, status, created_at").eq("opportunity_id", id).order("created_at", { ascending: false }).limit(6),
  ]);
  if (!opp) return NextResponse.json({ error: "Oportunidade não encontrada." }, { status: 404 });
  try {
    const r = await briefing(
      "Sugira a próxima ação do corretor nesta negociação: no máximo 3 tópicos, o primeiro é a ação a fazer hoje (ligar, mandar algo, agendar, ajustar proposta), com o motivo tirado do histórico. Se faltar informação para decidir, diga qual.",
      { hoje: new Date().toISOString().slice(0, 10), oportunidade: opp, historico: eventos, visitas, propostas }, 400);
    return NextResponse.json(r ? { texto: r.texto } : { desligada: true });
  } catch (e) {
    console.error("ia proxima acao:", e);
    return NextResponse.json({ error: "A IA não respondeu agora." }, { status: 503 });
  }
}
