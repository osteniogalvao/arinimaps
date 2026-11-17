/**
 * CRM comercial (migration 0147): rótulos e regras puras, usados no servidor e
 * no navegador. Nada aqui acessa o banco.
 */

export const TEMPERATURAS = ["quente", "morno", "frio"] as const;
export type Temperatura = (typeof TEMPERATURAS)[number];
export const TEMPERATURA_LABEL: Record<Temperatura, string> = { quente: "Quente", morno: "Morno", frio: "Frio" };
/** tom da etiqueta de cada temperatura (componente Etiqueta) */
export const TEMPERATURA_TOM: Record<Temperatura, "critico" | "ouro" | "neutro"> = {
  quente: "critico", morno: "ouro", frio: "neutro",
};

/** Origens que a equipe escolhe ao cadastrar um lead na Central. */
export const ORIGENS_MANUAIS: { id: string; rotulo: string }[] = [
  { id: "telefone", rotulo: "Ligação" },
  { id: "whatsapp", rotulo: "WhatsApp" },
  { id: "presencial", rotulo: "Balcão / presencial" },
  { id: "indicacao", rotulo: "Indicação" },
  { id: "evento", rotulo: "Evento / feira" },
  { id: "portal", rotulo: "Portal imobiliário" },
  { id: "redes", rotulo: "Instagram / Facebook" },
  { id: "email", rotulo: "E-mail" },
  { id: "carteira", rotulo: "Carteira do corretor" },
];

/** Rótulo de qualquer origem (as do site e as da Central). */
export const ORIGEM_LABEL: Record<string, string> = {
  pagina: "Página do imóvel", mapa: "Mapa", ...Object.fromEntries(ORIGENS_MANUAIS.map((o) => [o.id, o.rotulo])),
};

/** Tipos de contato registrados na linha do tempo da oportunidade. */
export const INTERACOES: { id: string; rotulo: string }[] = [
  { id: "ligacao", rotulo: "Ligação" },
  { id: "whatsapp", rotulo: "WhatsApp" },
  { id: "email", rotulo: "E-mail" },
  { id: "reuniao", rotulo: "Reunião" },
  { id: "anotacao", rotulo: "Anotação" },
];
export const INTERACAO_IDS = INTERACOES.map((i) => i.id);

export const ETAPAS_ABERTAS_EXCLUI = "(fechado,pos_venda,perdido)";

/** Só dígitos; celular brasileiro sem DDI ganha 55 no link do WhatsApp. */
export function soDigitos(t: string | null | undefined) {
  return (t ?? "").replace(/\D/g, "");
}

export function linkWhatsApp(telefone: string | null | undefined, texto: string) {
  let d = soDigitos(telefone);
  if (!d) return null;
  if (d.length <= 11) d = "55" + d;
  return `https://wa.me/${d}?text=${encodeURIComponent(texto)}`;
}

export function linkEmail(email: string | null | undefined, assunto: string, texto: string) {
  if (!email) return null;
  return `mailto:${email}?subject=${encodeURIComponent(assunto)}&body=${encodeURIComponent(texto)}`;
}

/** Troca {{nome}}, {{imovel}}, {{codigo}}, {{corretor}} e {{oportunidade}} no modelo. */
export function preencherModelo(texto: string, v: Partial<Record<"nome" | "imovel" | "codigo" | "corretor" | "oportunidade", string | null>>) {
  return texto
    .replace(/\\n/g, "\n")
    .replace(/\{\{\s*(nome|imovel|codigo|corretor|oportunidade)\s*\}\}/g, (_, k: keyof typeof v) => {
      const valor = v[k];
      if (!valor) return "";
      return k === "nome" ? valor.split(/\s+/)[0] : valor;
    });
}

/**
 * Chave do cliente na carteira: telefone (só dígitos, últimos 11) ou e-mail.
 * Leads com o mesmo telefone ou e-mail são a mesma pessoa.
 */
export function chaveCliente(telefone: string | null | undefined, email: string | null | undefined) {
  const d = soDigitos(telefone);
  if (d.length >= 8) return "t" + d.slice(-11);
  const e = (email ?? "").trim().toLowerCase();
  return e ? "e" + e : null;
}

/** Etiquetas digitadas: minúsculas, sem repetição, até 12, cada uma com até 30 letras. */
export function limparEtiquetas(v: unknown): string[] {
  const lista = Array.isArray(v) ? v : typeof v === "string" ? v.split(",") : [];
  const saida: string[] = [];
  for (const x of lista) {
    if (typeof x !== "string") continue;
    const t = x.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 30);
    if (t && !saida.includes(t)) saida.push(t);
    if (saida.length >= 12) break;
  }
  return saida;
}

/** Primeiro dia do mês (AAAA-MM-01) de uma data, no fuso de Brasília. */
export function mesDe(d: Date = new Date()) {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit" }).format(d);
  return `${p}-01`;
}

/** Converte linhas de CSV (vírgula ou ponto e vírgula, com aspas) em matriz. */
export function lerCsv(texto: string): string[][] {
  const linhas: string[][] = [];
  const sep = (texto.split("\n")[0].match(/;/g)?.length ?? 0) > (texto.split("\n")[0].match(/,/g)?.length ?? 0) ? ";" : ",";
  let campo = "", linha: string[] = [], aspas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (aspas) {
      if (c === '"' && texto[i + 1] === '"') { campo += '"'; i++; }
      else if (c === '"') aspas = false;
      else campo += c;
    } else if (c === '"') aspas = true;
    else if (c === sep) { linha.push(campo.trim()); campo = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && texto[i + 1] === "\n") i++;
      linha.push(campo.trim()); campo = "";
      if (linha.some((x) => x)) linhas.push(linha);
      linha = [];
    } else campo += c;
  }
  linha.push(campo.trim());
  if (linha.some((x) => x)) linhas.push(linha);
  return linhas;
}

/** Célula de CSV com aspas quando precisa (e sem fórmula para o Excel). */
export function celulaCsv(v: unknown) {
  let s = v == null ? "" : String(v);
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  return /[";\n,]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
