import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { currentUser } from "@/lib/supabase/server";
import { falha } from "@/lib/erros";
import { logAudit } from "@/lib/audit";
import { sendEmail } from "@/lib/notify";
import { limitar, respostaLimite } from "@/lib/seguranca/limite";
import { acessoDe } from "@/lib/planos-servidor";
import { emailValido } from "@/lib/organizacoes";
import { aceitarConvite, organizacaoDoUsuario } from "@/lib/organizacoes-servidor";

/**
 * A organização vista por quem é dela (5.9).
 *
 *  - aceitar / recusar convite: qualquer conta logada, para convites do próprio e-mail;
 *  - sair: membro (o último administrador não sai — a Matriz resolve);
 *  - convidar, remover, trocar papel: administrador da organização, e só se o
 *    plano da organização tiver o recurso "multiusuario".
 *
 * A Matriz administra tudo por /api/admin/organizacoes.
 */
export async function POST(request: Request) {
  const user = await currentUser();
  if (!user?.email) return falha(401, "sem_sessao", "Sessão expirada.", { solucao: "Entre de novo." });
  const b = await request.json().catch(() => ({}));
  const acao = String(b.acao ?? "");
  const admin = supabaseAdmin();

  // ---------- convites recebidos ----------
  if (acao === "aceitar") {
    const r = await aceitarConvite(String(b.convite_id ?? ""), user.id, user.email);
    if (!r.ok) return falha(400, "convite_invalido", r.erro);
    return NextResponse.json({ ok: true, mensagem: `Agora você faz parte de ${r.org}.` });
  }
  if (acao === "recusar") {
    const { data: c } = await admin.from("organization_members").select("id, email, status").eq("id", String(b.convite_id ?? "")).maybeSingle();
    if (!c || c.status !== "pendente" || c.email.toLowerCase() !== user.email.toLowerCase()) {
      return falha(404, "convite_invalido", "Convite não encontrado.");
    }
    await admin.from("organization_members").update({ status: "recusado" }).eq("id", c.id);
    await logAudit({ user_id: user.id, acao: "organizacao_convite_recusado", entidade: "organization_members", entidade_id: c.id });
    return NextResponse.json({ ok: true });
  }

  const vinculo = await organizacaoDoUsuario(user.id);
  if (!vinculo) return falha(404, "sem_organizacao", "Você não faz parte de uma organização.");
  const { org, membro } = vinculo;

  if (acao === "sair") {
    if (membro.papel_org === "admin") {
      const { count } = await admin.from("organization_members").select("id", { count: "exact", head: true })
        .eq("org_id", org.id).eq("status", "ativo").eq("papel_org", "admin");
      if ((count ?? 0) <= 1) {
        return falha(400, "ultimo_admin", "Você é o único administrador.", {
          solucao: "Promova outro membro a administrador antes de sair, ou peça à Arini.",
        });
      }
    }
    await admin.from("organization_members").update({ status: "removido", removido_em: new Date().toISOString() }).eq("id", membro.id);
    await logAudit({ user_id: user.id, acao: "organizacao_saiu", entidade: "organization_members", entidade_id: membro.id, dados_depois: { org_id: org.id } });
    return NextResponse.json({ ok: true });
  }

  // ---------- daqui para baixo: administrador da organização ----------
  if (membro.papel_org !== "admin") return falha(403, "nao_admin", "Só o administrador da organização faz isso.");
  if (!org.ativo) return falha(403, "org_inativa", "A organização está desativada.", { solucao: "Fale com a Arini." });
  const acesso = await acessoDe(user.id);
  if (!acesso.recursos.has("multiusuario")) {
    return falha(403, "sem_plano", "O plano da organização não inclui vários usuários.", {
      solucao: "Veja os planos em /planos ou peça à Arini para incluir os membros.",
    });
  }

  if (acao === "convidar") {
    const limite = await limitar(`org:convite:${org.id}`, 30, 86_400);
    if (!limite.permitido) return respostaLimite(limite, "convite");
    const email = String(b.email ?? "").trim().toLowerCase();
    if (!emailValido(email)) return falha(400, "email_invalido", "Informe um e-mail válido.");
    const papel = b.papel_org === "admin" ? "admin" : "membro";

    const { data: existente } = await admin.from("organization_members").select("id, status")
      .eq("org_id", org.id).eq("email", email).in("status", ["pendente", "ativo"]).maybeSingle();
    if (existente) {
      return falha(409, "ja_convidado", existente.status === "ativo" ? "Esta pessoa já é membro." : "Já existe um convite pendente para este e-mail.");
    }
    const { data: novo, error } = await admin.from("organization_members")
      .insert({ org_id: org.id, email, papel_org: papel, status: "pendente", convidado_por: user.id })
      .select("id").single();
    if (error) return falha(500, "erro_banco", "Não foi possível registrar o convite.", { motivo: error.message });

    const site = process.env.NEXT_PUBLIC_SITE_URL ?? "";
    sendEmail(email, `Convite para ${org.nome} na ARINI`,
      `${user.nome || "Um administrador"} convidou você para fazer parte de ${org.nome} na ARINI.\n\n` +
      `Se já tem conta com este e-mail, entre em ${site}/entrar — o convite é aceito no login (ou em ${site}/conta).\n` +
      `Se ainda não tem, crie a conta com este mesmo e-mail em ${site}/entrar.`).catch(() => undefined);
    await logAudit({ user_id: user.id, acao: "organizacao_convite", entidade: "organization_members", entidade_id: novo.id, dados_depois: { org_id: org.id, email, papel } });
    return NextResponse.json({ ok: true, mensagem: `Convite enviado para ${email}.` });
  }

  const alvoId = String(b.membro_id ?? "");
  const { data: alvo } = await admin.from("organization_members").select("id, user_id, status, papel_org")
    .eq("id", alvoId).eq("org_id", org.id).maybeSingle();
  if (!alvo) return falha(404, "membro_nao_encontrado", "Membro não encontrado nesta organização.");
  if (alvo.user_id === user.id) return falha(400, "proprio", "Para sair, use “Sair da organização”.");

  if (acao === "remover") {
    if (!["pendente", "ativo"].includes(alvo.status)) return falha(400, "ja_fora", "Este vínculo já foi encerrado.");
    await admin.from("organization_members")
      .update({ status: "removido", removido_em: new Date().toISOString() }).eq("id", alvo.id);
    await logAudit({ user_id: user.id, acao: alvo.status === "pendente" ? "organizacao_convite_cancelado" : "organizacao_membro_removido", entidade: "organization_members", entidade_id: alvo.id, dados_depois: { org_id: org.id } });
    return NextResponse.json({ ok: true });
  }
  if (acao === "papel") {
    const papel = b.papel_org === "admin" ? "admin" : "membro";
    await admin.from("organization_members").update({ papel_org: papel }).eq("id", alvo.id);
    await logAudit({ user_id: user.id, acao: "organizacao_papel_alterado", entidade: "organization_members", entidade_id: alvo.id, dados_depois: { papel } });
    return NextResponse.json({ ok: true });
  }
  return falha(400, "acao_invalida", "Ação inválida.");
}
