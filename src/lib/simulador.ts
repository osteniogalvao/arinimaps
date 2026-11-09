/**
 * Simulador de propostas para incorporadoras e loteadoras (segunda etapa, item 20).
 *
 * Função PURA: nada de banco, data do relógio ou formatação de tela. Entra a
 * proposta, sai a diferença para a tabela, a entrada, o saldo e a tabela de
 * parcelas (Price ou SAC). Testada em scripts/testa-simulador.ts.
 *
 * Como o saldo é pago:
 *  - Balões (opcional): cada balão é uma parte do saldo (valor de face) paga de
 *    uma vez a cada `intervaloMeses`, contados da data-base. Ele carrega os
 *    juros/correção do período até vencer: pagamento = face × (1 + i)^meses.
 *  - O resto do saldo é amortizado nas parcelas regulares, pelo sistema
 *    escolhido, na periodicidade escolhida, a partir da primeira data.
 *  - Se a primeira parcela vence depois de um período inteiro da data-base
 *    (carência), os juros da carência são incorporados ao saldo antes de
 *    calcular as parcelas.
 *
 * Taxa: juros (% a.m. ou % a.a.) e correção por índice fixo informado (% a.a.,
 * ex.: IPCA estimado) se compõem: (1 + juros)(1 + correção) − 1. Tudo vira
 * taxa mensal equivalente e depois taxa do período da parcela.
 *
 * Datas em texto ISO "AAAA-MM-DD", sem fuso: o resultado é o mesmo no
 * servidor e no navegador.
 */

export type SistemaAmortizacao = "price" | "sac";
export type Periodicidade = "mensal" | "bimestral" | "trimestral" | "semestral" | "anual";

export const MESES_PERIODO: Record<Periodicidade, number> = {
  mensal: 1, bimestral: 2, trimestral: 3, semestral: 6, anual: 12,
};

export const PERIODICIDADE_LABEL: Record<Periodicidade, string> = {
  mensal: "Mensal", bimestral: "Bimestral", trimestral: "Trimestral", semestral: "Semestral", anual: "Anual",
};

export type EntradaSimulacao = {
  valorTabela: number;
  valorProposto: number;
  /** entrada em reais ou em % do valor proposto */
  entrada: { tipo: "valor" | "percentual"; valor: number };
  parcelas: number;
  periodicidade: Periodicidade;
  sistema: SistemaAmortizacao;
  /** juros remuneratórios; 0 = sem juros */
  juros: { taxa: number; base: "am" | "aa" };
  /** correção por índice informado, em % a.a. (ex.: IPCA estimado); 0 = sem correção */
  correcao?: { indice: string; taxaAnual: number };
  /** data da proposta / da entrada (AAAA-MM-DD) */
  dataBase: string;
  /** vencimento da primeira parcela regular (AAAA-MM-DD) */
  primeiraData: string;
  /** reforços (balões) opcionais */
  baloes?: { quantidade: number; valor: number; intervaloMeses: number };
};

export type LinhaParcela = {
  numero: number;
  tipo: "parcela" | "balao";
  data: string;
  valor: number;
  juros: number;
  amortizacao: number;
  /** principal que ainda falta pagar depois desta linha (parcelas + balões) */
  saldoDevedor: number;
};

export type ResultadoSimulacao = {
  diferenca: number;
  diferencaPercentual: number;
  entrada: number;
  entradaPercentual: number;
  saldo: number;
  taxaMensal: number;
  taxaPeriodo: number;
  /** principal financiado nas parcelas regulares (após balões e carência) */
  principalParcelas: number;
  totalBaloes: number;
  linhas: LinhaParcela[];
  primeiraParcela: number;
  ultimaParcela: number;
  totalJuros: number;
  /** entrada + parcelas + balões */
  totalPago: number;
  erros: string[];
};

const centavos = (v: number) => Math.round(v * 100) / 100;

/**
 * Lê número digitado no formato brasileiro ("350.000,50", "R$ 1.200", "3,5")
 * sem quebrar com o formato do JavaScript ("350000.5"): com vírgula, ponto é
 * milhar; sem vírgula, um único ponto seguido de 1 ou 2 dígitos é decimal.
 * Vazio ou inválido = NaN.
 */
