import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { limiteLeituraMapa } from "@/lib/geo/limiteMemoria";

/** Um lote urbano com divisa, área, perímetro e as medidas dos lados. */
export async function GET(request: Request, ctx: RouteContext<"/api/geo/lotes/[id]">) {
  const bloqueio = await limiteLeituraMapa(request, "geo");
  if (bloqueio) return bloqueio;
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Lote inválido." }, { status: 400 });
  const { data, error } = await supabaseAdmin().rpc("fn_lote", { p_id: id });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) {
    return NextResponse.json(
      { error: "Lote não encontrado. A planta pode ter sido atualizada — clique de novo no lote no mapa." },
      { status: 404 }
    );
  }
  return NextResponse.json(data);
}
