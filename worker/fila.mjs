const TIPOS_POI = ["fetch_pois", "refresh_pois"];
const RECUPERAVEIS = [...TIPOS_POI, "coletar_cotacoes"];
const MAX_TENTATIVAS = 3;

// Uma consulta ao Overpass pode aguardar vários espelhos. Reserve uma vaga
// exclusiva para POIs e mantenha os jobs de vídeo, CAD e cotações em série.
export async function proximoJob(db, apenasPois) {
  const { rows } = await db.query(`
    update jobs set status = 'processando', tentativas = tentativas + 1, updated_at = now()
    where id = (
      select id from jobs
      where (tipo = any($1::text[])) = $2
        and (status = 'pendente' or (
          status = 'erro' and tentativas < $3
          and (tipo <> all($4::text[]) or updated_at <= now() - interval '1 minute' * least(tentativas * 5, 30))
        ))
      order by created_at, id
      limit 1 for update skip locked
    )
    returning id, tipo, payload, tentativas
  `, [TIPOS_POI, apenasPois, MAX_TENTATIVAS, RECUPERAVEIS]);
  return rows[0] ?? null;
}

// Os três handlers gravam os dados por chave estável. Só eles podem ser
// repetidos depois de um SIGKILL sem duplicar e-mails ou outros efeitos.
export async function recuperarInterrompidos(db) {
  const { rowCount } = await db.query(`
    update jobs set status = 'erro', erro = 'Worker interrompido durante a coleta', updated_at = now()
    where status = 'processando' and tipo = any($1::text[])
      and updated_at < now() - interval '20 minutes'
  `, [RECUPERAVEIS]);
  return rowCount;
}

export async function executarJob(db, job, handler) {
  const tentativa = [job.id, job.tentativas];
  let heartbeat;
  if (RECUPERAVEIS.includes(job.tipo)) {
    heartbeat = setInterval(() => {
      db.query(`update jobs set updated_at = now()
        where id = $1 and tentativas = $2 and status = 'processando'`, tentativa)
        .catch((e) => console.error(`[job ${job.id}] falha ao renovar atividade:`, e.message));
    }, 60_000);
  }
  let erro = null;
  try {
    if (!handler) throw new Error(`tipo desconhecido: ${job.tipo}`);
    await handler(job.payload, db, job);
  } catch (e) {
    erro = (e instanceof Error ? e.message : String(e)).slice(0, 2000);
  } finally {
    clearInterval(heartbeat);
  }
  const status = erro === null ? "concluido" : "erro";
  const result = await db.query(`update jobs set status = $3, erro = $4, updated_at = now()
    where id = $1 and tentativas = $2 and status = 'processando'`, [...tentativa, status, erro]);
  if (!result.rowCount) console.error(`[job ${job.id}] tentativa substituída`);
  else if (erro !== null) console.error(`[job ${job.id}] falhou: ${erro}`);
  else console.log(`[job ${job.id}] concluído`);
}
