import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { ator, temSetor } from "@/lib/authz";
import { AsaasErro, asaasBuscarClientePorReferencia, asaasBuscarCobranca, asaasConfigurado, asaasCriarCliente, asaasCriarCobranca } from "@/lib/asaas";
import { cpfDoPerfil } from "@/lib/seguranca/cripto";
import { emailDoProfile } from "@/lib/notify";
import { falha, falhaBanco } from "@/lib/erros";

// Ações de mensalidade: gerar_faturas | marcar_paga | marcar_inadimplentes | cobrar_asaas
export async function POST(request: Request) {
  const a = await ator();
  if (!a || !temSetor(a, "financeiro")) return falha(403, "sem_permissao", "Restrito ao setor Financeiro.", { solucao: "Peça à diretoria para incluir você no setor Financeiro." });

  const body = await request.json().catch(() => ({}));
  const admin = supabaseAdmin();

  if (body.acao === "gerar_faturas") {
    const competencia = body.competencia ?? new Date().toISOString().slice(0, 8) + "01";
    const { data: n, error } = await admin.rpc("fn_gerar_faturas", { p_competencia: competencia });
    if (error) return falhaBanco("mensalidade_falhou", error);
    await logAudit({ user_id: a.userId, acao: "faturas_geradas", entidade: "invoices", dados_depois: { competencia, geradas: n } });
    return NextResponse.json({ ok: true, geradas: n });
  }

  if (body.acao === "marcar_paga") {
    const { error } = await admin.from("invoices")
      .update({ status: "paga", pago_em: new Date().toISOString().slice(0, 10) })
      .eq("id", body.invoice_id);
    if (error) return falhaBanco("mensalidade_falhou", error);
    // se não sobrou fatura vencida, assinatura volta a ativa
    const { data: inv } = await admin.from("invoices").select("subscription_id").eq("id", body.invoice_id).single();
    if (inv) {
      const { count } = await admin.from("invoices").select("id", { count: "exact", head: true })
        .eq("subscription_id", inv.subscription_id).eq("status", "vencida");
      if (!count) await admin.from("subscriptions").update({ status: "ativa" })
        .eq("id", inv.subscription_id).eq("status", "inadimplente");
    }
    await logAudit({ user_id: a.userId, acao: "fatura_paga", entidade: "invoices", entidade_id: body.invoice_id });
    return NextResponse.json({ ok: true });
  }

  if (body.acao === "marcar_inadimplentes") {
    const { data: cfg } = await admin.from("settings").select("valor").eq("chave", "suspensao_dias").single();
    const { data: n, error } = await admin.rpc("fn_marcar_inadimplentes", { p_dias: Number(cfg?.valor ?? 15) });
    if (error) return falhaBanco("mensalidade_falhou", error);
    await logAudit({ user_id: a.userId, acao: "inadimplencia_processada", entidade: "invoices", dados_depois: { vencidas: n } });
    return NextResponse.json({ ok: true, vencidas: n });
  }

  if (body.acao === "atualizar_valor") {
    const { error } = await admin.from("subscriptions")
      .update({ valor_mensal: Number(body.valor_mensal ?? 0) })
      .eq("id", body.subscription_id);
    if (error) return falhaBanco("mensalidade_falhou", error);
    await logAudit({ user_id: a.userId, acao: "mensalidade_valor", entidade: "subscriptions", entidade_id: body.subscription_id, dados_depois: { valor_mensal: body.valor_mensal } });
    return NextResponse.json({ ok: true });
  }

  if (body.acao === "cobrar_asaas") {
    if (!asaasConfigurado()) {
      return falha(400, "asaas_sem_chave", "A cobrança pelo Asaas não está ligada.", { motivo: "A variável ASAAS_API_KEY não está configurada no servidor.", solucao: "Cobre manualmente por enquanto, ou configure a chave do Asaas no painel de deploy — o botão volta a funcionar sozinho." });
    }
    const { data: inv } = await admin.from("invoices")
      .select("id, valor, competencia, status, gateway_id, subscription:subscriptions(dia_vencimento, property:properties(codigo, titulo, owner_id, partner_id))")
      .eq("id", body.invoice_id).maybeSingle();
    if (!inv) return falha(404, "fatura_sumiu", "Fatura não encontrada.", { solucao: "Recarregue a página — ela pode ter sido paga ou removida." });
    if (inv.status === "paga") return falha(409, "fatura_paga", "Essa fatura já está paga.", { solucao: "Recarregue a página." });
    const sub = inv.subscription as unknown as { dia_vencimento: number; property: { codigo: string; titulo: string; owner_id: string | null; partner_id: string | null } };

    try {
      // já existe cobrança viva no Asaas para esta fatura → reaproveita o link (não duplica)
      if (inv.gateway_id) {
        const atual = await asaasBuscarCobranca(inv.gateway_id);
        if (atual && !atual.deleted && !["REFUNDED", "REFUND_REQUESTED", "CHARGEBACK_REQUESTED"].includes(atual.status)) {
          return NextResponse.json({ ok: true, url: atual.invoiceUrl, reaproveitada: true });
        }
      }

      // cliente = proprietário ou parceiro responsável
      let profileId: string | null = null;
      let nome = "Anunciante";
      if (sub.property.owner_id) {
        const { data: o } = await admin.from("owners").select("profile_id, profile:profiles(nome)").eq("id", sub.property.owner_id).single();
        profileId = o?.profile_id ?? null;
        nome = (o?.profile as unknown as { nome: string } | null)?.nome || nome;
      } else if (sub.property.partner_id) {
        const { data: p } = await admin.from("partners").select("profile_id, razao_social").eq("id", sub.property.partner_id).single();
        profileId = p?.profile_id ?? null;
        nome = p?.razao_social || nome;
      }
      if (!profileId) {
        return falha(422, "asaas_sem_responsavel", "O imóvel não tem proprietário nem parceiro com conta.", { motivo: "O Asaas precisa de um cliente (nome e CPF/CNPJ) para emitir a cobrança.", solucao: "Vincule o responsável ao imóvel ou cobre manualmente." });
      }

      const { data: perfil } = await admin.from("profiles").select("*").eq("user_id", profileId).single();
      const perfilRow = (perfil ?? {}) as { nome?: string; telefone?: string | null; asaas_customer_id?: string | null; cpf_cnpj?: string | null; cpf_cnpj_cifrado?: string | null };
      let customerId = perfilRow.asaas_customer_id ?? null;
      if (!customerId) {
        // sem id guardado: procura pelo nosso identificador antes de criar (evita cliente duplicado)
        customerId = (await asaasBuscarClientePorReferencia(profileId))?.id ?? null;
      }
      if (!customerId) {
        const cpf = cpfDoPerfil(perfilRow)?.replace(/\D/g, "") ?? "";
        if (cpf.length !== 11 && cpf.length !== 14) {
          return falha(422, "asaas_sem_cpf", "O responsável pelo imóvel não tem CPF/CNPJ válido no cadastro.", { motivo: "O Asaas exige CPF ou CNPJ para criar o cliente da cobrança.", solucao: "Peça para a pessoa completar o CPF/CNPJ no cadastro e tente de novo." });
        }
        const email = await emailDoProfile(profileId);
        const tel = perfilRow.telefone?.replace(/\D/g, "");
        const cliente = await asaasCriarCliente({
          name: nome, cpfCnpj: cpf, email: email ?? undefined,
          mobilePhone: tel && tel.length >= 10 ? tel : undefined, externalReference: profileId,
        });
        customerId = cliente!.id;
      }
      if (customerId !== perfilRow.asaas_customer_id) {
        // falha aqui não impede a cobrança: a busca por externalReference cobre a próxima vez
        const { error } = await admin.from("profiles").update({ asaas_customer_id: customerId }).eq("user_id", profileId);
        if (error) console.error("profiles.asaas_customer_id não gravado:", error.message);
      }

      // vencimento: dia do plano na competência; nunca no passado (o Asaas recusa)
      const [ano, mes] = String(inv.competencia).split("-").map(Number);
      const dia = Math.min(sub.dia_vencimento, new Date(ano, mes, 0).getDate());
      const vencPlano = `${ano}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
      const hoje = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
      const dueDate = vencPlano < hoje ? hoje : vencPlano;

      const cobranca = await asaasCriarCobranca({
        customer: customerId,
        value: Number(inv.valor),
        dueDate,
        description: `Mensalidade ARINI — ${sub.property.codigo} ${sub.property.titulo}`.slice(0, 500),
        externalReference: inv.id,
      });
      await admin.from("invoices").update({ gateway_id: cobranca!.id }).eq("id", inv.id);
      await logAudit({ user_id: a.userId, acao: "cobranca_asaas_criada", entidade: "invoices", entidade_id: inv.id, dados_depois: { gateway_id: cobranca!.id, vencimento: dueDate } });
      return NextResponse.json({ ok: true, url: cobranca!.invoiceUrl });
    } catch (e) {
      if (e instanceof AsaasErro) {
        return falha(502, "asaas_falhou", "O Asaas não aceitou a cobrança.", {
          motivo: e.mensagem,
          solucao: e.status === 401 || e.status === 403
            ? "Avise a diretoria: a chave ou o cadastro da conta Asaas precisa de atenção. Enquanto isso, cobre manualmente."
            : "Confira os dados do responsável (nome, CPF/CNPJ, e-mail) e tente de novo. Se repetir, cobre manualmente.",
          detalhes: { status: e.status, codigos: e.codigos },
        });
      }
      console.error("cobrar_asaas falhou:", e);
      return falha(500, "asaas_falhou", "Não foi possível gerar a cobrança agora.", { solucao: "Tente de novo em instantes. Se repetir, avise o desenvolvedor." });
    }
  }

  return falha(400, "acao_invalida", "Ação de mensalidade desconhecida.", { solucao: "Recarregue a página; se repetir, avise o desenvolvedor." });
}
