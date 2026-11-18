// Converte a distribuição pública SICOR_GLEBAS_WKT_AAAA.gz do BCB para
// fn_importar_glebas_sicor. A referência da operação não sai no arquivo.
// Com SICOR_OPERACAO_BASICA_ESTADO_AAAA.gz, Empreendimento.csv e Programa.csv
// (variáveis SICOR_OPERACOES, SICOR_EMPREENDIMENTO, SICOR_PROGRAMA), cada gleba
// leva o valor, a finalidade e o produto da operação (migration 0150).
import { createReadStream } from "node:fs";
import { writeFile, rename, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { lerGlebasSicor, lerDominiosSicor, juntarOperacoesSicor } from "../worker/jobs/glebasSicor.mjs";
import { basename } from "node:path";

const [origem, destino, ...coordenadas] = process.argv.slice(2);
const ano = Number(/^SICOR_GLEBAS_WKT_(\d{4})\.gz$/i.exec(basename(origem ?? ""))?.[1]);
const bbox = coordenadas.map(Number);
if (!destino || !ano || bbox.length !== 4 || !bbox.every(Number.isFinite) ||
    bbox[0] >= bbox[2] || bbox[1] >= bbox[3]) {
  throw new Error("Uso: node preparar-glebas-sicor.mjs SICOR_GLEBAS_WKT_AAAA.gz destino.json oeste sul leste norte");
}

const { carga, lidas } = await lerGlebasSicor(createReadStream(origem), ano, bbox);
const { SICOR_OPERACOES: ops, SICOR_EMPREENDIMENTO: emp, SICOR_PROGRAMA: prog } = process.env;
if (ops) {
  const dominios = emp && prog ? await lerDominiosSicor(createReadStream(emp), createReadStream(prog)) : null;
  console.log(await juntarOperacoesSicor(carga.glebas, createReadStream(ops), dominios), "glebas com a operação.");
}
for (const g of carga.glebas) delete g.chave;
const temporario = destino + "." + randomUUID();
try {
  await writeFile(temporario, JSON.stringify(carga), { flag: "wx" });
  await rename(temporario, destino);
  console.log(ano, lidas, "linhas da fonte;", carga.glebas.length, "glebas no envelope.");
} finally {
  await rm(temporario, { force: true });
}
