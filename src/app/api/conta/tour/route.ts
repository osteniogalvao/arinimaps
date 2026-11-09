import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { supabaseServer } from "@/lib/supabase/server";
import { falha } from "@/lib/erros";
import { limitar, respostaLimite } from "@/lib/seguranca/limite";

export const dynamic = "force-dynamic";

/**
 * Tours guiados já vistos pela conta (2ª etapa, item 14; migration 0062).
 * Sem a coluna `profiles.tours_vistos` (migration não aplicada) a rota
 * responde `registro: false` e o tour vive só no localStorage.
 */
const TOURS = ["mapa", "painel", "parceiro", "central"] as const;
const semColuna = (e: { code?: string; message?: string } | null) =>
  !!e && (e.code === "42703" || e.code === "PGRST204" || /tours_vistos/.test(e.message ?? ""));

async function usuarioId() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  return user?.id ?? null;
}

export async function GET() {
  const id = await usuarioId();
  if (!id) return NextResponse.json({ registro: false, vistos: [] });
  const { data, error } = await supabaseAdmin().from("profiles").select("tours_vistos").eq("user_id", id).maybeSingle();
  if (error) return NextResponse.json({ registro: false, vistos: [] });
  return NextResponse.json(
    { registro: true, vistos: ((data?.tours_vistos as string[] | null) ?? []).filter((t) => (TOURS as readonly string[]).includes(t)) },
    { headers: { "Cache-Control": "private, no-store" } }
  );
}

export async function POST(request: Request) {
  const id = await usuarioId();
  if (!id) return falha(401, "sem_sessao", "Entre na sua conta para guardar o tour.");
  const l = await limitar(`tour:${id}`, 20, 60);
  if (!l.permitido) return respostaLimite(l, "gravação");
  const corpo = (await request.json().catch(() => ({}))) as { tour?: unknown };
  const tour = typeof corpo.tour === "string" && (TOURS as readonly string[]).includes(corpo.tour) ? corpo.tour : null;
  if (!tour) return falha(400, "tour_invalido", "Tour desconhecido.");

  const admin = supabaseAdmin();
  const { data, error } = await admin.from("profiles").select("tours_vistos").eq("user_id", id).maybeSingle();
  if (semColuna(error)) return NextResponse.json({ ok: true, registro: false });
  if (error) return falha(500, "erro_banco", "Não foi possível guardar.", { motivo: error.message });
  const atuais = (data?.tours_vistos as string[] | null) ?? [];
  if (atuais.includes(tour)) return NextResponse.json({ ok: true, registro: true });
  const { error: e2 } = await admin.from("profiles").update({ tours_vistos: [...atuais, tour] }).eq("user_id", id);
  if (semColuna(e2)) return NextResponse.json({ ok: true, registro: false });
  if (e2) return falha(500, "erro_banco", "Não foi possível guardar.", { motivo: e2.message });
  return NextResponse.json({ ok: true, registro: true });
}
