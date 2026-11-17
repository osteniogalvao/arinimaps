import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { enviarModeloWhatsapp, MetaErro, modeloWhatsappAprovado, whatsappConfigurado } from "@/lib/meta";
import { acessoComMatriz } from "@/lib/direitos-persona-servidor";
import { planoDaOrganizacao } from "@/lib/organizacoes-servidor";
import { RECURSOS, type Plano } from "@/lib/planos";

export async function contatosDasAssinaturas() {
  const db = supabaseAdmin();
  const { data: preparados, error } = await db.rpc("assinatura_preparar_contatos");
  if (error) throw Error("Não foi possível preparar os avisos de assinatura.");
  if (!whatsappConfigurado()) return { preparados, enviados: 0 };

  const { data: regras, error: er } = await db
    .from("assinatura_regras_contato")
    .select("tipo,modelo_id")
    .eq("ativo", true)
    .not("modelo_id", "is", null);
  if (er) throw Error("Falha ao consultar regras de contato.");
  let enviados = 0;
  const inicio = Date.now();
  for (const regra of regras ?? []) {
    const { data: fila, error: ef } = await db
      .from("assinatura_contatos")
      .select("id,assinatura")
      .eq("tipo", regra.tipo)
      .eq("status", "pendente")
      .order("id")
      .limit(6);
    if (ef) throw Error("Falha ao consultar avisos.");
    if ((!fila?.length && regra.tipo !== "recuperacao") || Date.now() - inicio > 45_000) continue;
    const modelo = await modeloWhatsappAprovado(regra.modelo_id, 2, false, regra.tipo === "recuperacao" ? "retomada" : "assinatura").catch(() => null);
    if (!modelo) continue;
    if (regra.tipo === "recuperacao") {
      for (let i = 0; i < 6 && Date.now() - inicio < 45_000; i++) {
        const { data, error: er } = await db.rpc("retomada_reservar", { p_modelo: regra.modelo_id });
        if (er) throw Error("Falha ao reservar retomada de cadastro.");
        const guest = data?.[0];
        if (!guest) break;
        const rota = new URL("/planos", process.env.NEXT_PUBLIC_SITE_URL || "https://arinibrasil.com.br");
        rota.searchParams.set("pacote", guest.plano);
        rota.searchParams.set("perfil", guest.perfil);
        let status = "recusado",
          waId: string | null = null;
        try {
          waId = await enviarModeloWhatsapp(
            guest.telefone,
            [guest.nome?.split(" ")[0] || "cliente", rota.href],
            modelo,
          );
          status = "enviado";
          enviados++;
        } catch (e) {
          if (!(e instanceof MetaErro) || e.entregaIncerta) status = "conferir";
        }
        const gravado = await db
          .from("retomadas_tentativas")
          .update({ wa_id: waId, status })
          .eq("retomada", guest.id)
          .eq("passo", guest.passo)
          .eq("status", "enviando");
        if (gravado.error) throw Error("Falha ao registrar tentativa do cadastro.");
      }
    }
    for (const item of fila ?? []) {
      if (Date.now() - inicio > 45_000) break;
      const { data, error: reserva } = await db.rpc("assinatura_reservar_contato", {
        p_id: item.id,
        p_modelo: regra.modelo_id,
      });
      if (reserva) throw Error("Falha ao reservar contato.");
      const contato = data?.[0];
      if (!contato) continue;
      const portal = new URL(
        "/planos/solicitacoes",
        process.env.NEXT_PUBLIC_SITE_URL || "https://arinibrasil.com.br",
      );
      portal.searchParams.set("pedido", item.assinatura);
      let status: string,
        waId: string | null = null;
      try {
        waId = await enviarModeloWhatsapp(contato.telefone, [contato.nome || "cliente", portal.href], modelo);
        status = "enviado";
        enviados++;
      } catch (e) {
        status = e instanceof MetaErro && !e.entregaIncerta ? "recusado" : "conferir";
      }
      const { error: escrita } = await db
        .from("assinatura_contatos")
        .update({ status, wa_id: waId, alterado_em: new Date().toISOString() })
        .eq("id", item.id)
        .eq("status", "enviando");
      if (escrita) throw Error("Falha ao registrar a entrega.");
    }
  }
  return { preparados, enviados };
}

/** Exibida somente na Central. Um número ambíguo não identifica o titular. */
export async function fichaPeloWhatsapp(numero: string | null) {
  if (!numero) return null;
  const db = supabaseAdmin();
  const { data: titular, error } = await db.rpc("assinatura_titular_telefone", { p_numero: numero });
  if (error) throw Error("Falha ao associar telefone.");
  if (!titular) return null;
  const { data: p, error: ep } = await db
    .from("profiles")
    .select("nome,role,nicho,entrada_ativa,plan_id,plan_origem,plan_valido_ate")
    .eq("user_id", titular)
    .eq("ativo", true)
    .maybeSingle();
  if (ep) throw Error("Falha ao consultar cadastro.");
  if (!p) return null;
  const [pessoal, org, faturas] = await Promise.all([
    p.plan_id
      ? db.from("plans").select("*").eq("id", p.plan_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    (p.plan_origem ?? "padrao") === "padrao" ? planoDaOrganizacao(titular) : null,
    db
      .from("faturas_cotadas")
      .select("status,valor,inicio,assinaturas_cotadas!inner(titular)")
      .eq("assinaturas_cotadas.titular", titular)
      .in("status", ["aberta", "vencida"])
      .order("inicio", { ascending: false })
      .limit(5),
  ]);
  if (pessoal.error || faturas.error) throw Error("Ficha de assinatura indisponível.");
  const acesso = await acessoComMatriz(
    p.role,
    (org?.plano ?? pessoal.data) as Plano | null,
    p.nicho,
    org ? org.validoAte : p.plan_valido_ate,
    p.entrada_ativa,
    titular,
  );
  return {
    nome: p.nome,
    plano: acesso.planNome,
    vencido: acesso.vencido,
    recursos: RECURSOS.filter((r) => acesso.recursos.has(r.id)).map((r) => r.nome),
    faturas: (faturas.data ?? []).map((f) => ({ status: f.status, valor: f.valor, inicio: f.inicio })),
  };
}
