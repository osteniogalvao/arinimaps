import { NextResponse } from "next/server";
import { ator, temSetor } from "@/lib/authz";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { conferirOrigem, respostaOrigemNegada } from "@/lib/seguranca/origem";
import { falha, falhaBanco } from "@/lib/erros";
import { afim, aplicarMatrizPonto, centroArea, compor, inverter, pontoNaArea, type AjusteLocal } from "@/lib/geo/deslocar";

/**
 * Número da quadra posto à mão (áudio do Carlos, 26/11/2026): o operador
 * clica dentro da quadra e digita o número; todos os lotes encostados até a
 * rua recebem o número. A âncora vai nas coordenadas do desenho original, como
 * na exclusão de lote, para a fila reaplicar quando gerar os lotes de novo.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/admin/cartografia/[id]/quadra">) {
  const origem = conferirOrigem(request);
  if (!origem.ok) return respostaOrigemNegada(origem.motivo);
  const a = await ator();
  if (!a || a.somenteLeitura || !temSetor(a, "cartografia")) return falha(403, "sem_permissao", "Restrito à cartografia.");
  const { id } = await ctx.params;
  const b = await request.json().catch(() => null);
  if (!b || !Number.isFinite(b.lng) || Math.abs(b.lng) > 180 || !Number.isFinite(b.lat) || Math.abs(b.lat) > 90) {
    return falha(400, "coordenada", "Clique dentro da quadra no mapa.");
  }
  const quadra = typeof b.quadra === "string" ? b.quadra.trim() : "";
  if (!quadra || quadra.length > 20) return falha(400, "quadra_invalida", "Digite o número ou o nome da quadra (até 20 caracteres).");
  const db = supabaseAdmin();
  const { data: c, error } = await db.from("cartography_layers")
    .select("publico_centro,offset_leste_m,offset_norte_m,rotacao_graus,escala,ajustes_locais,lotes_gerados_em")
    .eq("id", id).maybeSingle();
  if (error) return falhaBanco("camada", error);
  if (!c?.lotes_gerados_em || !c.publico_centro) return falha(409, "aguarde_lotes", "Aguarde a geração dos lotes desta planta.");

  const global = afim(c.publico_centro, { offsetLesteM: c.offset_leste_m, offsetNorteM: c.offset_norte_m, rotacaoGraus: c.rotacao_graus, escala: c.escala || 1 });
  const ponto: [number, number] = [b.lng, b.lat];
  let ancora = aplicarMatrizPonto(inverter(global), ponto);
  for (const parte of (c.ajustes_locais ?? []) as AjusteLocal[]) {
    const cru = aplicarMatrizPonto(inverter(compor(global, afim(centroArea(parte.area), parte.t))), ponto);
    if (pontoNaArea(cru, parte.area)) { ancora = cru; break; }
  }
  const r = await db.rpc("fn_numerar_quadra", {
    p_layer: id, p_lon: b.lng, p_lat: b.lat, p_quadra: quadra,
    p_ancora_lng: ancora[0], p_ancora_lat: ancora[1], p_autor: a.userId,
  });
  if (r.error) {
    if (/fn_numerar_quadra|does not exist/i.test(r.error.message)) return falha(503, "migration_pendente", "Falta rodar a migration 0174 no banco para numerar quadras.");
    return falhaBanco("numerar_quadra", r.error);
  }
  const lotes = Number(r.data) || 0;
  if (!lotes) return falha(404, "quadra_ausente", "Nenhum lote clicável nesse ponto. Clique dentro de um lote da quadra.");
  return NextResponse.json({ ok: true, quadra, lotes });
}
