import "server-only";
import { urlDoSite } from "@/lib/compartilhar";
import { enviarDocumentoWhatsapp, enviarWhatsapp } from "@/lib/meta";
import { supabaseAdmin } from "@/lib/supabase/admin";

/** Só comandos explícitos abrem autosserviço. Conversas comerciais seguem no CRM. */
export function respostaConsultaWhatsapp(texto: string): string | null {
  const pedido = /^(?:consultar|consulta|relat[oó]rio|laudo)(?:\s+(?:do|de))?\s+car(?:\s*[:#]?\s+([A-Z]{2}-\d{7}-[\dA-F.]{32,39}))?[.!]?$/i.exec(texto.trim());
  if (!pedido) return null;
  const codigo = pedido[1]?.toUpperCase().replace(/\./g, "");
  if (codigo && /^[A-Z]{2}-\d{7}-[A-F0-9]{32}$/.test(codigo)) {
    return "Abra a consulta desta área na ARINI para ver o cadastro e baixar o PDF. Entre na sua conta para acessar os módulos e o relatório do seu plano. " + urlDoSite() + "/consulta/car/" + codigo;
  }
  return "Escolha a área no mapa da ARINI ou envie CONSULTAR CAR seguido do código completo do imóvel. " + urlDoSite() + "/mapa";
}

type Anexo = { link: string; nome: string; legenda: string; mimetype?: string };

export async function atenderPedidoConsulta(id: string, telefone: string, texto: string, recebida: string, resposta: string, tipo = "text", phoneId?: string, documento?: Anexo, anexos: Anexo[] = []) {
  const db = supabaseAdmin();
  // Uma reserva por mensagem assinada da Meta. Reentregas não disparam nova resposta.
  const {error: reserva} = await db.from("whatsapp_mensagens").insert({
    wa_id:id, telefone, recebida_em:recebida, direcao:"entrada", tipo, texto, status:"consulta_em_envio",
  });
  if (reserva && reserva.code !== "23505") throw Error("Falha ao registrar o pedido territorial.");
  if (!reserva) {
    const waId = await enviarWhatsapp(telefone,resposta,phoneId).catch(() => "");
    if (waId) {
      const saida = await db.from("whatsapp_mensagens").upsert({wa_id:waId,telefone,direcao:"saida",tipo:"text",texto:resposta}, {onConflict:"wa_id",ignoreDuplicates:true});
      if (saida.error) throw Error("Falha ao registrar a resposta territorial.");
      // o PDF vai depois do texto; se a Meta recusar, o texto já tem o link da ficha
      const docId = documento ? await enviarDocumentoWhatsapp(telefone, documento.link, documento.nome, documento.legenda, phoneId).catch(() => "") : "";
      if (docId) await db.from("whatsapp_mensagens").upsert({wa_id:docId,telefone,direcao:"saida",tipo:"document",texto:documento!.legenda}, {onConflict:"wa_id",ignoreDuplicates:true});
      // KMZ/KML do plano (24/11): cada um por conta própria; uma recusa não derruba os outros
      for (const a of anexos) {
        const aId = await enviarDocumentoWhatsapp(telefone, a.link, a.nome, a.legenda, phoneId, a.mimetype).catch(() => "");
        if (aId) await db.from("whatsapp_mensagens").upsert({wa_id:aId,telefone,direcao:"saida",tipo:"document",texto:a.legenda}, {onConflict:"wa_id",ignoreDuplicates:true});
      }
      const fim = await db.from("whatsapp_mensagens").update({status:"consulta_respondida"}).eq("wa_id",id);
      if (fim.error) throw Error("Falha ao encerrar o pedido territorial.");
      return;
    }
  } else {
    const estado = await db.from("whatsapp_mensagens").select("status,created_at").eq("wa_id",id).single();
    if (estado.error) throw Error("Falha ao conferir o pedido territorial.");
    if (estado.data.status === "consulta_respondida" || estado.data.status === "consulta_revisao") return;
    if (Date.now() - Date.parse(estado.data.created_at) < 60000) throw Error("Resposta territorial em andamento.");
  }
  // Uma entrega incerta requer conferência antes de repetir o envio.
  const tarefa = await db.rpc("fn_tarefa_automatica",{
    p_chave:"consulta_car_whatsapp:"+id,p_regra:"consulta_car_whatsapp",p_setor:"comercial",
    p_titulo:"Conferir resposta à consulta territorial por WhatsApp",
    p_descricao:"Confira a entrega à conversa "+telefone+" antes de responder ao pedido de consulta do CAR.",
    p_responsavel:null,p_prazo:new Date().toISOString().slice(0,10),p_prioridade:"alta",
  });
  if (tarefa.error) throw Error("Falha ao encaminhar o pedido territorial para conferência.");
  const fim = await db.from("whatsapp_mensagens").update({status:"consulta_revisao"}).eq("wa_id",id);
  if (fim.error) throw Error("Falha ao guardar o encaminhamento territorial.");
}
