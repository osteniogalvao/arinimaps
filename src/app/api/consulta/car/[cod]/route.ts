import { supabaseAdmin } from "@/lib/supabase/admin";
import type { Bbox } from "@/lib/rural/adaptadores";
import { executarConsultaArea } from "@/lib/geo/consultaArea";
import { raioConsulta } from "@/lib/rural/raios";

export const maxDuration = 120;

/**
 * "Consultar informações" de uma área do CAR (pedido do Carlos, 01/10/2026).
 *
 * Cruza a área com as fontes oficiais ao vivo. Exige conta: cada consulta bate
 * em nove serviços públicos, e sem login viraria um jeito de usar o sistema
 * como robô contra os órgãos. Toda consulta fica registrada (usuário, área,
 * data, IP) — o histórico serve à auditoria e, depois, à cobrança por consulta.
 * A mecânica (plano, cota, cache, registro) é a mesma do lote e da área
 * desenhada: src/lib/geo/consultaArea.ts.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/consulta/car/[cod]">) {
  const cod = decodeURIComponent((await ctx.params).cod);
  const raioM = raioConsulta(new URL(request.url).searchParams.get("raio_m"), 2000);
  if (raioM === null) return Response.json({ error: "Raio de consulta inválido." }, { status: 400 });
  return executarConsultaArea(request, {
    chave: `car:${cod}`,
    raioM,
    excluir: ["car"],
    naoEncontrado: "Área não encontrada no CAR importado.",
    bbox: async () => {
      const { data } = await supabaseAdmin().rpc("fn_car_bbox_imovel", { p_cod: cod, p_buffer_m: raioM });
      return (data as Bbox | null) ?? null;
    },
  });
}
