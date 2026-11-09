import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ator } from "@/lib/authz";
import { falha } from "@/lib/erros";
import { logAudit } from "@/lib/audit";
import { limitar, respostaLimite } from "@/lib/seguranca/limite";
import { destinatarioDoImovel, ehIntermediadorDoImovel, enviarAvisoProprietario } from "@/lib/acompanhamento/servidor";

/**
 * Próximos passos para o proprietário (item 28). Quem grava é o intermediador
 * responsável (parceiro com oportunidade aberta no imóvel, ou o Comercial da
 * Central). Gravar zera a pendência "proprietário sem atualização há 7 dias"
 * e avisa o proprietário pelo canal de avisos (hoje, e-mail).
 */
export async function POST(request: Request, ctx: RouteContext<"/api/imoveis/[id]/acompanhamento">) {
  const { id } = await ctx.params;
  const a = await ator();
  if (!a) return falha(401, "sem_sessao", "Sessão expirada.");
  if (!(await ehIntermediadorDoImovel(a, id))) {
    return falha(403, "sem_acesso", "Só o intermediador responsável atualiza o proprietário deste imóvel.");
  }
  const l = await limitar(`acompanhamento:${a.userId}`, 30, 3600);
  if (!l.permitido) return respostaLimite(l, "registrar atualizações");

  const b = (await request.json().catch(() => null)) as { proximos_passos?: unknown } | null;
  const texto = String(b?.proximos_passos ?? "").trim();
  if (texto.length < 3 || texto.length > 2000) {
    return falha(400, "dados_invalidos", "Escreva os próximos passos (de 3 a 2.000 caracteres).");
  }

  const admin = supabaseAdmin();
  const { error } = await admin.from("property_acompanhamento").upsert(
    { property_id: id, proximos_passos: texto, atualizado_por: a.userId, atualizado_em: new Date().toISOString() },
    { onConflict: "property_id" });
  if (error) {
    return falha(503, "recurso_indisponivel", "O acompanhamento ainda não está disponível.", {
      motivo: error.message, solucao: "A Arini precisa aplicar a atualização do banco (migration 0060).",
    });
  }
  await logAudit({ user_id: a.userId, acao: "acompanhamento_atualizado", entidade: "property_acompanhamento", entidade_id: id, property_id: id, dados_depois: { proximos_passos: texto } });

  const d = await destinatarioDoImovel(id);
  if (d && d.userId !== a.userId) {
    const link = `${process.env.NEXT_PUBLIC_SITE_URL ?? "https://arinibrasil.com.br"}/painel/imoveis/${id}/acompanhamento`;
    await enviarAvisoProprietario(d, {
      assunto: `Atualização do seu imóvel — ${d.codigo}`,
      texto: `O intermediador do seu imóvel ${d.codigo} (${d.titulo}) registrou os próximos passos:\n\n${texto}\n\nAcompanhe em:\n${link}`,
    });
  }
  return NextResponse.json({ ok: true });
}
