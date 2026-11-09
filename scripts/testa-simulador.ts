/**
 * Verificação do simulador de propostas (src/lib/simulador.ts).
 * Rodar: node scripts/testa-simulador.ts   (Node 22+ lê TypeScript direto)
 * Não toca no banco.
 */
import { simular, somarMeses, mesesEntre, prestacaoPrice, taxaMensalEquivalente, lerNumeroBR, numeroParaCampo, type EntradaSimulacao } from "../src/lib/simulador.ts";

let falhas = 0;
function confere(nome: string, ok: boolean, detalhe?: unknown) {
  console.log(`${ok ? "ok  " : "FALHOU"} ${nome}${ok ? "" : ` → ${JSON.stringify(detalhe)}`}`);
  if (!ok) falhas++;
}
const perto = (a: number, b: number, tol = 0.02) => Math.abs(a - b) <= tol;

const base: EntradaSimulacao = {
  valorTabela: 120000, valorProposto: 110000,
  entrada: { tipo: "percentual", valor: 10 },
  parcelas: 12, periodicidade: "mensal", sistema: "price",
  juros: { taxa: 1, base: "am" },
  dataBase: "2026-11-09", primeiraData: "2026-12-09",
};

// datas
confere("somarMeses 31/01 + 1 = 28/02", somarMeses("2027-01-31", 1) === "2027-02-28", somarMeses("2027-01-31", 1));
confere("somarMeses vira o ano", somarMeses("2026-11-10", 3) === "2027-02-10");
confere("mesesEntre", mesesEntre("2026-11-09", "2027-05-01") === 6);

// taxas
confere("12% a.a. ≈ 0,9489% a.m.", perto(taxaMensalEquivalente({ taxa: 12, base: "aa" }) * 100, 0.9489, 0.0001));
confere("Price sem juros divide igual", prestacaoPrice(1200, 0, 12) === 100);

// diferença, entrada e saldo
const r = simular(base);
confere("sem erros", r.erros.length === 0, r.erros);
confere("diferença R$ -10.000", r.diferenca === -10000);
confere("diferença -8,33%", perto(r.diferencaPercentual, -8.3333, 0.001));
confere("entrada 10% = 11.000", r.entrada === 11000);
confere("saldo 99.000", r.saldo === 99000);

// Price: prestação conhecida (99.000, 1% a.m., 12x = 8.796,03)
confere("Price 12x de 8.796,03", perto(r.primeiraParcela, 8796.03), r.primeiraParcela);
confere("Price 12 linhas", r.linhas.length === 12);
confere("Price zera o saldo", r.linhas.at(-1)?.saldoDevedor === 0);
confere("Price amortiza o saldo todo", perto(r.linhas.reduce((s, l) => s + l.amortizacao, 0), 99000));
confere("Price 2ª parcela em 09/01/2027", r.linhas[1].data === "2027-01-09");

// SAC: amortização constante, primeira = 8.250 + 990
const s = simular({ ...base, sistema: "sac" });
confere("SAC 1ª parcela 9.240", perto(s.primeiraParcela, 9240), s.primeiraParcela);
confere("SAC parcelas decrescem", s.linhas.every((l, i) => i === 0 || l.valor < s.linhas[i - 1].valor));
confere("SAC paga menos juros que Price", s.totalJuros < r.totalJuros);
confere("total pago = entrada + parcelas", perto(s.totalPago, s.entrada + s.linhas.reduce((t, l) => t + l.valor, 0)));

// sem juros: total pago = valor proposto
const z = simular({ ...base, juros: { taxa: 0, base: "am" } });
confere("sem juros: total = proposto", perto(z.totalPago, 110000));

// semestral com taxa do período composta
const sem = simular({ ...base, periodicidade: "semestral", parcelas: 4, primeiraData: "2027-05-09" });
confere("semestral: taxa do período ≈ 6,15%", perto(sem.taxaPeriodo * 100, 6.152, 0.001));
confere("semestral: 4ª parcela em 11/2028", sem.linhas[3].data === "2028-11-09");

// balões
const b = simular({ ...base, baloes: { quantidade: 2, valor: 20000, intervaloMeses: 6 } });
confere("balões: 14 linhas", b.linhas.length === 14);
confere("balão de 6 meses = 20.000 × 1,01^6", perto(b.linhas.find((l) => l.tipo === "balao")!.valor, 21230.40), b.linhas.find((l) => l.tipo === "balao"));
confere("balões: parcelas sobre 59.000", b.principalParcelas === 59000);
confere("balões: saldo devedor zera", b.linhas.at(-1)?.saldoDevedor === 0);

// carência: primeira parcela 3 meses depois → 2 meses de juros incorporados
const c = simular({ ...base, primeiraData: "2027-02-09" });
confere("carência incorpora 2 meses", perto(c.principalParcelas, 99000 * 1.01 ** 2));

// correção por índice soma com os juros
const ic = simular({ ...base, correcao: { indice: "IPCA", taxaAnual: 4.5 } });
confere("correção aumenta a parcela", ic.primeiraParcela > r.primeiraParcela);

// leitura de valor digitado (bug da venda gravada 10× maior)
confere("lerNumeroBR 350000.5", lerNumeroBR("350000.5") === 350000.5);
confere("lerNumeroBR 350.000,50", lerNumeroBR("350.000,50") === 350000.5);
confere("lerNumeroBR R$ 1.200", lerNumeroBR("R$ 1.200") === 1200);
confere("lerNumeroBR 1.234.567", lerNumeroBR("1.234.567") === 1234567);
confere("lerNumeroBR 3,5", lerNumeroBR("3,5") === 3.5);
confere("lerNumeroBR inválido", Number.isNaN(lerNumeroBR("abc")));
confere("ida e volta pelo campo", lerNumeroBR(numeroParaCampo(350000.5)) === 350000.5, numeroParaCampo(350000.5));

// validações
confere("entrada maior que o valor", simular({ ...base, entrada: { tipo: "valor", valor: 200000 } }).erros.length > 0);
confere("primeira data antes da base", simular({ ...base, primeiraData: "2026-01-01" }).erros.length > 0);
confere("à vista (entrada 100%) sem parcelas", simular({ ...base, entrada: { tipo: "percentual", valor: 100 }, parcelas: 0 }).erros.length === 0);

console.log(falhas ? `\n${falhas} verificação(ões) falharam` : "\nTudo certo.");
process.exit(falhas ? 1 : 0);
