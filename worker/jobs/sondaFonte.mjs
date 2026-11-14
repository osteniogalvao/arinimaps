// Teste de queda e lentidão de UMA fonte oficial (PENDENCIAS 3.16).
//
// Sem dependências: o mesmo arquivo roda no worker (job verificar_fontes), no
// script scripts/verifica-fontes.mjs e na rota POST /api/admin/fontes/verificar.
// A requisição é a `sonda_url` gravada em fontes_externas — um envelope de
// ~2 km em Iturama, pedindo só a CONTAGEM (hits / returnCountOnly), para medir
// o serviço sem pesar nele.

import { buscarFonte } from "./tlsOrgaos.mjs";

const UA = "AriniImoveisBrasil/1.0 (contato@arinibrasil.com.br)";
/** acima disso a fonte conta como fora: o relatório não espera mais que 40 s */
export const LIMITE_MS = 30_000;

/**
 * Serviço geográfico costuma responder 200 com a falha no corpo (WFS devolve
 * ExceptionReport; ArcGIS devolve {"error": …}). Por isso o status sozinho
 * não basta.
 *
 * @param {{ id: string, sonda_url: string | null }} fonte
 * @returns {Promise<{ fonte_id: string, ok: boolean, status_http: number | null, ms: number, erro: string | null }>}
 */
export async function sondarFonte(fonte) {
  const t0 = Date.now();
  if (!fonte.sonda_url) {
    return { fonte_id: fonte.id, ok: false, status_http: null, ms: 0, erro: "fonte sem sonda cadastrada" };
  }
  try {
    const r = await buscarFonte(fonte.sonda_url, {
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(LIMITE_MS),
    });
    const corpo = (await r.text()).slice(0, 4000);
    const ms = Date.now() - t0;
    if (!r.ok) return { fonte_id: fonte.id, ok: false, status_http: r.status, ms, erro: `HTTP ${r.status}` };
    const falhaNoCorpo =
      /ExceptionReport|ServiceException/i.test(corpo) ? "o serviço devolveu exceção" :
      /"error"\s*:/.test(corpo) ? (corpo.match(/"message"\s*:\s*"([^"]{0,120})/)?.[1] ?? "o serviço devolveu erro") :
      /^\s*<(!doctype|html)/i.test(corpo) ? "o serviço devolveu uma página HTML" : null;
    return { fonte_id: fonte.id, ok: !falhaNoCorpo, status_http: r.status, ms, erro: falhaNoCorpo };
  } catch (e) {
    const ms = Date.now() - t0;
    const erro = e?.name === "TimeoutError" ? `sem resposta em ${LIMITE_MS / 1000} s`
      : (e?.cause?.code ?? e?.message ?? "falha desconhecida");
    return { fonte_id: fonte.id, ok: false, status_http: null, ms, erro: String(erro) };
  }
}

/** Sonda várias fontes em paralelo (são servidores diferentes, um não atrasa o outro). */
export function sondarFontes(fontes) {
  return Promise.all(fontes.map(sondarFonte));
}
