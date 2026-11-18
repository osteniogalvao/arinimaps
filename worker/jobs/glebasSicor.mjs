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
    // a referência só serve para achar a operação (valor, finalidade); não vai para o banco
    glebas.push({ id, wkt, chave: `${ref}/${ordem}` });
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

/** Linhas de um .gz ou .csv do BCB, em latin1. */
async function linhasBcb(arquivo, gz, processar) {
  const ler = async pedacos => {
    let restante = "";
    for await (const pedaco of pedacos) {
      const linhas = (restante + pedaco.toString("latin1")).split("\n");
      restante = linhas.pop();
      for (const linha of linhas) processar(linha.replace(/\r$/, ""));
    }
    processar(restante);
  };
  if (gz) await pipeline(arquivo, createGunzip(), ler);
  else await ler(arquivo);
}

const semAspas = v => (v ?? "").replace(/^"|"$/g, "").trim();
const numero = v => { const x = Number(String(v ?? "").replace(",", ".")); return v && Number.isFinite(x) ? x : null; };
const dataIso = v => { const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(v ?? ""); return m ? `${m[3]}-${m[2]}-${m[1]}` : null; };
const titulo = v => { const s = semAspas(v); return s && !/^n[ãa]o se aplica$/i.test(s) ? s.charAt(0) + s.slice(1).toLowerCase() : null; };

/** Tabelas de domínio do SICOR: empreendimento (finalidade, atividade, produto) e programa. */
export async function lerDominiosSicor(empreendimento, programa) {
  const emp = new Map(), prog = new Map();
  await linhasBcb(empreendimento, false, l => {
    if (!l || l.startsWith("#")) return;
    const c = l.split(";");
    emp.set(semAspas(c[0]), { finalidade: semAspas(c[3]) || null, atividade: semAspas(c[4]) || null, modalidade: titulo(c[5]), produto: titulo(c[6]) });
  });
  await linhasBcb(programa, false, l => {
    if (!l || l.startsWith("#")) return;
    const c = l.split(";");
    // "PRONAF - PROGRAMA NACIONAL DE ..." → "PRONAF"; programa sem sigla fica por extenso
    const nome = semAspas(c[1]);
    prog.set(semAspas(c[0]), (nome.includes(" - ") ? nome.split(" - ")[0].trim() : titulo(nome)) || null);
  });
  return { emp, prog };
}

/**
 * Junta a cada gleba os campos públicos da operação (SICOR_OPERACAO_BASICA_ESTADO):
 * valor, datas, juros, área financiada e o empreendimento por extenso.
 * Vídeo do Carlos de 17/11/2026: "clicar na gleba e ver o valor do crédito rural".
 */
export async function juntarOperacoesSicor(glebas, operacoes, dominios) {
  const procuradas = new Set(glebas.map(g => g.chave));
  const achadas = new Map();
  let cab = null;
  await linhasBcb(operacoes, true, l => {
    if (!l.trim()) return;
    if (!cab) {
      cab = Object.fromEntries(l.replace(/^#/, "").split(";").map((n, i) => [n.trim(), i]));
      for (const k of ["REF_BACEN", "NU_ORDEM", "VL_PARC_CREDITO"]) if (!(k in cab)) throw new Error("Cabeçalho de operações do BCB desconhecido.");
      return;
    }
    const c = l.split(";");
    const chave = `${c[cab.REF_BACEN]}/${c[cab.NU_ORDEM]}`;
    if (!procuradas.has(chave)) return;
    const e = dominios?.emp.get(c[cab.CD_EMPREENDIMENTO]) ?? {};
    const op = {
      valor: numero(c[cab.VL_PARC_CREDITO]),
      emissao: dataIso(c[cab.DT_EMISSAO]),
      vencimento: dataIso(c[cab.DT_VENCIMENTO]),
      juros_aa: numero(c[cab.VL_JUROS]),
      area_financiada_ha: numero(c[cab.VL_AREA_FINANC]),
      finalidade: e.finalidade ?? null,
      atividade: e.atividade ?? null,
      modalidade: e.modalidade ?? null,
      produto: e.produto ?? null,
      programa: dominios?.prog.get(c[cab.CD_PROGRAMA]) ?? null,
    };
    achadas.set(chave, Object.fromEntries(Object.entries(op).filter(([, v]) => v != null)));
  });
  let juntadas = 0;
  for (const g of glebas) {
    const op = achadas.get(g.chave);
    if (op) { g.operacao = op; juntadas++; }
    delete g.chave;
  }
  return juntadas;
}

const BCB = "https://www.bcb.gov.br/htms/sicor";
async function baixar(url, minutos = 8) {
  const r = await fetch(url, { signal: AbortSignal.timeout(minutos * 60_000) });
  if (!r.ok || !r.body) throw new Error(`${url.split("/").pop()}: HTTP ${r.status}`);
  return Readable.fromWeb(r.body);
}

/** Operações e domínios do BCB para as glebas lidas. Falhou: as glebas entram sem valor. */
export async function operacoesDoBcb(glebas, ano) {
  try {
    const dominios = await lerDominiosSicor(await baixar(`${BCB}/Empreendimento.csv`, 2), await baixar(`${BCB}/Programa.csv`, 2));
    return await juntarOperacoesSicor(glebas, await baixar(`${BCB}/DadosBrutos/SICOR_OPERACAO_BASICA_ESTADO_${ano}.gz`), dominios);
  } catch (erro) {
    console.error("SICOR: operações indisponíveis, glebas sem valor:", erro instanceof Error ? erro.message : erro);
    for (const g of glebas) delete g.chave;
    return 0;
  }
}

export async function atualizarGlebasSicor(_payload, db) {
  const { rows: [edicao] } = await db.query("select bbox from sicor_cargas order by ano desc limit 1");
  if (!edicao) throw new Error("A importação inicial define a cobertura da região.");
  const ano = new Date().getUTCFullYear();
  const origem = `https://www.bcb.gov.br/htms/sicor/DadosBrutos/SICOR_GLEBAS_WKT_${ano}.gz`;
  const resposta = await fetch(origem, { signal: AbortSignal.timeout(8 * 60_000) });
  if (!resposta.ok || !resposta.body) throw new Error(`SICOR ${ano}: HTTP ${resposta.status}`);
  const { carga } = await lerGlebasSicor(Readable.fromWeb(resposta.body), ano, edicao.bbox);
  await operacoesDoBcb(carga.glebas, ano);
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
