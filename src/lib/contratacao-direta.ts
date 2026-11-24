import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { clienteDoPlano } from "@/lib/clientes-asaas";
import { checkoutAtivo, conciliarFatura } from "@/lib/assinaturas-cotadas";

/**
 * Contratação direta (áudios do Carlos, 23/11/2026): o cliente escolhe o plano,
 * aceita as condições e já recebe a fatura do Asaas (Pix, boleto ou cartão),
 * sem esperar a Central liberar a proposta. A liberação automática é a função
 * `assinatura_contratar_direto` (migration 0155); o aceite e a emissão são os
 * mesmos da tela "Meus pedidos".
 *
 * Nunca lança. Devolve `direta: true` quando a fatura foi pedida ao Asaas, ou
 * o motivo pelo qual o pedido ficou com a Central / aguardando o cliente.
 */
export type ResultadoDireto = { direta: true } | { direta: false; aviso: string; liberado: boolean };

const AVISO_PADRAO = "Seu pedido foi registrado e a Central confere em seguida. Acompanhe em Meus pedidos.";

export async function contratarDireto(titular: string, pedido: string): Promise<ResultadoDireto> {
  if (!checkoutAtivo()) return { direta: false, liberado: false, aviso: AVISO_PADRAO };
  const db = supabaseAdmin();
  const liberar = await db.rpc("assinatura_contratar_direto", { p_titular: titular, p_pedido: pedido });
  if (liberar.error) {
    // 42883: a migration 0155 ainda não rodou. A fila da Central continua valendo.
    const motivo = ["55000", "P0002"].includes(liberar.error.code) ? liberar.error.message : AVISO_PADRAO;
    return { direta: false, liberado: false, aviso: motivo };
  }
  const { data: s, error } = await db.from("assinaturas_cotadas")
    .select("ciclo,primeira,recorrente,adicionais,aceite,cancelado").eq("id", pedido).eq("titular", titular).maybeSingle();
  if (error || !s || s.cancelado) return { direta: false, liberado: false, aviso: AVISO_PADRAO };
  if (!s.aceite) {
    let cliente: string;
    try { cliente = await clienteDoPlano(titular); } catch (e) {
      return { direta: false, liberado: true, aviso: e instanceof Error && e.message.startsWith("Complete o CPF") ? e.message
        : "A proposta está liberada, mas o cadastro de cobrança no Asaas não respondeu. Abra Meus pedidos e toque em Contratar e gerar fatura." };
    }
    const aceite = await db.rpc("assinatura_aceitar", {
      p_titular: titular, p_id: pedido, p_cliente: cliente, p_primeira: s.primeira, p_recorrente: s.recorrente,
      p_adicionais: s.adicionais, p_ciclo: s.ciclo,
    });
    if (aceite.error) {
      const msg = aceite.error.code === "55000" && aceite.error.message.length > 25 ? aceite.error.message
        : "A proposta está liberada em Meus pedidos. Confira o perfil ativo da conta e conclua por lá.";
      return { direta: false, liberado: true, aviso: msg };
    }
  }
  const pendente: ResultadoDireto = { direta: false, liberado: true,
    aviso: "Seu aceite foi registrado, mas a emissão da fatura ainda está pendente. Acompanhe em Meus pedidos; não é necessário contratar novamente." };
  const { data: faturas, error: erroFaturas } = await db.from("faturas_cotadas").select("id").eq("assinatura", pedido).eq("numero", 0).in("status", ["nova", "emitindo"]);
  if (erroFaturas) return pendente;
  const emissoes = await Promise.allSettled((faturas ?? []).map((f) => conciliarFatura(f.id)));
  if (emissoes.some((r) => r.status === "rejected")) return pendente;
  return { direta: true };
}
