import { supabaseAdmin } from "@/lib/supabase/admin";
import { limiteLeituraMapa } from "@/lib/geo/limiteMemoria";
import { acessoAtual } from "@/lib/planos-servidor";
import { consultarCar } from "@/lib/geo/car";

export async function GET(request: Request, ctx: RouteContext<"/api/geo/car/[cod]/ambiente">) {
  const bloqueio = await limiteLeituraMapa(request, "geo");
  if (bloqueio) return bloqueio;
  const { userId, acesso } = await acessoAtual();
  if (!acesso.recursos.has("camadas_oficiais")) return Response.json({ error: userId ? "Seu plano não inclui as camadas ambientais." : "Entre para consultar o mapa ambiental." }, { status: userId ? 403 : 401 });
  const { cod } = await ctx.params;
  if (!/^[A-Z]{2}-\d{7}-[0-9A-F.-]{20,45}$/i.test(cod)) return Response.json({ error: "Código CAR inválido." }, { status: 400 });
  const lerAmbiente = () => supabaseAdmin().rpc("fn_ambiente_por_car", { p_cod: cod.toUpperCase() });
  let ambiente = await lerAmbiente();
  if (!ambiente.error && !ambiente.data?.features?.length) {
    const car = await consultarCar(cod);
    if (car.error) return Response.json({ error: "O cadastro rural está indisponível." }, { status: 503 });
    if (car.data) ambiente = await lerAmbiente();
  }
  if (ambiente.error) return Response.json({ error: "A base ambiental está indisponível. Tente novamente." }, { status: 503 });
  if (!ambiente.data?.features?.length) return Response.json({ error: "Perímetro não encontrado no cadastro rural." }, { status: 404 });
  return Response.json(ambiente.data, { headers: { "Cache-Control": "private, no-store" } });
}
