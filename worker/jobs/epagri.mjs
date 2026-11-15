import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";

const LEITOR = fileURLToPath(new URL("./epagri_xlsx.py", import.meta.url));
const DIRETORIO = "https://docweb.epagri.sc.gov.br/website_cepa/precos/";
const ARQUIVOS = {
  diario: "Historico_precos_diario.xlsx",
  semanal: "Historico_precos_semanal.xlsx",
  insumos: null,
};
const LIMITE = 20 * 1024 * 1024;

const PAGINA = "https://cepa.epagri.sc.gov.br/index.php/mercado-agricola/";
const CACHE = new Map();
const UA = "AriniImoveisBrasil/1.0 (+https://arinibrasil.com.br; cotacoes)";

async function lerCorpo(resposta, limite) {
  if (!resposta.ok) throw Error(`Epagri respondeu HTTP ${resposta.status}`);
  if (Number(resposta.headers.get("content-length")) > limite) throw Error("arquivo da Epagri excede o limite");
  let tamanho = 0;
  const partes = [];
  for await (const parte of resposta.body) {
    tamanho += parte.length;
    if (tamanho > limite) throw Error("arquivo da Epagri excede o limite");
    partes.push(parte);
  }
  return Buffer.concat(partes, tamanho);
}

async function resolverInsumos() {
  const resposta = await fetch(PAGINA, { headers: { "user-agent": UA }, redirect: "error", signal: AbortSignal.timeout(35_000) });
  const html = (await lerCorpo(resposta, 2 * 1024 * 1024)).toString("utf8");
  // O ano no nome muda quando a Epagri publica uma nova versão. Só aceitar o repositório oficial.
  const arquivos = new Set();
  for (const [, link] of html.matchAll(/href=["']([^"']+)["']/gi)) {
    if (!link.startsWith(DIRETORIO)) continue;
    const nome = link.slice(DIRETORIO.length);
    if (/^precos_pagos_sc_2007_2[0-9]{3}\.xlsx$/.test(nome)) arquivos.add(nome);
  }
  if (!arquivos.size) throw Error("Catálogo da Epagri sem fonte identificada para insumos");
  return [...arquivos].sort().at(-1);
}

async function baixarArquivo(nome, tipo) {
  const anterior = CACHE.get(tipo);
  const headers = { "user-agent": UA };
  if (anterior?.nome === nome) {
    if (anterior.etag) headers["if-none-match"] = anterior.etag;
    else if (anterior.modificado) headers["if-modified-since"] = anterior.modificado;
  }
  const resposta = await fetch(DIRETORIO + nome, { headers, redirect: "error", signal: AbortSignal.timeout(75_000) });
  if (resposta.status === 304 && anterior?.nome === nome) return anterior.buffer;
  const buffer = await lerCorpo(resposta, LIMITE);
  CACHE.set(tipo, { nome, buffer, etag: resposta.headers.get("etag"), modificado: resposta.headers.get("last-modified") });
  return buffer;
}

function lerArquivo(buffer, tipo, inicio, hoje) {
  return new Promise((resolve, reject) => {
    const python = process.platform === "win32" ? "python" : "python3";
    const filho = execFile(python, ["-B", LEITOR, tipo, inicio, hoje], {
      maxBuffer: 12 * 1024 * 1024, timeout: 75_000, windowsHide: true,
    }, (erro, saida, avisos) => {
      if (erro) return reject(new Error(avisos.trim().split("\n").at(-1) || erro.message));
      try { resolve(JSON.parse(saida)); }
      catch { reject(new Error("o leitor da Epagri não retornou dados válidos")); }
    });
    filho.stdin.on("error", reject);
    filho.stdin.end(buffer);
  });
}

// Processa uma planilha por vez para limitar o uso de memória no worker.
export async function coletarEpagri({ dias = 380, baixar = baixarArquivo, arquivoInsumos = resolverInsumos, agora = new Date() } = {}) {
  const hoje = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(agora);
  const resultado = [];
  for (const [tipo, nome] of Object.entries(ARQUIVOS)) {
    // A série de insumos é periódica e recebe revisões. A tabela informa o mês de referência.
    const janela = tipo === "insumos" ? Math.max(dias, 380) : dias;
    const inicio = new Date(Date.parse(hoje) - janela * 86_400_000).toISOString().slice(0, 10);
    try {
      const buffer = await baixar(nome ?? await arquivoInsumos(), tipo);
      resultado.push(...await lerArquivo(buffer, tipo, inicio, hoje));
    } catch (e) {
      resultado.push({ serie: null, chave: "epagri-" + tipo, pontos: [], erro: e.message });
    }
  }
  return resultado;
}
