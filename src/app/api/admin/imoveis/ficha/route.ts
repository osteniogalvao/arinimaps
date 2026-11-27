import { ator, temSetor } from "@/lib/authz";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { falha } from "@/lib/erros";
import { ehUuid } from "@/lib/solicitacoes-planos-servidor";
import { logAudit } from "@/lib/audit";
import type { SetorId } from "@/lib/setores";

/**
 * Ficha do imóvel no jeito do CRM da Arini Negócios (migration 0176):
 *  · acao "observacao": anotação de um setor no imóvel (só inserção); quem
 *    escreve precisa atuar no setor que assina a nota;
 *  · acao "captacao": captador (da equipe) e placa; Operações ou Comercial.
 */
const SETORES_FICHA: SetorId[] = ["diretoria", "operacoes", "comercial", "financeiro", "juridico", "marketing", "marketing_trafego", "cartografia", "suporte", "seguranca"];
const PLACAS = ["nao_colocada", "colocada", "retirada"];
const semMigration = (m: string) => /imovel_observacoes|captador_user_id|placa_status/.test(m);

export async function POST(req: Request) {
  const a = await ator();
  if (!a?.ehArini) return falha(a ? 403 : 401, "permissao", "Restrito à equipe.");
  if (a.somenteLeitura) return falha(403, "permissao", "Acesso de leitura: peça a um operador para registrar.");
  const b = await req.json().catch(() => null);
  if (!ehUuid(b?.id)) return falha(400, "imovel", "Imóvel inválido.");
  const admin = supabaseAdmin();
  const { data: imovel } = await admin.from("properties").select("id, captador_user_id, placa_status").eq("id", b.id).maybeSingle();
  if (!imovel) return falha(404, "imovel", "Imóvel não encontrado (ou falta rodar a migration 0176).");

  if (b.acao === "observacao") {
    const setor = String(b.setor ?? "") as SetorId;
    const texto = String(b.texto ?? "").trim();
    if (!SETORES_FICHA.includes(setor) || !temSetor(a, setor)) return falha(403, "setor", "Escolha um setor em que você atua.");
    if (!texto || texto.length > 2000) return falha(400, "texto", "Escreva a observação (até 2.000 caracteres).");
    const { error } = await admin.from("imovel_observacoes").insert({ property_id: b.id, setor, autor: a.userId, texto });
    if (error) return falha(semMigration(error.message) ? 503 : 500, "banco", semMigration(error.message) ? "Falta rodar a migration 0176 no Supabase." : "Não foi possível salvar.");
    return Response.json({ ok: true });
  }

  if (b.acao === "captacao") {
    if (!temSetor(a, "operacoes", "comercial")) return falha(403, "permissao", "Captador e placa ficam com Operações ou Comercial.");
    const patch: Record<string, unknown> = {};
    if (b.captador_user_id !== undefined) {
      if (b.captador_user_id === null || b.captador_user_id === "") patch.captador_user_id = null;
      else {
        if (!ehUuid(b.captador_user_id)) return falha(400, "captador", "Captador inválido.");
        const { data: p } = await admin.from("profiles").select("role, ativo").eq("user_id", b.captador_user_id).maybeSingle();
        if (!p || !["admin_central", "analista_arini"].includes(String(p.role)) || p.ativo === false) return falha(400, "captador", "O captador precisa ser da equipe.");
        patch.captador_user_id = b.captador_user_id;
      }
    }
    if (b.placa_status !== undefined) {
      if (!PLACAS.includes(String(b.placa_status))) return falha(400, "placa", "Situação da placa inválida.");
      patch.placa_status = b.placa_status;
    }
    if (!Object.keys(patch).length) return falha(400, "vazio", "Nada para salvar.");
    const { error } = await admin.from("properties").update(patch).eq("id", b.id);
    if (error) return falha(semMigration(error.message) ? 503 : 500, "banco", semMigration(error.message) ? "Falta rodar a migration 0176 no Supabase." : "Não foi possível salvar.");
    await logAudit({ user_id: a.userId, acao: "imovel_captacao_alterada", entidade: "properties", entidade_id: b.id,
      dados_antes: { captador_user_id: imovel.captador_user_id, placa_status: imovel.placa_status }, dados_depois: patch });
    return Response.json({ ok: true });
  }
  return falha(400, "acao", "Ação desconhecida.");
}
