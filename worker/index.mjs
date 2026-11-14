// Worker do Arini Imóveis Brasil — polling da tabela jobs (Postgres/Supabase).
// Processa: otimizar_video · render_video · screenshot_og · tile_raster · fetch_pois · refresh_pois · gerar_lotes · descarte_retencao · verificar_fontes · inteligencia_mercado · coletar_cotacoes
// Uma fila para os jobs gerais e uma para consultas de POIs.
import pg from "pg";
import { setTimeout as esperar } from "node:timers/promises";
import { executarJob, proximoJob, recuperarInterrompidos } from "./fila.mjs";
import { renderVideo } from "./jobs/renderVideo.mjs";
import { screenshotOg } from "./jobs/screenshotOg.mjs";
import { tileRaster } from "./jobs/tileRaster.mjs";
import { fetchPois } from "./jobs/fetchPois.mjs";
import { gerarLotes } from "./jobs/gerarLotes.mjs";
import { descarteRetencao } from "./jobs/descarteRetencao.mjs";
import { limparCofre } from "./jobs/limparCofre.mjs";
import { verificarFontes } from "./jobs/verificarFontes.mjs";
import { inteligenciaMercado } from "./jobs/inteligenciaMercado.mjs";
import { otimizarVideo } from "./jobs/otimizarVideo.mjs";
import { monitorar } from "./jobs/monitorar.mjs";
import { lembretesProprietario } from "./jobs/lembretesProprietario.mjs";
import { coletarCotacoes } from "./jobs/cotacoes.mjs";

const INTERVALO_MS = Number(process.env.WORKER_INTERVALO_MS ?? 15000);

export const db = new pg.Pool({
  connectionString: process.env.DATABASE_URL, // postgres://postgres:SENHA@db.REF.supabase.co:5432/postgres
  ssl: { rejectUnauthorized: false },
  max: 3,
  connectionTimeoutMillis: 15000,
  query_timeout: 360_000,
  keepAlive: true,
  keepAliveInitialDelayMillis: 15000,
});

const HANDLERS = {
  render_video: renderVideo,
  screenshot_og: screenshotOg,
  tile_raster: tileRaster,
  fetch_pois: fetchPois,
  // atualização periódica dos POIs (POST /api/admin/pois/atualizar): mesmo trabalho, outra origem
  refresh_pois: fetchPois,
  gerar_lotes: gerarLotes,
  descarte_retencao: descarteRetencao,
  limpar_cofre: limparCofre,
  // teste de queda e lentidão das fontes oficiais (PENDENCIAS 3.16)
  verificar_fontes: verificarFontes,
  // preço por ha/m² por município para o assistente (migration 0040)
  inteligencia_mercado: inteligenciaMercado,
  // vídeo do anunciante → MP4 720p que toca em qualquer aparelho
  otimizar_video: otimizarVideo,
  // lembretes do proprietário com data vencida → e-mail (migration 0060, item 28)
  lembretes_proprietario: lembretesProprietario,
  // cotações do agro para a faixa do topo e o /mercado (migration 0056)
  coletar_cotacoes: coletarCotacoes,
};

// O Swarm envia SIGTERM antes de trocar a imagem. Termine o job já obtido
// antes de sair, para a próxima réplica continuar da mesma fila.
let encerrando = false;
function encerrar() { encerrando = true; }
process.on("SIGTERM", encerrar);
process.on("SIGINT", encerrar);

async function loop(apenasPois) {
  while (!encerrando) {
    try {
      const job = await proximoJob(db, apenasPois);
      if (job) {
        console.log(`[job ${job.id}] ${job.tipo} (tentativa ${job.tentativas})`);
        await executarJob(db, job, HANDLERS[job.tipo]);
        continue;
      }
      if (process.env.WORKER_UMA_VEZ) return;
    } catch (e) {
      console.error("falha ao processar a fila:", e.message);
      if (process.env.WORKER_UMA_VEZ) throw e;
    }
    if (!encerrando) await esperar(INTERVALO_MS);
  }
}