export function lerNumeroBR(texto: string | number | null | undefined): number {
  if (typeof texto === "number") return texto;
  let s = String(texto ?? "").replace(/R\$|\s|%/g, "");
  if (!s) return NaN;
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  else if (!/^-?\d+\.\d{1,2}$/.test(s)) s = s.replace(/\./g, "");
  return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : NaN;
}

/** Número para campo de texto no formato brasileiro (sem "R$"): 350000.5 → "350.000,5". */
export function numeroParaCampo(v: number | null | undefined): string {
  return v == null || !Number.isFinite(v) ? "" : v.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
}

function partesData(iso: string): [number, number, number] | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? "");
  if (!m) return null;
  const [a, me, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (me < 1 || me > 12 || d < 1 || d > 31) return null;
  return [a, me, d];
}

/** Soma meses a uma data ISO; dia 31 em mês curto vira o último dia do mês. */
export function somarMeses(iso: string, meses: number): string {
  const p = partesData(iso);
  if (!p) return iso;
  const [a, m, d] = p;
  const total = a * 12 + (m - 1) + meses;
  const ano = Math.floor(total / 12);
  const mes = (total % 12) + 1;
  const ultimo = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  const dia = Math.min(d, ultimo);
  return `${String(ano).padStart(4, "0")}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}

/** Meses de calendário entre duas datas ISO (o dia não conta). */
export function mesesEntre(de: string, ate: string): number {
  const a = partesData(de);
  const b = partesData(ate);
  if (!a || !b) return 0;
  return (b[0] - a[0]) * 12 + (b[1] - a[1]);
}

/** Taxa mensal equivalente de juros + correção (fração, ex.: 0.01 = 1% a.m.). */
export function taxaMensalEquivalente(juros: EntradaSimulacao["juros"], correcao?: EntradaSimulacao["correcao"]) {
  const j = Math.max(0, Number(juros?.taxa) || 0) / 100;
  const jm = juros?.base === "aa" ? Math.pow(1 + j, 1 / 12) - 1 : j;
  const c = Math.max(0, Number(correcao?.taxaAnual) || 0) / 100;
  const cm = Math.pow(1 + c, 1 / 12) - 1;
  return (1 + jm) * (1 + cm) - 1;
}

/** Prestação constante (Price). Taxa zero = saldo dividido em partes iguais. */
export function prestacaoPrice(principal: number, taxa: number, n: number) {
  if (n <= 0) return 0;
  if (taxa <= 0) return principal / n;
  return (principal * taxa) / (1 - Math.pow(1 + taxa, -n));
}

/** Hoje (AAAA-MM-DD) no fuso de Brasília — data padrão da simulação. */
export function hojeBrasilia(agora = new Date()): string {
  return agora.toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
}

/** Simulação gravada numa rodada (proposals.parcelamento.simulador.entrada), ou null. */
export function simulacaoDaRodada(parcelamento: unknown): EntradaSimulacao | null {
  const e = (parcelamento as { simulador?: { entrada?: EntradaSimulacao } } | null)?.simulador?.entrada;
  return e && typeof e.valorProposto === "number" && typeof e.dataBase === "string" ? e : null;
}

export function simular(e: EntradaSimulacao): ResultadoSimulacao {
  const erros: string[] = [];
  const valorTabela = Math.max(0, Number(e.valorTabela) || 0);
  const valorProposto = Math.max(0, Number(e.valorProposto) || 0);
  if (valorProposto <= 0) erros.push("Informe o valor proposto.");

  const entradaBruta = Math.max(0, Number(e.entrada?.valor) || 0);
  const entrada = centavos(e.entrada?.tipo === "percentual" ? (valorProposto * entradaBruta) / 100 : entradaBruta);
  if (entrada > valorProposto) erros.push("A entrada é maior que o valor proposto.");
  const saldo = centavos(Math.max(0, valorProposto - entrada));

  const n = Math.floor(Number(e.parcelas) || 0);
  if (saldo > 0 && n < 1) erros.push("Informe o número de parcelas.");
  if (n > 600) erros.push("No máximo 600 parcelas.");

  const p = MESES_PERIODO[e.periodicidade] ?? 1;
  const taxaMensal = taxaMensalEquivalente(e.juros, e.correcao);
  const taxaPeriodo = Math.pow(1 + taxaMensal, p) - 1;

  if (!partesData(e.dataBase)) erros.push("Data-base inválida.");
  if (!partesData(e.primeiraData)) erros.push("Primeira data inválida.");
  const carencia = mesesEntre(e.dataBase, e.primeiraData);
  if (partesData(e.dataBase) && partesData(e.primeiraData) && carencia < 0) {
    erros.push("A primeira parcela não pode vencer antes da data-base.");
  }

  // balões: parte do saldo paga em reforços, cada um com os juros até vencer
  const qb = Math.max(0, Math.floor(Number(e.baloes?.quantidade) || 0));
  const vb = Math.max(0, Number(e.baloes?.valor) || 0);
  const ib = Math.max(1, Math.floor(Number(e.baloes?.intervaloMeses) || 6));
  const baloes = qb > 0 && vb > 0 ? Array.from({ length: qb }, (_, k) => ({ meses: (k + 1) * ib, face: centavos(vb) })) : [];
  const totalBaloes = centavos(baloes.reduce((s, b) => s + b.face, 0));
  if (totalBaloes > saldo) erros.push("Os balões somam mais que o saldo.");

  const vazio: ResultadoSimulacao = {
    diferenca: centavos(valorProposto - valorTabela),
    diferencaPercentual: valorTabela > 0 ? ((valorProposto - valorTabela) / valorTabela) * 100 : 0,
    entrada, entradaPercentual: valorProposto > 0 ? (entrada / valorProposto) * 100 : 0,
    saldo, taxaMensal, taxaPeriodo, principalParcelas: 0, totalBaloes,
    linhas: [], primeiraParcela: 0, ultimaParcela: 0, totalJuros: 0, totalPago: entrada, erros,
  };
  if (erros.length) return vazio;

  // principal das parcelas regulares, com os juros da carência incorporados
  const restante = centavos(saldo - totalBaloes);
  const mesesCarencia = Math.max(0, carencia - p);
  const principalParcelas = centavos(restante * Math.pow(1 + taxaMensal, mesesCarencia));

  type Bruta = Omit<LinhaParcela, "numero" | "saldoDevedor"> & { ordem: number };
  const brutas: Bruta[] = [];

  if (principalParcelas > 0 && n > 0) {
    let devedor = principalParcelas;
    const pmt = centavos(prestacaoPrice(principalParcelas, taxaPeriodo, n));
    const amortSac = principalParcelas / n;
    for (let k = 1; k <= n; k++) {
      const juros = centavos(devedor * taxaPeriodo);
      let amort = e.sistema === "sac" ? centavos(amortSac) : centavos(pmt - juros);
      // última parcela fecha o saldo (sobra de arredondamento)
      if (k === n) amort = centavos(devedor);
      devedor = centavos(devedor - amort);
      brutas.push({
        ordem: mesesEntre(e.dataBase, somarMeses(e.primeiraData, (k - 1) * p)),
        tipo: "parcela", data: somarMeses(e.primeiraData, (k - 1) * p),
        valor: centavos(amort + juros), juros, amortizacao: amort,
      });
    }
  }
  for (const b of baloes) {
    const valor = centavos(b.face * Math.pow(1 + taxaMensal, b.meses));
    brutas.push({
      ordem: b.meses, tipo: "balao", data: somarMeses(e.dataBase, b.meses),
      valor, juros: centavos(valor - b.face), amortizacao: b.face,
    });
  }

  // em ordem de vencimento; no mesmo mês, a parcela antes do balão
  brutas.sort((x, y) => x.ordem - y.ordem || (x.tipo === y.tipo ? 0 : x.tipo === "parcela" ? -1 : 1));
  let devedorTotal = centavos(principalParcelas + totalBaloes);
  const linhas: LinhaParcela[] = brutas.map((b, i) => {
    devedorTotal = centavos(Math.max(0, devedorTotal - b.amortizacao));
    return { numero: i + 1, tipo: b.tipo, data: b.data, valor: b.valor, juros: b.juros, amortizacao: b.amortizacao, saldoDevedor: devedorTotal };
  });

  const regulares = linhas.filter((l) => l.tipo === "parcela");
  const somaPago = linhas.reduce((s, l) => s + l.valor, 0);
  return {
    ...vazio,
    principalParcelas,
    linhas,
    primeiraParcela: regulares[0]?.valor ?? 0,
    ultimaParcela: regulares.at(-1)?.valor ?? 0,
    // juros = tudo o que se paga além do saldo (inclui a carência incorporada)
    totalJuros: centavos(somaPago - saldo),
    totalPago: centavos(entrada + somaPago),
  };
}
