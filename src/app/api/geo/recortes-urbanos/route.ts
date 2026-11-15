import { supabaseAdmin } from "@/lib/supabase/admin";
import { limiteLeituraMapa } from "@/lib/geo/limiteMemoria";

export async function GET(request: Request) {
  const bloqueio = await limiteLeituraMapa(request, "geo");
  if (bloqueio) return bloqueio;
  const { data, error } = await supabaseAdmin().rpc("fn_recortes_urbanos");
  if (error) return Response.json({ error: "Falha ao consultar os recortes urbanos." }, { status: 503 });
  return Response.json(data, { headers: { "Cache-Control": "public, max-age=15, s-maxage=15" } });
}