// Rotinas diárias: enfileira o descarte por prazo de guarda (item 6.4) uma vez
// a cada 24 h. Com os prazos em 0 (padrão) o job termina sem fazer nada; com
// prazos e "Descartar de verdade" desligado, só simula e registra.
// Também recalcula, uma vez por dia, a inteligência de mercado do assistente
// (preço por ha/m² por município). Cada rotina no seu try: uma falha não
// impede a outra de ser agendada.
const ROTINAS_DIARIAS = ["descarte_retencao", "inteligencia_mercado", "limpar_cofre"];
async function agendarRotinas() {
  for (const tipo of ROTINAS_DIARIAS) {
    try {
      await db.query(`
        insert into jobs (tipo, payload)
        select $1::text, '{}'::jsonb
        where not exists (
          select 1 from jobs where tipo = $1::text
            and (status = 'pendente' or created_at > now() - interval '23 hours')
        )`, [tipo]);
    } catch (e) {
      console.error(`agendar ${tipo} falhou:`, e.message);
    }
  }
}

// Teste de queda e lentidão das fontes oficiais a cada 6 h (VERIFICA_FONTES_HORAS).
// Três falhas seguidas deixam a fonte "instável" no relatório e no /admin/fontes.
const VERIFICA_FONTES_HORAS = Number(process.env.VERIFICA_FONTES_HORAS ?? 6);
async function agendarVerificacaoFontes() {
  try {
    await db.query(`
      insert into jobs (tipo, payload)
      select 'verificar_fontes', '{"origem":"worker"}'::jsonb
      where not exists (
        select 1 from jobs where tipo = 'verificar_fontes'
          and (status = 'pendente' or created_at > now() - make_interval(mins => $1::int))
      )`, [Math.max(10, Math.round(VERIFICA_FONTES_HORAS * 60) - 10)]);
  } catch (e) {
    console.error("agendar verificação das fontes falhou:", e.message);
  }
}

// Pontos de referência vencidos (roadmap 2.12): uma vez por dia, enfileira os
// anúncios ativos cujos POIs passaram de `poi_atualizar_dias` (Configurações ›
// Mapa, padrão 90) — mesma função que o botão da Cartografia usa.
async function agendarPois() {
  try {
    const { rows: [cfg] } = await db.query(`select valor from settings where chave = 'poi_atualizar_dias'`);
    const dias = Math.max(1, Math.min(3650, Number(cfg?.valor ?? 90) || 90));
    const { rows: [r] } = await db.query(`select fn_enfileirar_refresh_pois($1, 200) as n`, [dias]);
    if (Number(r?.n)) console.log(`[pois] ${r.n} anúncio(s) com pontos de referência vencidos na fila`);
  } catch (e) {
    console.error("agendar pontos de referência falhou:", e.message);
  }
}

// Cotações do agro (faixa do topo e /mercado): uma coleta a cada
// COTACOES_HORAS (padrão 3 h). O CEPEA publica no fim da tarde; o dólar e o
// Ibovespa mudam durante o pregão. A primeira coleta com a tabela vazia já faz
// a carga de 1 ano (ver jobs/cotacoes.mjs).
const COTACOES_HORAS = Number(process.env.COTACOES_HORAS ?? 3);
async function agendarCotacoes() {
  try {
    await db.query(`
      insert into jobs (tipo, payload)
      select 'coletar_cotacoes', '{}'::jsonb
      where not exists (
        select 1 from jobs where tipo = 'coletar_cotacoes'
          and (status in ('pendente', 'processando') or created_at > now() - make_interval(mins => $1::int))
      )`, [Math.max(30, Math.round(COTACOES_HORAS * 60) - 10)]);
  } catch (e) {
    console.error("agendar cotações falhou:", e.message);
  }
}

// Lembretes do proprietário (item 28): de hora em hora, envia os que venceram.
async function agendarLembretes() {
  try {
    await db.query(`
      insert into jobs (tipo, payload)
      select 'lembretes_proprietario', '{}'::jsonb
      where not exists (
        select 1 from jobs where tipo = 'lembretes_proprietario'
          and (status = 'pendente' or created_at > now() - interval '55 minutes')
      )`);
  } catch (e) {
    console.error("agendar lembretes falhou:", e.message);
  }
}

