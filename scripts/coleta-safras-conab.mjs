// Coleta das safras da CONAB fora do worker. --seco só lê e mostra um resumo.
// Uso: node scripts/coleta-safras-conab.mjs [--seco]   (DATABASE_URL para gravar)
import pg from "pg";
import { gravarSafras, lerSafrasConab } from "../worker/jobs/conabSafras.mjs";

const seco = process.argv.includes("--seco");
const { linhas, erros } = await lerSafrasConab();
const safras = [...new Set(linhas.map((l) => l.safra))].sort();
console.log(`${linhas.length} linhas · safras ${safras[0]} a ${safras.at(-1)} · produtos: ${[...new Set(linhas.map((l) => l.produto))].slice(0, 15).join(", ")}`);
console.log(linhas.filter((l) => l.safra === safras.at(-1) && /SOJA/.test(l.produto)).slice(0, 5));
if (erros.length) console.log("erros:", erros);
if (!seco && linhas.length) {
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  await gravarSafras(db, linhas);
  await db.end();
  console.log("gravado");
}
