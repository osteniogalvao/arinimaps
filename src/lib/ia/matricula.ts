/**
 * Leitura de matrícula com IA: o formato da resposta, a validação do JSON que
 * a Ari devolve (POST /api/ia/matricula) e o resumo em .doc para baixar.
 * Sem "server-only": a página usa os tipos e o gerador do .doc.
 */

export type AtoMatricula = {
  numero: string; data: string | null; tipo: "registro" | "averbacao";
  natureza: string; resumo: string; cancelado_por: string | null;
};

export type OnusVigente = { tipo: string; ato: string; favorecido: string | null; valor: string | null; resumo: string };

export type LeituraMatricula = {
  matricula: string | null;
  cartorio: string | null;
  data_certidao: string | null;
  imovel: {
    denominacao: string | null; tipo: "rural" | "urbano" | null; municipio: string | null; uf: string | null;
    area: string | null; ccir: string | null; car: string | null; itr_nirf: string | null;
    georreferenciado: boolean | null; codigo_sigef: string | null; descricao_resumida: string;
  };
  proprietarios_atuais: { nome: string; documento: string | null; fracao: string | null; ato: string | null }[];
  atos: AtoMatricula[];
  onus_vigentes: OnusVigente[];
  alertas: string[];
  confianca: "alta" | "media" | "baixa";
  observacao_leitura: string;
};

const str = (v: unknown, max = 300) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const lista = (v: unknown): Record<string, unknown>[] =>
  Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === "object") : [];

/** JSON da IA → leitura validada (campos fora do formato viram null; nada de texto livre além dos limites). */
export function lerLeituraMatricula(texto: string): LeituraMatricula | null {
  const m = texto.match(/\{[\s\S]*\}/);
  if (!m) return null;
  let o: Record<string, unknown>;
  try { o = JSON.parse(m[0]); } catch { return null; }
  const im = (o.imovel && typeof o.imovel === "object" ? o.imovel : {}) as Record<string, unknown>;
  const atos = lista(o.atos).slice(0, 300).map((a): AtoMatricula => ({
    numero: str(a.numero, 20) ?? "?",
    data: str(a.data, 20),
    tipo: a.tipo === "averbacao" ? "averbacao" : "registro",
    natureza: str(a.natureza, 80) ?? "",
    resumo: str(a.resumo, 400) ?? "",
    cancelado_por: str(a.cancelado_por, 20),
  }));
  const leitura: LeituraMatricula = {
    matricula: str(o.matricula, 40),
    cartorio: str(o.cartorio, 160),
    data_certidao: str(o.data_certidao, 30),
    imovel: {
      denominacao: str(im.denominacao, 160),
      tipo: im.tipo === "rural" || im.tipo === "urbano" ? im.tipo : null,
      municipio: str(im.municipio, 80), uf: str(im.uf, 2),
      area: str(im.area, 80), ccir: str(im.ccir, 40), car: str(im.car, 80), itr_nirf: str(im.itr_nirf, 40),
      georreferenciado: typeof im.georreferenciado === "boolean" ? im.georreferenciado : null,
      codigo_sigef: str(im.codigo_sigef, 60),
      descricao_resumida: str(im.descricao_resumida, 600) ?? "",
    },
    proprietarios_atuais: lista(o.proprietarios_atuais).slice(0, 50).map((p) => ({
      nome: str(p.nome, 160) ?? "?", documento: str(p.documento, 30), fracao: str(p.fracao, 40), ato: str(p.ato, 20),
    })),
    atos,
    onus_vigentes: lista(o.onus_vigentes).slice(0, 50).map((x) => ({
      tipo: str(x.tipo, 80) ?? "ônus", ato: str(x.ato, 20) ?? "?", favorecido: str(x.favorecido, 160),
      valor: str(x.valor, 60), resumo: str(x.resumo, 400) ?? "",
    })),
    alertas: (Array.isArray(o.alertas) ? o.alertas : []).map((x) => str(x, 240)).filter((x): x is string => !!x).slice(0, 12),
    confianca: o.confianca === "alta" || o.confianca === "media" ? o.confianca : "baixa",
    observacao_leitura: str(o.observacao_leitura, 400) ?? "",
  };
  // sem número, sem atos e sem proprietário: não era uma matrícula
  if (!leitura.matricula && !atos.length && !leitura.proprietarios_atuais.length) return null;
  return leitura;
}

