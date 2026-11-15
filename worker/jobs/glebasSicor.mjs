import { createHash } from "node:crypto";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { createGunzip } from "node:zlib";

/** Lê a edição completa. Só guarda na memória as feições da região. */
export async function lerGlebasSicor(arquivo, ano, bbox) {
  let lidas = 0;
  const glebas = [];
  function processar(linha) {
    if (!linha.trim()) return;
    if (lidas++ === 0) {
      if (linha.trim() !== "#REF_BACEN;NU_ORDEM;NU_INDICE;GT_GEOMETRIA") throw new Error("Cabeçalho do BCB desconhecido.");
      return;
    }
    const [ref, ordem, indice, bruta] = linha.split(";");
    const wkt = bruta?.trim();
    if (!wkt?.startsWith("POLYGON") && !wkt?.startsWith("MULTIPOLYGON")) return;
    let oeste = Infinity, sul = Infinity, leste = -Infinity, norte = -Infinity;
    for (const par of wkt.matchAll(/(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/g)) {
      const x = Number(par[1]), y = Number(par[2]);
      oeste = Math.min(oeste, x); leste = Math.max(leste, x);
      sul = Math.min(sul, y); norte = Math.max(norte, y);
    }
    if (leste < bbox[0] || norte < bbox[1] || oeste > bbox[2] || sul > bbox[3]) return;
    const id = createHash("sha256").update([ano, ref, ordem, indice].join("/")).digest("hex");
    glebas.push({ id, wkt });
  }
  await pipeline(arquivo, createGunzip(), async pedacos => {
    let restante = "";
    for await (const pedaco of pedacos) {
      const linhas = (restante + pedaco.toString("latin1")).split("\n");
      restante = linhas.pop();
      for (const linha of linhas) processar(linha);
    }
    processar(restante);
  });
  if (!glebas.length) throw new Error("O arquivo não contém glebas para a região configurada.");
  return { carga: { ano, bbox, glebas }, lidas: lidas - 1 };
}

export async function atualizarGlebasSicor(_payload, db) {
  const { rows: [edicao] } = await db.query("select bbox from sicor_cargas order by ano desc limit 1");
  if (!edicao) throw new Error("A importação inicial define a cobertura da região.");
  const ano = new Date().getUTCFullYear();
  const origem = `https://www.bcb.gov.br/htms/sicor/DadosBrutos/SICOR_GLEBAS_WKT_${ano}.gz`;
  const resposta = await fetch(origem, { signal: AbortSignal.timeout(8 * 60_000) });
  if (!resposta.ok || !resposta.body) throw new Error(`SICOR ${ano}: HTTP ${resposta.status}`);
  const { carga } = await lerGlebasSicor(Readable.fromWeb(resposta.body), ano, edicao.bbox);
  await db.query("select fn_importar_glebas_sicor($1::jsonb)", [JSON.stringify(carga)]);
}

export async function agendarGlebasSicor(db) {
  // Um job por edição pendente. Um arquivo ainda não publicado pelo BCB volta
  // à fila, enquanto o mapa continua servindo a última carga completa.
  const con = await db.connect();
  try {
    await con.query("begin");
    await con.query("select pg_advisory_xact_lock(hashtext('arini:sicor:agenda'))");
    await con.query(`insert into jobs(tipo,payload)
    select 'atualizar_glebas_sicor','{}'::jsonb
    where exists(select from sicor_cargas)
      and not exists(select from sicor_cargas where ano=extract(year from now() at time zone 'UTC')
        and importado_em >= now()-interval '30 days')
      and not exists(select from jobs where tipo='atualizar_glebas_sicor'
        and (status in ('pendente','processando') or created_at > now()-interval '1 day'))
    `);
    await con.query("commit");
  } catch (erro) {
    await con.query("rollback");
    throw erro;
  } finally {
    con.release();
  }
}
