// Safras de grãos da CONAB por UF (migration 0146).
//
// Lê os arquivos do Portal de Informações Agropecuárias da CONAB: a série
// histórica (safras encerradas) e os levantamentos da safra corrente. O leitor
// encontra as colunas pelo nome do cabeçalho; se a CONAB mudar o layout, o job
// falha com a lista de colunas encontradas e os dados anteriores continuam.
//
// Teste sem gravar: node scripts/coleta-safras-conab.mjs --seco
const UA = "AriniImoveisBrasil/1.0 (+https://arinibrasil.com.br; safras)";
const BASE = process.env.CONAB_ARQUIVOS ?? "https://portaldeinformacoes.conab.gov.br/downloads/arquivos";
export const ARQUIVOS = [
  { nome: "SerieHistoricaGraos.txt", tipo: "serie" },
  { nome: "LevantamentoGraos.txt", tipo: "levantamento" },
];

const norm = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();

/** "1.234,5" · "1234.5" · "1234,5" → número; vazio ou "-" → null */
export function numero(t) {
  const s = String(t ?? "").trim().replace(/\s/g, "");
  if (!s || s === "-") return null;
  const n = Number(s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s);
  return Number.isFinite(n) ? n : null;
}

function coluna(cab, padroes, evitar) {
  for (const p of padroes) {
    const i = cab.findIndex((c) => p.test(c) && !(evitar && evitar.test(c)));
    if (i >= 0) return i;
  }
  return -1;
}

/** "2025/26" a partir de "2025/26", "2025/2026" ou "2025" */
export function safraDe(t) {
  const m = /(\d{4})\s*\/\s*(\d{2,4})/.exec(String(t ?? ""));
  if (m) return `${m[1]}/${m[2].slice(-2)}`;
  const a = /^\d{4}$/.exec(String(t ?? "").trim());
  return a ? `${a[0]}/${String(Number(a[0]) + 1).slice(-2)}` : null;
}

/** Lê o texto do arquivo. Devolve as linhas por safra, produto e UF. */
export function lerArquivo(texto, tipo) {
  const linhas = texto.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  if (linhas.length < 2) throw Error("arquivo vazio");
  const sep = [";", "\t", "|", ","].find((s) => linhas[0].split(s).length >= 5) ?? ";";
  const cab = linhas[0].split(sep).map((c) => norm(c).replace(/^"|"$/g, ""));
  const i = {
    safra: coluna(cab, [/^ano_agricola$/, /^ano.?agricola/, /^safra$/, /^ano$/]),
    previsao: coluna(cab, [/dsc_safra/, /safra_previsao/, /^tipo_safra/]),
    levId: coluna(cab, [/^id_levantamento$/, /^num.*levantamento/, /^levantamento$/]),
    levDsc: coluna(cab, [/^dsc_levantamento$/, /descricao_levantamento/]),
    uf: coluna(cab, [/^uf$/, /sigla_uf/, /^estado$/]),
    produto: coluna(cab, [/^produto$/, /^dsc_produto$/, /^nome_produto$/, /^cultura$/], /^id_/),
    area: coluna(cab, [/^area_plantada/, /^area/]),
    producao: coluna(cab, [/^producao/]),
  };
  const faltam = ["safra", "uf", "produto", "area", "producao"].filter((k) => i[k] < 0);
  if (faltam.length) throw Error(`layout da CONAB mudou: faltam ${faltam.join(", ")}; colunas: ${cab.join(", ")}`);
  const porChave = new Map();
  for (const l of linhas.slice(1)) {
    const v = l.split(sep).map((c) => c.trim().replace(/^"|"$/g, ""));
    const safra = safraDe(v[i.safra]);
    const uf = String(v[i.uf] ?? "").trim().toUpperCase();
    if (!safra || !/^[A-Z]{2}$/.test(uf)) continue;
    let produto = String(v[i.produto] ?? "").trim().toUpperCase().replace(/\s+/g, " ");
    const previsao = i.previsao >= 0 ? String(v[i.previsao] ?? "").trim() : "";
    if (previsao && !/unica|total|^-$/i.test(norm(previsao)) && !norm(produto).includes(norm(previsao))) produto = `${produto} ${previsao.toUpperCase()}${/^\d+\s*[ªa]?$/i.test(previsao) ? " SAFRA" : ""}`;
    if (!produto) continue;
    const ordem = i.levId >= 0 ? numero(v[i.levId]) ?? 0 : 0;
    const levantamento = tipo === "serie" ? "série histórica"
      : i.levDsc >= 0 && v[i.levDsc] ? String(v[i.levDsc]).trim() : ordem ? `${ordem}º levantamento` : "levantamento";
    const chave = `${safra}|${produto}|${uf}`;
    const atual = porChave.get(chave);
    if (atual && atual.ordem > ordem) continue; // fica o levantamento mais novo
    porChave.set(chave, { safra, produto, uf, levantamento, ordem, area_mil_ha: numero(v[i.area]), producao_mil_t: numero(v[i.producao]) });
  }
  if (!porChave.size) throw Error("nenhuma linha válida");
  return [...porChave.values()];
}

async function baixar(nome) {
  const r = await fetch(`${BASE}/${nome}`, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(90_000) });
  if (!r.ok) throw Error(`${nome}: HTTP ${r.status}`);
  const bytes = new Uint8Array(await r.arrayBuffer());
  // a CONAB publica em UTF-8 ou Latin-1
  const utf = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  return utf.includes("�") ? new TextDecoder("latin1").decode(bytes) : utf;
}

/** Baixa e lê os dois arquivos. A safra do levantamento substitui a da série. */
export async function lerSafrasConab(log = console.log) {
  const todas = new Map(), erros = [];
  for (const a of ARQUIVOS) {
    try {
      const linhas = lerArquivo(await baixar(a.nome), a.tipo);
      for (const l of linhas) todas.set(`${l.safra}|${l.produto}|${l.uf}`, l);
      log(`[conab] ${a.nome}: ${linhas.length} linhas`);
    } catch (e) {
      erros.push(`${a.nome}: ${e.message}`);
      log(`[conab] ${a.nome} falhou: ${e.message}`);
    }
  }
  return { linhas: [...todas.values()], erros };
}

export async function gravarSafras(db, linhas) {
  for (let ini = 0; ini < linhas.length; ini += 500) {
    const lote = linhas.slice(ini, ini + 500);
    await db.query(`
      insert into conab_safras (safra, produto, uf, levantamento, area_mil_ha, producao_mil_t, atualizado_em)
      select x.safra, x.produto, x.uf, x.levantamento, x.area_mil_ha, x.producao_mil_t, now()
        from jsonb_to_recordset($1::jsonb) as x(safra text, produto text, uf text, levantamento text, area_mil_ha numeric, producao_mil_t numeric)
      on conflict (safra, produto, uf) do update set levantamento = excluded.levantamento,
        area_mil_ha = excluded.area_mil_ha, producao_mil_t = excluded.producao_mil_t, atualizado_em = now()`,
      [JSON.stringify(lote)]);
  }
}

/** Job `coletar_safras_conab`. */
export async function coletarSafrasConab(_payload, db) {
  const { linhas, erros } = await lerSafrasConab();
  if (linhas.length) await gravarSafras(db, linhas);
  if (!linhas.length) throw Error("CONAB indisponível: " + erros.join(" · "));
  return { linhas: linhas.length, erros };
}