const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Resumo em .doc (HTML para Word), como o memorial descritivo. */
export function resumoMatriculaDoc(l: LeituraMatricula, nomeArquivo: string): string {
  const linha = (r: string, v: string | null | undefined) => (v ? `<tr><td style="width:30%;font-weight:bold">${esc(r)}</td><td>${esc(v)}</td></tr>` : "");
  const im = l.imovel;
  return `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8"><title>Resumo da matrícula ${esc(l.matricula ?? "")}</title>
<style>
@page { size: 21cm 29.7cm; margin: 2cm; }
body { font-family: Arial, sans-serif; font-size: 10.5pt; line-height: 1.4; }
h1 { font-size: 15pt; margin: 0 0 4pt; } h2 { font-size: 12pt; margin: 14pt 0 6pt; }
table { border-collapse: collapse; width: 100%; } td, th { padding: 3pt 5pt; vertical-align: top; }
.grade td, .grade th { border: 1px solid #aaa; font-size: 9.5pt; } .grade th { background: #E8EFE9; text-align: left; }
.alerta { color: #8a2b0f; } .nota { font-size: 9pt; color: #555; } .cancelado { color: #888; text-decoration: line-through; }
</style></head><body>
<h1>Resumo da matrícula ${esc(l.matricula ?? "")}</h1>
<p class="nota">Arquivo lido: ${esc(nomeArquivo)} · leitura com confiança ${esc(l.confianca)}${l.observacao_leitura ? ` · ${esc(l.observacao_leitura)}` : ""}</p>
<table>
${linha("Cartório", l.cartorio)}${linha("Data da certidão", l.data_certidao)}
${linha("Imóvel", im.denominacao)}${linha("Município / UF", [im.municipio, im.uf].filter(Boolean).join(" / ") || null)}
${linha("Área", im.area)}${linha("CCIR", im.ccir)}${linha("CAR", im.car)}${linha("ITR / NIRF", im.itr_nirf)}
${linha("Georreferenciado", im.georreferenciado == null ? null : im.georreferenciado ? `Sim${im.codigo_sigef ? ` (SIGEF ${im.codigo_sigef})` : ""}` : "Não consta")}
${linha("Descrição", im.descricao_resumida)}
</table>
<h2>Proprietários atuais</h2>
${l.proprietarios_atuais.length ? `<table class="grade"><tr><th>Nome</th><th>Documento</th><th>Fração</th><th>Ato</th></tr>${l.proprietarios_atuais.map((p) =>
    `<tr><td>${esc(p.nome)}</td><td>${esc(p.documento ?? "")}</td><td>${esc(p.fracao ?? "")}</td><td>${esc(p.ato ?? "")}</td></tr>`).join("")}</table>` : "<p>Não identificados.</p>"}
<h2>Ônus vigentes</h2>
${l.onus_vigentes.length ? `<table class="grade"><tr><th>Tipo</th><th>Ato</th><th>Favorecido</th><th>Valor</th><th>Resumo</th></tr>${l.onus_vigentes.map((o) =>
    `<tr><td>${esc(o.tipo)}</td><td>${esc(o.ato)}</td><td>${esc(o.favorecido ?? "")}</td><td>${esc(o.valor ?? "")}</td><td>${esc(o.resumo)}</td></tr>`).join("")}</table>` : "<p>Nenhum ônus vigente identificado.</p>"}
${l.alertas.length ? `<h2>Pontos de atenção</h2><ul>${l.alertas.map((a) => `<li class="alerta">${esc(a)}</li>`).join("")}</ul>` : ""}
<h2>Atos da matrícula</h2>
<table class="grade"><tr><th>Ato</th><th>Data</th><th>Natureza</th><th>Resumo</th></tr>
${l.atos.map((a) => `<tr${a.cancelado_por ? ' class="cancelado"' : ""}><td>${esc(a.numero)}</td><td>${esc(a.data ?? "")}</td><td>${esc(a.natureza)}</td><td>${esc(a.resumo)}${a.cancelado_por ? ` (cancelado por ${esc(a.cancelado_por)})` : ""}</td></tr>`).join("")}
</table>
<p class="nota" style="margin-top:18pt">Resumo gerado por inteligência artificial pela Arini Maps. Pode conter erros de leitura, principalmente em certidões manuscritas ou digitalizadas com baixa qualidade. Não substitui a certidão nem a análise de advogado ou corretor.</p>
</body></html>`;
}
