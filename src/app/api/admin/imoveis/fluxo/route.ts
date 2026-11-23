import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ator, temSetor } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import { notificar } from "@/lib/notificacoes";
import { FLUXO_STATUS, type Material } from "@/lib/fluxo-imovel";
import type { SetorId } from "@/lib/setores";

/**
 * Fluxo do imóvel captação → Marketing → Diretoria (migration 0157), como na Arini:
 * Operações envia ao Marketing, o Marketing produz e sobe o material, a Diretoria aprova.
 *   { property_id, acao: "enviar", texto? }                       Operações
 *   { property_id, acao: "iniciar" }                               Marketing
 *   { property_id, acao: "material", titulo, url }                 Marketing
 *   { property_id, acao: "remover_material", url }                 Marketing
 *   { property_id, acao: "enviar_aprovacao", texto? }              Marketing
 *   { property_id, acao: "aprovar", texto? }                       Diretoria
 *   { property_id, acao: "ajustes", texto }                        Diretoria
 *   { acao: "exigir", ligado }                                     Diretoria: publicar só com aprovação
 */
const UUID = /^[0-9a-f-]{36}$/i;
const erro = (msg: string, status = 400) => NextResponse.json({ error: msg }, { status });

async function avisarSetor(setor: string, titulo: string, texto: string, link: string) {
  const { data } = await supabaseAdmin().from("profiles").select("user_id, role, setores").in("role", ["admin_central", "analista_arini"]).eq("ativo", true);
  for (const p of data ?? []) {
    const alvo = setor === "diretoria" ? p.role === "admin_central" : (p.setores as string[] | null)?.includes(setor);
    if (alvo) await notificar(p.user_id, "atencao", titulo, texto, link);
  }
}

export async function POST(request: Request) {
  const a = await ator();
  if (!a?.ehArini) return erro("Restrito à equipe.", 403);
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const admin = supabaseAdmin();

  if (b.acao === "exigir") {
    if (!temSetor(a, "diretoria")) return erro("Só a Diretoria muda essa regra.", 403);
    const { error } = await admin.from("settings").upsert({ chave: "publicacao_exige_marketing", valor: b.ligado === true, updated_at: new Date().toISOString() });
    if (error) return erro("Não foi possível salvar.", 503);
    await logAudit({ user_id: a.userId, acao: "publicacao_exige_marketing", entidade: "settings", dados_depois: { ligado: b.ligado === true } });
    return NextResponse.json({ ok: true });
  }

  if (!UUID.test(String(b.property_id))) return erro("Imóvel inválido.");
  const { data: p, error } = await admin.from("properties").select("id, codigo, titulo, marketing_status, marketing_material").eq("id", b.property_id).maybeSingle();
  if (error) return erro(/marketing_/.test(error.message) ? "Falta rodar a migration 0157." : "Falha ao carregar o imóvel.", 503);
  if (!p) return erro("Imóvel não encontrado.", 404);
  const texto = String(b.texto ?? "").trim().slice(0, 1000) || null;
  const atual = p.marketing_status as string | null;
  const material = (Array.isArray(p.marketing_material) ? p.marketing_material : []) as Material[];
  const link = `/admin/marketing/fluxo?imovel=${p.id}`;
  const nome = `${p.codigo}${p.titulo ? " · " + p.titulo : ""}`;
  let mud: Record<string, unknown> = {};
  let para = atual;
  let setorAviso: string | null = null;

  const exige = (...setores: SetorId[]) => {
    if (!temSetor(a, ...setores)) throw new Error("Sem permissão para esta etapa.");
  };
  try {
    switch (b.acao) {
      case "enviar":
        exige("operacoes");
        if (atual && atual !== "aprovado") return erro("O imóvel já está com o Marketing.");
        para = "enviado"; mud = { marketing_enviado_em: new Date().toISOString(), marketing_aprovado_em: null, marketing_aprovado_por: null };
        setorAviso = "marketing";
        break;
      case "iniciar":
        exige("marketing");
        if (!["enviado", "ajustes"].includes(atual ?? "")) return erro("Só inicia o que foi enviado ou voltou com ajustes.");
        para = "em_producao";
        break;
      case "material": {
        exige("marketing");
        if (!atual) return erro("O imóvel ainda não foi enviado ao Marketing.");
        const url = String(b.url ?? "").trim();
        const titulo = String(b.titulo ?? "").trim().slice(0, 120) || "Material";
        if (!/^https:\/\/\S{4,2000}$/.test(url)) return erro("Cole um link https (Drive, Canva, pasta de fotos…).");
        if (material.length >= 40) return erro("Limite de 40 materiais por imóvel.");
        mud = { marketing_material: [...material, { titulo, url, em: new Date().toISOString(), por: a.userId }] };
        break;
      }
      case "remover_material":
        exige("marketing");
        mud = { marketing_material: material.filter((m) => m.url !== b.url) };
        break;
      case "enviar_aprovacao":
        exige("marketing");
        if (!["em_producao", "ajustes", "enviado"].includes(atual ?? "")) return erro("Nada em produção para aprovar.");
        if (!material.length) return erro("Suba pelo menos um material antes de pedir aprovação.");
        para = "aguardando_aprovacao"; setorAviso = "diretoria";
        break;
      case "aprovar":
        exige("diretoria");
        if (atual !== "aguardando_aprovacao") return erro("Não há material esperando aprovação.");
        para = "aprovado"; mud = { marketing_aprovado_em: new Date().toISOString(), marketing_aprovado_por: a.userId };
        setorAviso = "operacoes";
        break;
      case "ajustes":
        exige("diretoria");
        if (atual !== "aguardando_aprovacao") return erro("Não há material esperando aprovação.");
        if (!texto || texto.length < 5) return erro("Diga o que precisa ajustar.");
        para = "ajustes"; setorAviso = "marketing";
        break;
      default:
        return erro("Ação desconhecida.");
    }
  } catch (e) {
    return erro(e instanceof Error ? e.message : "Sem permissão.", 403);
  }
  if (para !== atual) mud.marketing_status = para;
  const { error: e2 } = await admin.from("properties").update(mud).eq("id", p.id);
  if (e2) return erro("Não foi possível salvar.", 503);
  await admin.from("imovel_fluxo_eventos").insert({
    property_id: p.id, acao: String(b.acao), de_status: atual, para_status: para, autor: a.userId, para_setor: setorAviso,
    texto: b.acao === "material" ? `${mud.marketing_material ? (mud.marketing_material as Material[]).at(-1)?.titulo : ""}` : texto,
  });
  if (setorAviso && para) {
    await avisarSetor(setorAviso, `${FLUXO_STATUS[para]}: ${nome}`, texto ?? "", link);
  }
  await logAudit({ user_id: a.userId, acao: "fluxo_imovel_" + b.acao, entidade: "properties", entidade_id: p.id, property_id: p.id, dados_depois: { de: atual, para } });
  return NextResponse.json({ ok: true });
}
