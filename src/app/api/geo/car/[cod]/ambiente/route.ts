import { supabaseAdmin } from "@/lib/supabase/admin";
import { limiteLeituraMapa } from "@/lib/geo/limiteMemoria";
import { acessoAtual } from "@/lib/planos-servidor";
import { consultarCar } from "@/lib/geo/car";
import { currentUser } from "@/lib/supabase/server";
import { direitosDoTour, type TemaTour } from "@/lib/map/acesso-tour";
import { podeVerArea, respostaTerceiro } from "@/lib/dados-terceiros";

export async function GET(request: Request, ctx: RouteContext<"/api/geo/car/[cod]/ambiente">) {
  const bloqueio = await limiteLeituraMapa(request, "geo");
  if (bloqueio) return bloqueio;
  const { userId, acesso } = await acessoAtual();
  if (!acesso.recursos.has("camadas_oficiais")) return Response.json({ error: userId ? "Seu plano não inclui as camadas ambientais." : "Entre para consultar o mapa ambiental." }, { status: userId ? 403 : 401 });
  const { cod } = await ctx.params;
  if (!/^[A-Z]{2}-\d{7}-[0-9A-F.-]{20,45}$/i.test(cod)) return Response.json({ error: "Código CAR inválido." }, { status: 400 });
  // 18/11/2026: área sem anúncio é de terceiro (src/lib/dados-terceiros.ts)
  if (!(await podeVerArea({ car: cod }, { userId, acesso })).pode) return respostaTerceiro(!!userId);
  let temas: Set<TemaTour> | null = null;
  if (new URL(request.url).searchParams.get("tour") === "1") {
    const user = await currentUser();
    if (!user) return Response.json({error:"Entre para consultar as camadas do tour."},{status:401});
    const direitos = await direitosDoTour(acesso, user.entradaAtiva, false);
    if (!direitos?.ambiente.length) return Response.json({error:"Camadas ambientais indisponíveis para este perfil."},{status:403});
    temas = new Set(direitos.ambiente);
  }
  const lerAmbiente = () => supabaseAdmin().rpc("fn_ambiente_por_car", { p_cod: cod.toUpperCase() });
  let ambiente = await lerAmbiente();
  if (!ambiente.error && !ambiente.data?.features?.length) {
    const car = await consultarCar(cod);
    if (car.error) return Response.json({ error: "O cadastro rural está indisponível." }, { status: 503 });
    if (car.data) ambiente = await lerAmbiente();
  }
  if (ambiente.error) return Response.json({ error: "A base ambiental está indisponível. Tente novamente." }, { status: 503 });
  if (!ambiente.data?.features?.length) return Response.json({ error: "Perímetro não encontrado no cadastro rural." }, { status: 404 });
  const dados = temas ? {type:"FeatureCollection", features:(ambiente.data.features as GeoJSON.Feature[]).filter(f => temas.has(f.properties?.tema))} : ambiente.data;
  return Response.json(dados, { headers: { "Cache-Control": "private, no-store" } });
}
