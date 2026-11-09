// Lembretes do proprietário (item 28 da segunda etapa, migration 0060).
//
// O proprietário cria um lembrete (data + texto) na aba Acompanhamento do
// imóvel. Este job roda de hora em hora e envia, por e-mail, os lembretes cuja
// data já chegou (horário de Brasília) e ainda não foram enviados.
//
// Canal isolado em `enviarLembrete`: quando houver a WhatsApp Business API, o
// envio pelo WhatsApp entra ali, sem mexer no resto.
// Sem RESEND_API_KEY o job não marca nada como enviado (tenta de novo depois).
// Cada erro de envio conta uma tentativa; na 5ª o lembrete fica `falhou` e sai da fila.

const LOTE = 200;
const MAX_TENTATIVAS = 5;

function esc(t) {
  return String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Envia o lembrete pelo canal disponível. true = entregue ao provedor. */
async function enviarLembrete({ email, assunto, texto }) {
  if (!process.env.RESEND_API_KEY || !email) return false;
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: process.env.RESEND_FROM ?? "Arini Imóveis Brasil <naoresponda@arinibrasil.com.br>",
      to: [email],
      subject: assunto,
      text: texto,
      html: `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.6;color:#0E2A20">${esc(texto).replace(/\n/g, "<br>")}</div>`,
    }),
  });
  if (!r.ok) throw new Error(`Resend ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return true;
}

export async function lembretesProprietario(_payload, db) {
  let rows;
  try {
    ({ rows } = await db.query(`
      select l.id, l.texto, l.data, l.property_id, p.codigo, p.titulo, u.email
      from property_lembretes l
      join properties p on p.id = l.property_id
      join auth.users u on u.id = l.user_id
      where l.enviado_em is null
        and not l.falhou
        and l.data <= (now() at time zone 'America/Sao_Paulo')::date
      order by l.data
      limit $1`, [LOTE]));
  } catch (e) {
    // tabela ainda não criada (migration 0060): nada a fazer
    console.log("[lembretes] indisponível:", e.message);
    return;
  }
  if (!rows.length) return;

  const site = process.env.SITE_URL ?? process.env.NEXT_PUBLIC_SITE_URL ?? "https://arinibrasil.com.br";
  let enviados = 0;
  for (const l of rows) {
    try {
      const ok = await enviarLembrete({
        email: l.email,
        assunto: `Lembrete — ${l.codigo}`,
        texto: `Você pediu para lembrar sobre o imóvel ${l.codigo} (${l.titulo}):\n\n${l.texto}\n\nAcompanhamento do imóvel: ${site}/painel/imoveis/${l.property_id}/acompanhamento`,
      });
      if (!ok) continue;
      await db.query(`update property_lembretes set enviado_em = now(), erro = null where id = $1`, [l.id]);
      enviados++;
    } catch (e) {
      await db.query(
        `update property_lembretes
            set erro = $2, tentativas = tentativas + 1, falhou = (tentativas + 1 >= $3)
          where id = $1`,
        [l.id, String(e.message).slice(0, 500), MAX_TENTATIVAS],
      ).catch(() => {});
    }
  }
  console.log(`[lembretes] ${enviados} de ${rows.length} enviado(s)`);
}
