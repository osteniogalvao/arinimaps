import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { limiteLeituraMapa } from "@/lib/geo/limiteMemoria";
import { LOTES_MAX } from "@/lib/geo/loteamento";

/** Vários lotes de uma vez (?ids=a,b,c), para o cadastro de loteamento. */
export async function GET(request: Request) {
  const bloqueio = await limiteLeituraMapa(request, "geo");
  if (bloqueio) return bloqueio;
  const ids = [...new Set((new URL(request.url).searchParams.get("ids") ?? "").split(","))]
    .filter((id) => /^[0-9a-f-]{36}$/i.test(id));
  if (!ids.length || ids.length > LOTES_MAX) {
    return NextResponse.json({ error: `Informe de 1 a ${LOTES_MAX} lotes.` }, { status: 400 });
  }
  const { data, error } = await supabaseAdmin().rpc("fn_lotes_por_ids", { p_ids: ids });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ type: "FeatureCollection", features: data ?? [] });
}
