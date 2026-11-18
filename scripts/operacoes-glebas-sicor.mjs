// Completa as glebas do SICOR já carregadas com valor, finalidade e produto da
// operação (migration 0150), sem reimportar a geometria. Gera um .sql com
// chamadas a fn_operacoes_glebas_sicor para rodar no SQL Editor do Supabase.
//
// node scripts/operacoes-glebas-sicor.mjs destino.sql oeste sul leste norte \
//   Empreendimento.csv Programa.csv SICOR_GLEBAS_WKT_2026.gz:SICOR_OPERACAO_BASICA_ESTADO_2026.gz [...]
import { createReadStream } from "node:fs";
import { writeFile } from "node:fs/promises";
import { basename } from "node:path";
import { lerGlebasSicor, lerDominiosSicor, juntarOperacoesSicor } from "../worker/jobs/glebasSicor.mjs";

const [destino, o, s, l, n, emp, prog, ...pares] = process.argv.slice(2);
const bbox = [o, s, l, n].map(Number);
if (!destino || !bbox.every(Number.isFinite) || !emp || !prog || !pares.length) {
  throw new Error("Uso: node operacoes-glebas-sicor.mjs destino.sql oeste sul leste norte Empreendimento.csv Programa.csv GLEBAS.gz:OPERACOES.gz ...");
}
const dominios = await lerDominiosSicor(createReadStream(emp), createReadStream(prog));
const lista = [];
for (const par of pares) {
  const [glebas, operacoes] = par.split(":");
  const ano = Number(/_(\d{4})\.gz$/i.exec(basename(glebas))?.[1]);
  const { carga } = await lerGlebasSicor(createReadStream(glebas), ano, bbox);
  const juntadas = await juntarOperacoesSicor(carga.glebas, createReadStream(operacoes), dominios);
  console.log(ano, carga.glebas.length, "glebas;", juntadas, "com a operação.");
  for (const g of carga.glebas) if (g.operacao) lista.push({ id: g.id, operacao: g.operacao });
}
const literal = (x) => "'" + JSON.stringify(x).replace(/'/g, "''") + "'";
const blocos = [];
for (let i = 0; i < lista.length; i += 500) blocos.push(`select public.fn_operacoes_glebas_sicor(${literal(lista.slice(i, i + 500))}::jsonb);`);
await writeFile(destino, `-- Valor e finalidade do crédito rural nas glebas (gerado em ${new Date().toISOString().slice(0, 10)}).\n-- Rodar DEPOIS da migration 0150. Gleba que não estiver no banco é ignorada.\n${blocos.join("\n")}\n`);
console.log(lista.length, "glebas no arquivo", destino);
