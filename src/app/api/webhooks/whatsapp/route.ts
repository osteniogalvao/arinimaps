import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { assinaturaWebhookOk, telefoneWhatsapp } from "@/lib/meta";
import { notificar } from "@/lib/notificacoes";

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
  messages?: { id: string; from: string; type: string; text?: { body: string }; button?: { text: string }; interactive?: { button_reply?: { title: string } } }[];
  statuses?: { id: string; status: string; errors?: { title: string }[] }[];
  contacts?: { wa_id: string; profile?: { name?: string } }[];
};

export async function POST(request: Request) {
  const corpo = await request.text();
  if (!assinaturaWebhookOk(corpo, request.headers.get("x-hub-signature-256"))) {
    return NextResponse.json({ error: "Assinatura inválida." }, { status: 401 });
  }
  const body = JSON.parse(corpo || "{}") as { entry?: { changes?: { value?: Valor }[] }[] };
  const admin = supabaseAdmin();
  for (const entry of body.entry ?? []) {
    for (const ch of entry.changes ?? []) {
      const v = ch.value ?? {};
      for (const s of v.statuses ?? []) {
        await admin.from("whatsapp_mensagens").update({ status: s.status, erro: s.errors?.[0]?.title ?? null }).eq("wa_id", s.id);
      }
      for (const m of v.messages ?? []) {
        const texto = m.text?.body ?? m.button?.text ?? m.interactive?.button_reply?.title ?? `[${m.type}]`;
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
          wa_id: m.id, telefone: m.from, direcao: "entrada", tipo: m.type, texto, opportunity_id: opp?.id ?? null,
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
