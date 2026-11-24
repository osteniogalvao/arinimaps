import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { telefoneWhatsapp } from "@/lib/meta";
import { confirmarMensagemWhatsapp, dataWhatsapp } from "@/lib/confirmacao-whatsapp";
import { receberOptIn } from "@/lib/retomada-cadastro";
import { notificar } from "@/lib/notificacoes";
import { atenderPedidoConsulta, respostaConsultaWhatsapp } from "@/lib/rural/pedido-whatsapp";
import { entradaAtendimento } from "@/lib/atendimento";
import { pedidoAtendimento, pedidoLinhaCotacoes, respostaAtendimento } from "@/lib/rural/atendimento-whatsapp";

/**
 * Recebimento do WhatsApp, comum à Meta e à Evolution. Cada webhook confere a
 * própria autenticação e traduz o evento para este formato (o da Cloud API).
 * A mensagem do cliente entra na oportunidade aberta do mesmo telefone e avisa
 * o corretor; sem oportunidade, vira tarefa do Comercial. Comandos explícitos
 * (MENU, BOI, COTAÇÃO, CONSULTAR CAR, localização) recebem resposta automática.
 *
 * Devolve false quando o banco falhou e o provedor deve reenviar o evento.
 */
export type ValorWhatsapp = {
  metadata?: {phone_number_id?: string};
  messages?: { id: string; from: string; timestamp?: string; type: string; text?: { body: string }; button?: { text: string }; interactive?: { button_reply?: { title: string } }; location?: { latitude?: number; longitude?: number } }[];
  statuses?: { id: string; status: string; errors?: { title: string }[] }[];
  contacts?: { wa_id: string; profile?: { name?: string } }[];
};

/** De qual número veio o evento: id do provedor e se é o principal ou o de cotações. */
export type CanalWhatsapp = { id?: string; principal: boolean; cotacoes: boolean };

export async function processarValorWhatsapp(v: ValorWhatsapp, canal: CanalWhatsapp): Promise<boolean> {
  const admin = supabaseAdmin();
  for (const s of v.statuses ?? []) {
    const atualizacoes = [admin.from("whatsapp_mensagens").update({status:s.status,erro:s.errors?.[0]?.title??null}).eq("wa_id",s.id)];
    if(s.status==="failed") for(const tabela of ["assinatura_contatos","retomadas_tentativas","assinatura_pix_whatsapp"]) {
      atualizacoes.push(admin.from(tabela).update({status:"recusado"}).eq("wa_id",s.id).eq("status","enviado"));
    }
    const gravadas=await Promise.all(atualizacoes);
    if(gravadas.some(r=>r.error))return false;
  }
  for (const m of v.messages ?? []) {
    const texto = m.text?.body ?? m.button?.text ?? m.interactive?.button_reply?.title
      ?? (m.type === "location" && m.location ? `[localização ${m.location.latitude},${m.location.longitude}]` : `[${m.type}]`);
    const recebida=dataWhatsapp(m.timestamp);
    if(await confirmarMensagemWhatsapp(m.from,texto,recebida))continue;
    const remetente=v.contacts?.find(c=>c.wa_id===m.from)?.profile?.name ?? "";
    if(await receberOptIn(m.from,texto,m.id,remetente)) continue;
    // autosserviço: CONSULTAR CAR, MENU, BOI, COTAÇÃO e localização (atendimento estilo Dados Fazenda, 16/11)
    // número só de cotações: toda mensagem recebe cotação, sem conta
    const phoneId = canal.id;
    const linhaCotacoes = canal.cotacoes;
    const pedido = linhaCotacoes ? pedidoLinhaCotacoes(m) : pedidoAtendimento(m);
    const pedidoCar = !linhaCotacoes && m.type === "text" && respostaConsultaWhatsapp(texto);
    const dentroDaJanela = !!recebida && Date.now() - Date.parse(recebida) < 24 * 3600_000
      && (linhaCotacoes || canal.principal);
    const atendimento = dentroDaJanela && pedido ? await respostaAtendimento(pedido, m.from, linhaCotacoes) : null;
    const resposta = dentroDaJanela && (atendimento?.texto || pedidoCar);
    if (resposta && recebida) {
      try { await atenderPedidoConsulta(m.id, m.from, texto, recebida, resposta, m.type === "location" ? "location" : "text", phoneId, atendimento?.documento, atendimento?.anexos); }
      catch { return false; }
      continue;
    }
    const final = m.from.slice(-8);
    // oportunidade aberta mais recente com telefone que termina igual
    const { data: leads } = await admin.from("leads").select("id, telefone").ilike("telefone", `%${final.slice(0, 4)}%${final.slice(4)}%`).limit(20);
    let opp: { id: string; codigo: string; responsavel_user_id: string | null } | null = null;
    const correspondentes = leads?.filter((l) => telefoneWhatsapp(l.telefone) === m.from);
    if (correspondentes?.length) {
      const { data } = await admin.from("opportunities").select("id, codigo, responsavel_user_id")
        .in("lead_id", correspondentes.map((l) => l.id)).not("etapa", "in", "(fechado,pos_venda,perdido)").order("updated_at", { ascending: false }).limit(1).maybeSingle();
      opp = data;
    }
    const { data: gravada, error } = await admin.from("whatsapp_mensagens").insert({
      wa_id: m.id, telefone: m.from, recebida_em:recebida, direcao: "entrada", tipo: m.type, texto, opportunity_id: opp?.id ?? null,
    }).select("id").single();
    if (error && error.code !== "23505") return false;
    if (error?.code === "23505" || !gravada) continue; // o provedor reenviou
    const nome = v.contacts?.find((c) => c.wa_id === m.from)?.profile?.name ?? m.from;
    // Atendimento por setores (0156): conversa do telefone, menu automático e fila do setor.
    // Sem a migration, segue o caminho antigo (tarefa do Comercial).
    const noAtendimento = canal.principal && await entradaAtendimento({
      telefone: m.from, nome: remetente, texto, mensagemId: gravada.id, opp, canal: phoneId,
    }).catch((e) => { console.error("atendimento:", e); return false; });
    if (opp) {
      await admin.from("opportunity_events").insert({ opportunity_id: opp.id, tipo: "contato", descricao: `WhatsApp do cliente: ${texto.slice(0, 500)}` });
      await notificar(opp.responsavel_user_id, "atencao", `WhatsApp de ${nome} (${opp.codigo})`, texto.slice(0, 200), `/admin/oportunidades/${opp.id}`);
    } else if (!noAtendimento) {
      await admin.rpc("fn_tarefa_automatica", {
        p_chave: `whatsapp_sem_lead:${m.from}:${new Date().toISOString().slice(0, 10)}`, p_regra: "whatsapp_sem_lead", p_setor: "comercial",
        p_titulo: `WhatsApp de ${nome} sem oportunidade`, p_descricao: `Telefone ${m.from}: ${texto.slice(0, 500)}`,
        p_responsavel: null, p_prazo: new Date().toISOString().slice(0, 10), p_prioridade: "alta",
      });
    }
    await logAudit({ acao: "whatsapp_recebido", entidade: "whatsapp_mensagens", opportunity_id: opp?.id ?? null, dados_depois: { de: m.from.slice(0, 4) + "…", tipo: m.type } });
  }
  return true;
}
