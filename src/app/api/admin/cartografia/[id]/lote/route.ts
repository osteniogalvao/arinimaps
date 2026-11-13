import { NextResponse } from "next/server";
import { ator, temSetor } from "@/lib/authz";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { conferirOrigem, respostaOrigemNegada } from "@/lib/seguranca/origem";
import { falha, falhaBanco } from "@/lib/erros";
import { afim, aplicarMatrizPonto, centroArea, compor, inverter, pontoNaArea, type AjusteLocal } from "@/lib/geo/deslocar";

export async function POST(request: Request, ctx: RouteContext<"/api/admin/cartografia/[id]/lote">) {
  const origem = conferirOrigem(request);
  if (!origem.ok) return respostaOrigemNegada(origem.motivo);
  const a = await ator();
  if (!a || !temSetor(a, "cartografia")) return falha(403, "sem_permissao", "Restrito à cartografia.");
  const { id } = await ctx.params;
  const b = await request.json().catch(() => null);
  if (!b || !Number.isFinite(b.lng) || Math.abs(b.lng) > 180 || !Number.isFinite(b.lat) || Math.abs(b.lat) > 90) {
    return falha(400, "coordenada", "Selecione um ponto no mapa.");
  }
  const db = supabaseAdmin();
  const { data: c, error } = await db.from("cartography_layers")
    .select("publico_centro,offset_leste_m,offset_norte_m,rotacao_graus,escala,ajustes_locais,lotes_gerados_em")
    .eq("id", id).maybeSingle();
  if (error) return falhaBanco("camada", error);
  if (!c?.lotes_gerados_em || !c.publico_centro) return falha(409, "aguarde_lotes", "Aguarde a geração dos lotes desta planta.");
  const busca = await db.rpc("fn_lote_calibracao", { p_layer: id, p_lon: b.lng, p_lat: b.lat });
  if (busca.error) return falhaBanco("buscar_lote", busca.error);
  const lote = busca.data?.properties;
  if (!lote) return falha(404, "lote_ausente", "Nenhum lote clicável nesse ponto.");
  if (!b.confirmar) return NextResponse.json({ id: lote.id, numero: lote.numero, quadra: lote.quadra, area: lote.area_m2, versao: c.lotes_gerados_em, geometria: busca.data.geometry });
  if (b.confirmar !== lote.id || b.versao !== c.lotes_gerados_em) return falha(409, "lote_mudou", "A planta mudou. Selecione o lote novamente.");
  const global = afim(c.publico_centro, { offsetLesteM: c.offset_leste_m, offsetNorteM: c.offset_norte_m, rotacaoGraus: c.rotacao_graus, escala: c.escala || 1 });
  const centro: [number, number] = [lote.lng, lote.lat];
  let ancora = aplicarMatrizPonto(inverter(global), centro);
  for (const parte of (c.ajustes_locais ?? []) as AjusteLocal[]) {
    const cru = aplicarMatrizPonto(inverter(compor(global, afim(centroArea(parte.area), parte.t))), centro);
    if (pontoNaArea(cru, parte.area)) { ancora = cru; break; }
  }
  const r = await db.rpc("fn_excluir_lote_calibracao", { p_layer: id, p_lote: lote.id, p_lon: ancora[0], p_lat: ancora[1], p_autor: a.userId, p_versao: b.versao });
  if (r.error) return falhaBanco("excluir_lote", r.error);
  if (r.data !== "ok") return falha(409, "lote_indisponivel", r.data === "vinculado" ? "Este lote está vinculado a um imóvel." : "A planta mudou. Selecione novamente.");
  return NextResponse.json({ ok: true });
}
