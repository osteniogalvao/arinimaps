import { NextResponse } from "next/server";
import { consultarCar } from "@/lib/geo/car";
import { limiteLeituraMapa } from "@/lib/geo/limiteMemoria";

/** Um imóvel do CAR com a divisa inteira — vira a geometria do anúncio. */
export async function GET(request: Request, ctx: RouteContext<"/api/geo/car/[cod]">) {
  const bloqueio = await limiteLeituraMapa(request, "geo");
  if (bloqueio) return bloqueio;
  const { cod } = await ctx.params;
  const { data, error } = await consultarCar(cod);
  if (error) return NextResponse.json({ error: "O cadastro rural está indisponível." }, { status: 503 });
  if (!data) return NextResponse.json({ error: "Imóvel não encontrado no CAR." }, { status: 404 });
  return NextResponse.json(data);
}
