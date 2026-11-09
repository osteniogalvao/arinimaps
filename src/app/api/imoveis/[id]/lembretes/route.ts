import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ator } from "@/lib/authz";
import { falha } from "@/lib/erros";
import { limitar, respostaLimite } from "@/lib/seguranca/limite";
import { ehAnuncianteDoImovel } from "@/lib/acompanhamento/servidor";

/**
 * Lembretes do proprietário (item 28): data + texto ligados ao imóvel. O
 * worker (job `lembretes_proprietario`) manda o e-mail na data.
 *
 *   POST   { data: "2026-11-20", texto }  → cria
 *   DELETE ?lembrete=<id>                 → apaga (só os próprios)
 */
const MAX_PENDENTES = 50;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function hojeSP() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}

async function contexto(id: string) {
  const a = await ator();
  if (!a) return { erro: falha(401, "sem_sessao", "Sessão expirada.") };
  if (!(await ehAnuncianteDoImovel(a, id))) return { erro: falha(403, "sem_acesso", "Sem acesso a este imóvel.") };
  return { a };
}

export async function POST(request: Request, ctx: RouteContext<"/api/imoveis/[id]/lembretes">) {
  const { id } = await ctx.params;
  const { a, erro } = await contexto(id);
  if (erro) return erro;
  const l = await limitar(`lembrete:${a.userId}`, 30, 3600);
  if (!l.permitido) return respostaLimite(l, "criar lembretes");

  const b = (await request.json().catch(() => null)) as { data?: unknown; texto?: unknown } | null;
  const data = String(b?.data ?? "");
  const texto = String(b?.texto ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data) || Number.isNaN(Date.parse(data))) return falha(400, "dados_invalidos", "Informe a data do lembrete.");
  if (data < hojeSP()) return falha(400, "dados_invalidos", "A data do lembrete já passou.");
  if (data > `${new Date().getFullYear() + 5}-12-31`) return falha(400, "dados_invalidos", "Data distante demais.");
  if (!texto || texto.length > 500) return falha(400, "dados_invalidos", "Escreva o lembrete (até 500 caracteres).");

  const admin = supabaseAdmin();
  const { count, error: errContagem } = await admin.from("property_lembretes")
    .select("id", { count: "exact", head: true })
    .eq("property_id", id).eq("user_id", a.userId).is("enviado_em", null);
  if (errContagem) {
    return falha(503, "recurso_indisponivel", "Os lembretes ainda não estão disponíveis.", { motivo: errContagem.message });
  }
  if ((count ?? 0) >= MAX_PENDENTES) return falha(400, "limite", `Você já tem ${MAX_PENDENTES} lembretes pendentes neste imóvel.`);

  const { data: novo, error } = await admin.from("property_lembretes")
    .insert({ property_id: id, user_id: a.userId, data, texto }).select("id").single();
  if (error) return falha(500, "banco", "Não foi possível criar o lembrete.", { motivo: error.message });
  return NextResponse.json({ ok: true, id: novo.id });
}

export async function DELETE(request: Request, ctx: RouteContext<"/api/imoveis/[id]/lembretes">) {
  const { id } = await ctx.params;
  const { a, erro } = await contexto(id);
  if (erro) return erro;
  const lembrete = new URL(request.url).searchParams.get("lembrete") ?? "";
  if (!UUID.test(lembrete)) return falha(400, "dados_invalidos", "Lembrete inválido.");
  const { error } = await supabaseAdmin().from("property_lembretes")
    .delete().eq("id", lembrete).eq("property_id", id).eq("user_id", a.userId);
  if (error) return falha(500, "banco", "Não foi possível apagar o lembrete.", { motivo: error.message });
  return NextResponse.json({ ok: true });
}
