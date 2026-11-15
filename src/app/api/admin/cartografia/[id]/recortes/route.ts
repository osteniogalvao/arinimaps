import { ator, temSetor } from "@/lib/authz";
import { conferirOrigem, respostaOrigemNegada } from "@/lib/seguranca/origem";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { falha, falhaBanco } from "@/lib/erros";

type Contexto = { params: Promise<{ id: string }> };
async function editar(request: Request, ctx: Contexto, remover: boolean) {
  const origem = conferirOrigem(request);
  if (!origem.ok) return respostaOrigemNegada(origem.motivo);
  const a = await ator();
  if (!a || !temSetor(a, "cartografia")) return falha(403, "sem_permissao", "Restrito à equipe de Cartografia.");
  const { id } = await ctx.params;
  const body = await request.json().catch(() => null);
  const db = supabaseAdmin();
  if (remover) {
    if (typeof body?.id !== "string") return falha(400, "id_invalido", "Indique o recorte.");
    const { data, error } = await db.from("cartografia_recortes_urbanos").delete().eq("id", body.id).eq("camada_id", id).select("id,nome").maybeSingle();
    if (error) return falhaBanco("remover_recorte", error);
    if (!data) return falha(404, "recorte_ausente", "Recorte não encontrado nesta planta.");
    await logAudit({ user_id: a.userId, acao: "remover_recorte_urbano", entidade: "cartografia", entidade_id: id, dados_antes: data });
    return Response.json({ ok: true });
  }
  const nome = typeof body?.nome === "string" ? body.nome.trim() : "";
  const geom = body?.geometry;
  const anel = geom?.coordinates?.[0];
  if (!nome || nome.length > 100 || geom?.type !== "Polygon" || geom.coordinates?.length !== 1 ||
      !Array.isArray(anel) || anel.length < 4 || anel.length > 301 ||
      !anel.every((p: unknown) => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite) && Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 85) ||
      anel[0][0] !== anel.at(-1)[0] || anel[0][1] !== anel.at(-1)[1]) {
    return falha(400, "recorte_invalido", "Informe um nome e um polígono fechado com até 300 vértices.");
  }
  const { data: camada, error: consulta } = await db.from("cartography_layers").select("tipo,tiles_path,publico_path").eq("id", id).eq("status", "pronto").maybeSingle();
  if (consulta) return falhaBanco("consultar_planta", consulta);
  if (!camada?.tiles_path || (camada.tipo === "vector" && !camada.publico_path)) return falha(409, "planta_indisponivel", "Publique a planta antes de criar o recorte.");
  const { data, error } = await db.from("cartografia_recortes_urbanos").insert({ camada_id: id, nome, geom, criado_por: a.userId }).select("id").single();
  if (error?.code === "23514" || error?.code === "XX000") return falha(400, "geometria_invalida", "Confira o perímetro. Ele deve fechar sem cruzar as próprias bordas.");
  if (error) return falhaBanco("gravar_recorte", error);
  await logAudit({ user_id: a.userId, acao: "criar_recorte_urbano", entidade: "cartografia", entidade_id: id, dados_depois: { id: data.id, nome } });
  return Response.json(data, { status: 201 });
}
export function POST(request: Request, ctx: Contexto) { return editar(request, ctx, false); }
export function DELETE(request: Request, ctx: Contexto) { return editar(request, ctx, true); }
