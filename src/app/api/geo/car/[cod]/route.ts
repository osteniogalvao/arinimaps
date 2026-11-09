import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { limiteLeituraMapa } from "@/lib/geo/limiteMemoria";

/** Um imóvel do CAR com a divisa inteira — vira a geometria do anúncio. */
export async function GET(request: Request, ctx: RouteContext<"/api/geo/car/[cod]">) {
  const bloqueio = await limiteLeituraMapa(request, "geo");
  if (bloqueio) return bloqueio;
  const { cod } = await ctx.params;
  const { data, error } = await supabaseAdmin().rpc("fn_car_imovel", { p_cod: decodeURIComponent(cod) });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Imóvel não encontrado no CAR importado." }, { status: 404 });
  return NextResponse.json(data);
}
