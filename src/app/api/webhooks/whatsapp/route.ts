import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { assinaturaWebhookOk, telefoneWhatsapp } from "@/lib/meta";
import { confirmarMensagemWhatsapp, dataWhatsapp } from "@/lib/confirmacao-whatsapp";
import { receberOptIn } from "@/lib/retomada-cadastro";
import { notificar } from "@/lib/notificacoes";
import { atenderPedidoConsulta, respostaConsultaWhatsapp } from "@/lib/rural/pedido-whatsapp";
import { CorpoMuitoGrande, limitarFluxo } from "@/lib/seguranca/corpo-limitado";

/**
 * Webhook do WhatsApp Business (Cloud API). GET: verificação da Meta. POST:
 * mensagens e status. A mensagem do cliente entra na oportunidade aberta do
 * mesmo telefone e avisa o corretor; sem oportunidade, vira tarefa do Comercial.
 */
export async function GET(request: Request) {
  const u = new URL(request.url);
  const token = process.env.WHATSAPP_VERIFY_TOKEN;
  if (token && u.searchParams.get("hub.mode") === "subscribe" && u.searchParams.get("hub.verify_token") === token) {
    return new Response(u.searchParams.get("hub.challenge") ?? "", { status: 200 });
  }
  return new Response("Proibido", { status: 403 });
}

type Valor = {
  metadata?: {phone_number_id?: string};
  messages?: { id: string; from: string; timestamp?: string; type: string; text?: { body: string }; button?: { text: string }; interactive?: { button_reply?: { title: string } } }[];
  statuses?: { id: string; status: string; errors?: { title: string }[] }[];
  contacts?: { wa_id: string; profile?: { name?: string } }[];
};

export async function POST(request: Request) {
  const assinatura = request.headers.get("x-hub-signature-256");
  const negado = () => NextResponse.json({ error: "Assinatura inválida." }, { status: 401 });
  if (!process.env.WHATSAPP_APP_SECRET || !assinatura || !/^sha256=[0-9a-f]{64}$/.test(assinatura)) return negado();
  const limite = 8 * 1024 * 1024;
  const grande = () => NextResponse.json({ error: "O evento excedeu o limite de tamanho." }, { status: 413 });
  if (Number(request.headers.get("content-length")) > limite) return grande();
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await new Response(request.body && limitarFluxo(request.body, limite)).arrayBuffer());
  } catch (e) {
    if (e instanceof CorpoMuitoGrande) return grande();
    throw e;
  }
  if (!assinaturaWebhookOk(bytes, assinatura)) return negado();
  const corpo = new TextDecoder().decode(bytes);
  const body = JSON.parse(corpo || "{}") as { entry?: { changes?: { value?: Valor }[] }[] };
  const admin = supabaseAdmin();
  for (const entry of body.entry ?? []) {
    for (const ch of entry.changes ?? []) {
      const v = ch.value ?? {};
      for (const s of v.statuses ?? []) {
        const atualizacoes = [admin.from("whatsapp_mensagens").update({status:s.status,erro:s.errors?.[0]?.title??null}).eq("wa_id",s.id)];
        if(s.status==="failed") for(const tabela of ["assinatura_contatos","retomadas_tentativas","assinatura_pix_whatsapp"]) {
          atualizacoes.push(admin.from(tabela).update({status:"recusado"}).eq("wa_id",s.id).eq("status","enviado"));
        }
        const gravadas=await Promise.all(atualizacoes);
        if(gravadas.some(r=>r.error))return NextResponse.json({error:"Falha ao registrar a entrega."},{status:503});
      }
      for (const m of v.messages ?? []) {
        const texto = m.text?.body ?? m.button?.text ?? m.interactive?.button_reply?.title ?? `[${m.type}]`;
        const recebida=dataWhatsapp(m.timestamp);
        if(await confirmarMensagemWhatsapp(m.from,texto,recebida))continue;
        const remetente=v.contacts?.find(c=>c.wa_id===m.from)?.profile?.name ?? "";
        if(await receberOptIn(m.from,texto,m.id,remetente)) continue;
        const resposta = m.type === "text" && respostaConsultaWhatsapp(texto);
        if (resposta && recebida && Date.now() - Date.parse(recebida) < 24 * 3600_000
          && process.env.WHATSAPP_PHONE_ID && v.metadata?.phone_number_id === process.env.WHATSAPP_PHONE_ID) {
          try { await atenderPedidoConsulta(m.id, m.from, texto, recebida, resposta); }
          catch { return NextResponse.json({ok:false},{status:503}); }
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
        const { error } = await admin.from("whatsapp_mensagens").insert({
          wa_id: m.id, telefone: m.from, recebida_em:recebida, direcao: "entrada", tipo: m.type, texto, opportunity_id: opp?.id ?? null,
        });
        if (error && error.code !== "23505") return NextResponse.json({ ok: false }, { status: 503 });
        if (error?.code === "23505") continue; // a Meta reenviou
        const nome = v.contacts?.find((c) => c.wa_id === m.from)?.profile?.name ?? m.from;
        if (opp) {
          await admin.from("opportunity_events").insert({ opportunity_id: opp.id, tipo: "contato", descricao: `WhatsApp do cliente: ${texto.slice(0, 500)}` });
          await notificar(opp.responsavel_user_id, "atencao", `WhatsApp de ${nome} (${opp.codigo})`, texto.slice(0, 200), `/admin/oportunidades/${opp.id}`);
        } else {
          await admin.rpc("fn_tarefa_automatica", {
            p_chave: `whatsapp_sem_lead:${m.from}:${new Date().toISOString().slice(0, 10)}`, p_regra: "whatsapp_sem_lead", p_setor: "comercial",
            p_titulo: `WhatsApp de ${nome} sem oportunidade`, p_descricao: `Telefone ${m.from}: ${texto.slice(0, 500)}`,
            p_responsavel: null, p_prazo: new Date().toISOString().slice(0, 10), p_prioridade: "alta",
          });
        }
        await logAudit({ acao: "whatsapp_recebido", entidade: "whatsapp_mensagens", opportunity_id: opp?.id ?? null, dados_depois: { de: m.from.slice(0, 4) + "…", tipo: m.type } });
      }
    }
  }
  return NextResponse.json({ ok: true });
}
