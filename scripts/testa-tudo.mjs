// Rotina de testes antes de cada publicação (roadmap 9.7).
// Uso: npm run testa                      (precisa do `npm run dev` ou do site no ar em BASE_URL)
//      BASE_URL=https://homolog.x npm run testa
//
// 1. auditoria estática das rotas (não precisa de servidor);
// 2. testes de ponta a ponta com navegador real (criam e apagam o que usam).
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

for (const l of readFileSync(".env.local", "utf8").split("\n")) {
  const m = l.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}
const BASE = process.env.BASE_URL ?? "http://localhost:3000";

/**
 * Os testes logam muitas vezes com as contas do seed e enviam formulários
 * públicos; os limites contra abuso (8 logins por e-mail em 15 min, envios
 * por IP) travariam o teste seguinte. Entre uma etapa e outra zera só os
 * contadores das contas de teste e dos IPs de teste (10.250/10.251.x.x) —
 * nunca os de um usuário real — e só contra servidor local.
 */
const local = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE);
const admin = process.env.SUPABASE_SERVICE_ROLE_KEY
  ? createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
  : null;
async function zerarLimitesDeTeste() {
  if (!local || !admin) return;
  await admin.from("rate_limits").delete().or([
    "chave.like.%admin@arinibrasil.com.br%", "chave.like.%teste%@arinibrasil.com.br%",
    "chave.like.%:10.250.%", "chave.like.%:10.251.%",
  ].join(","));
}
const PASSOS = [
  ["Auditoria das rotas da API", "scripts/audita-rotas.mjs", false],
  ["Fontes oficiais ao vivo", "scripts/testa-apis-rurais.mjs", false],
  ["Fumaça: todas as telas abrem com o perfil certo", "scripts/fumaca.mjs", true],
  ["Matriz por setores, tarefas, suporte, LGPD, segundo fator", "scripts/testa-matriz.mjs", true],
  ["Configurações refletem no site público", "scripts/testa-configuracoes.mjs", true],
  ["Lotes urbanos: clique, cartão e anúncio pelo lote", "scripts/testa-lotes.mjs", true],
  ["Planos, solicitações cartográficas, revisões", "scripts/testa-planos.mjs", true],
  ["Mapa com tiles vetoriais", "scripts/testa-tiles.mjs", true],
  ["Conta, organização, suporte, demandas", "scripts/testa-conta-suporte.mjs", true],
  ["Perfis, leilão, selfie, vídeo", "scripts/testa-perfis.mjs", true],
  ["Segurança: força bruta, permissões, IDOR, upload, RLS", "scripts/testa-seguranca.mjs", true],
  ["Calibração por parte da planta (move e devolve)", "scripts/testa-calibracao-parte.mjs", true],
  ["Ferramentas do mapa (medir distância e área)", "scripts/testa-ferramentas-mapa.mjs", true],
  ["Matrícula do anúncio (conferência, selo, RLS, ONR)", "scripts/testa-matricula.mjs", true],
  ["Importação manual do CAR (zip do SICAR, histórico, cobertura)", "scripts/testa-car-importacao.mjs", true],
  ["IBGE: biomas no relatório e no mapa, indicadores do município", "scripts/testa-ibge.mjs", true],
  ["Sentinel-2 pelo Copernicus: cenas por data e nuvem, tiles, NDVI", "scripts/testa-sentinel.mjs", true],
];

const somente = process.argv[2];
const resultados = [];
for (const [nome, arquivo, precisaServidor] of PASSOS) {
  if (somente && !arquivo.includes(somente)) continue;
  if (precisaServidor) {
    const ok = await fetch(`${BASE}/acesso`, { signal: AbortSignal.timeout(15000) }).then((r) => r.ok).catch(() => false);
    if (!ok) { resultados.push([nome, "FALHOU (servidor indisponível em " + BASE + ")"]); continue; }
  }
  console.log(`\n━━ ${nome} (${arquivo})`);
  await zerarLimitesDeTeste();
  const t = Date.now();
  const r = spawnSync(process.execPath, [arquivo], { stdio: "inherit", env: { ...process.env, BASE_URL: BASE } });
  resultados.push([nome, r.status === 0 ? `ok em ${Math.round((Date.now() - t) / 1000)} s` : `FALHOU (código ${r.status})`]);
}

console.log("\n━━ Resumo");
for (const [nome, r] of resultados) console.log(`${r.startsWith("ok") ? "✓" : r.startsWith("pulado") ? "–" : "✗"} ${nome}: ${r}`);
if (!resultados.length) console.error("Nenhuma etapa corresponde ao filtro informado.");
process.exit(!resultados.length || resultados.some(([, r]) => r.startsWith("FALHOU")) ? 1 : 0);
