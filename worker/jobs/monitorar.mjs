// Monitoramento com alerta (roadmap 1.10).
//
// A cada 5 minutos o worker abre /api/saude com o SAUDE_TOKEN e, para cada
// componente que caiu (banco, armazenamento, tiles, fila do worker, fontes
// oficiais), registra um alerta em Segurança › Alertas e manda e-mail aos
// responsáveis. Um alerta por componente por hora — queda longa não vira
// enxurrada de e-mails. Quando volta, registra no log.
//
// O site inteiro fora do ar (o worker nem consegue abrir /api/saude) também
// alerta. Para o caso de a VPS inteira cair (worker junto), o monitor EXTERNO
// (Uptime Kuma / UptimeRobot olhando /api/saude) é quem avisa — ver
// docs/MONITORAMENTO.md.
//
// Variáveis: SITE_URL, SAUDE_TOKEN, RESEND_API_KEY (sem ela só registra),
// ALERTA_EMAILS (separados por vírgula; padrão: notify_email das Configurações).
const COMPONENTES_CRITICOS = new Set(["site", "banco", "armazenamento"]);
const ultimoAlerta = new Map(); // componente → hora
const estadoAnterior = new Map(); // componente → ok

async function enviarEmail(para, assunto, texto) {
  if (!process.env.RESEND_API_KEY || !para.length) return false;
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: process.env.RESEND_FROM ?? "ARINI <naoresponda@arinibrasil.com.br>",
      to: para, subject: assunto, text: texto,
    }),
  }).catch(() => null);
  return !!r?.ok;
}

async function destinatarios(db) {
  if (process.env.ALERTA_EMAILS) return process.env.ALERTA_EMAILS.split(",").map((s) => s.trim()).filter(Boolean);
  const { rows: [r] } = await db.query(`select valor from settings where chave = 'notify_email'`).catch(() => ({ rows: [] }));
  const v = r?.valor;
  return typeof v === "string" && v.includes("@") ? [v] : [];
}

export async function monitorar(db) {
  if (!process.env.SITE_URL) return;
  let componentes;
  try {
    const r = await fetch(`${process.env.SITE_URL}/api/saude`, {
      headers: { "x-saude-token": process.env.SAUDE_TOKEN ?? "" }, signal: AbortSignal.timeout(20_000),
    });
    const j = await r.json().catch(() => null);
    componentes = j?.componentes ?? (j?.ok ? {} : { site: { ok: false, detalhe: `HTTP ${r.status}` } });
  } catch (e) {
    componentes = { site: { ok: false, detalhe: `o site não respondeu: ${e.message}` } };
  }

  for (const [nome, c] of Object.entries(componentes)) {
    if (nome === "ia") continue; // chave ausente é configuração, não queda
    const antes = estadoAnterior.get(nome);
    estadoAnterior.set(nome, c.ok);
    if (c.ok) {
      if (antes === false) console.log(`[monitor] ${nome} voltou ao normal`);
      continue;
    }
    const ultimo = ultimoAlerta.get(nome) ?? 0;
    if (Date.now() - ultimo < 60 * 60_000) continue;
    ultimoAlerta.set(nome, Date.now());

    const severidade = COMPONENTES_CRITICOS.has(nome) ? "alta" : "media";
    console.error(`[monitor] ${nome} com problema: ${c.detalhe ?? "falhou"}`);
    const para = await destinatarios(db);
    const notificado = await enviarEmail(para,
      `[ARINI] ${severidade === "alta" ? "FORA DO AR" : "Instável"}: ${nome}`,
      `O monitoramento encontrou um problema em "${nome}".\n\n${c.detalhe ?? ""}\n\n` +
      `Conferido em ${new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}.\n` +
      `Detalhes: ${process.env.SITE_URL}/admin/seguranca`);
    await db.query(
      `insert into alertas_seguranca (tipo, severidade, detalhe, notificado) values ('sistema_instavel', $1, $2, $3)`,
      [severidade, { componente: nome, problema: c.detalhe ?? null, ms: c.ms ?? null }, notificado],
    ).catch((e) => console.error("[monitor] não gravou o alerta:", e.message));
  }
}
