// Retenção e descarte (item 6.4 do roadmap).
//
// Lê os prazos em settings (Configurações › Segurança). Prazo 0 = não
// descartar aquela categoria. Com `retencao_executar` desligado (padrão) só
// SIMULA: grava em descartes_log quanto seria apagado e não toca em nada.
//
// Quando executa: apaga primeiro os arquivos do cofre `docs` e só então as
// linhas correspondentes (fn_descarte_aplicar), que conferem de novo se cada
// uma ainda passou do prazo. Arquivo que falhou ao apagar fica com a linha —
// a próxima rodada tenta de novo.
import { createClient } from "@supabase/supabase-js";

// Marco Civil da Internet, art. 15: registros de acesso à aplicação por no mínimo 6 meses
const MINIMO_LOGS_DIAS = 180;

async function lerConfig(db) {
  const { rows } = await db.query(
    `select chave, valor from settings where chave in
      ('retencao_selfie_dias','retencao_docs_reprovados_dias','retencao_logs_acesso_dias','retencao_executar')`);
  const v = Object.fromEntries(rows.map((r) => [r.chave, r.valor]));
  const n = (x) => (Number.isFinite(Number(x)) && Number(x) > 0 ? Math.floor(Number(x)) : 0);
  const logs = n(v.retencao_logs_acesso_dias);
  return {
    selfie: n(v.retencao_selfie_dias),
    docs: n(v.retencao_docs_reprovados_dias),
    logs: logs > 0 ? Math.max(logs, MINIMO_LOGS_DIAS) : 0,
    executar: v.retencao_executar === true || v.retencao_executar === "true",
  };
}

export async function descarteRetencao(payload, db, job) {
  const cfg = await lerConfig(db);
  const jobId = job?.id ?? null;
  if (!cfg.selfie && !cfg.docs && !cfg.logs) {
    console.log("[descarte] todos os prazos em 0 — nada a fazer");
    return;
  }

  if (!cfg.executar || payload?.simular) {
    const { rows: [r] } = await db.query(`select fn_descarte_simular($1, $2, $3, $4) as c`, [cfg.selfie, cfg.docs, cfg.logs, jobId]);
    console.log(`[descarte] simulação: ${r.c.selfies.length} selfie(s), ${r.c.documentos.length} documento(s), logs ${JSON.stringify(r.c.logs)}`);
    return;
  }

  const conexao = await db.connect();
  try {
    await conexao.query("begin");
    await conexao.query("select pg_advisory_xact_lock(109,1)");
    await aplicarDescarte(conexao, cfg, jobId);
    await conexao.query("commit");
  } catch (erro) {
    await conexao.query("rollback");
    throw erro;
  } finally {
    conexao.release();
  }
}

async function aplicarDescarte(db, cfg, jobId) {
  const { rows: [c] } = await db.query(`select fn_descarte_candidatos($1, $2, $3) as c`, [cfg.selfie, cfg.docs, cfg.logs]);
  const paths = [...new Set([...c.c.selfies, ...c.c.documentos].map((x) => x.path).filter(Boolean))];
  const removidos = [];
  if (paths.length) {
    const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
    for (let i = 0; i < paths.length; i += 100) {
      const lote = paths.slice(i, i + 100);
      const { data, error } = await supa.storage.from("docs").remove(lote);
      if (error) { console.error("[descarte] falha ao apagar arquivos:", error.message); continue; }
      // o armazenamento devolve só os que existiam; os que já não existem também podem sair do banco
      const apagados = new Set((data ?? []).map((o) => o.name));
      for (const p of lote) removidos.push(p);
      if (apagados.size < lote.length) console.log(`[descarte] ${lote.length - apagados.size} arquivo(s) já não existiam`);
    }
  }
  const { rows: [r] } = await db.query(`select fn_descarte_aplicar($1, $2, $3, $4, $5) as r`,
    [removidos, cfg.selfie, cfg.docs, cfg.logs, jobId]);
  console.log(`[descarte] aplicado: ${JSON.stringify(r.r)}`);
}