// Central operacional (migration 0065): a cada 10 min roda as regras que cobram
// o que ficou parado (lead sem corretor ou sem contato, visita sem relatório,
// encaminhamento sem aceite, cadastro parado). Chamada direta, sem passar pela
// fila: é uma função SQL curta e idempotente (cada ocorrência gera uma tarefa só).
async function rodarCentral() {
  try {
    const { rows: [r] } = await db.query(`select fn_central_automacoes() as r`);
    // regras dos módulos (0066 em diante); sem a migration, só as da 0065
    const m = await db.query(`select fn_central_modulos() as r`).catch((e) => {
      if (e.code === "42883") return { rows: [] };
      throw e;
    });
    const feitos = Object.entries({ ...(r?.r ?? {}), ...(m.rows[0]?.r ?? {}) }).filter(([, v]) => Number(v) > 0);
    if (feitos.length) console.log("[central]", feitos.map(([k, v]) => `${k}=${v}`).join(" "));
    await emailsCriticos();
    // publicações agendadas que chegaram na hora (Central de publicação)
    if (process.env.SITE_URL && process.env.SAUDE_TOKEN) {
      const resposta = await fetch(`${process.env.SITE_URL}/api/interno/publicar`, {
        method: "POST", headers: { "x-saude-token": process.env.SAUDE_TOKEN }, signal: AbortSignal.timeout(120_000),
      });
      if (!resposta.ok) throw new Error(`Publicações agendadas: HTTP ${resposta.status}`);
    }
  } catch (e) {
    // banco sem a migration 0065: fica quieto até ela rodar
    if (e.code !== "42883" || !/fn_central_automacoes/.test(e.message)) console.error("[central] falhou:", e.message);
  }
}

// Notificações críticas criadas pelo banco (ex.: tarefa escalonada para a
// Diretoria) também vão por e-mail. As criadas pelo site já saem de lá.
async function emailsCriticos() {
  if (!process.env.RESEND_API_KEY) return;
  const { rows } = await db.query(`
    select n.id, n.titulo, n.texto, n.link, u.email
    from notificacoes n join auth.users u on u.id = n.user_id
    where n.nivel = 'critico' and n.email_em is null and n.created_at > now() - interval '1 day'
    order by n.created_at limit 20`).catch(() => ({ rows: [] }));
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? "https://arinibrasil.com.br";
  for (const n of rows) {
    try {
      const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: process.env.RESEND_FROM ?? "Arini Imóveis Brasil <naoresponda@arinibrasil.com.br>",
          to: [n.email], subject: n.titulo, text: `${n.texto ?? ""}\n\n${n.link ? site + n.link : ""}`.trim(),
        }),
      });
      if (r.ok) await db.query(`update notificacoes set email_em = now() where id = $1`, [n.id]);
    } catch (e) {
      console.error("[central] e-mail crítico falhou:", e.message);
    }
  }
}

console.log("Arini Imóveis Brasil worker iniciado.");
async function verificarInterrompidos() {
  try {
    const total = await recuperarInterrompidos(db);
    if (total) console.log(`[fila] ${total} coleta(s) interrompida(s) registrada(s)`);
  } catch (e) {
    console.error("falha ao verificar coletas interrompidas:", e.message);
  }
}
// monitoramento: confere /api/saude a cada 5 min e alerta (jobs/monitorar.mjs)
if (!process.env.WORKER_UMA_VEZ) {
  setInterval(verificarInterrompidos, 5 * 60_000);
  setInterval(() => void monitorar(db).catch((e) => console.error("[monitor]", e.message)), 5 * 60_000);
  setTimeout(() => void monitorar(db).catch((e) => console.error("[monitor]", e.message)), 30_000);
}
await Promise.all([verificarInterrompidos(), agendarPois(), agendarVerificacaoFontes(), agendarRotinas(), agendarLembretes(), agendarCotacoes()]);
setInterval(agendarPois, 24 * 60 * 60 * 1000);
setInterval(agendarVerificacaoFontes, 30 * 60 * 1000);
setInterval(agendarRotinas, 60 * 60 * 1000);
setInterval(agendarLembretes, 15 * 60 * 1000);
setInterval(agendarCotacoes, 20 * 60 * 1000);
if (!process.env.WORKER_UMA_VEZ) {
  setTimeout(rodarCentral, 60_000);
  setInterval(rodarCentral, 10 * 60 * 1000);
}
await Promise.all([loop(false), loop(true)]);
await db.end();
process.exit(0);
