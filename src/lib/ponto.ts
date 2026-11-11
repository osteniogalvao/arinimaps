/**
 * Ponto eletrônico (Central de CRMs, etapa 3, migration 0067): cálculo do
 * espelho. Sem dependência de servidor (a tela do espelho também usa).
 *
 * Regra: as marcações do dia formam pares entrada/saída na ordem do horário;
 * o tempo trabalhado é a soma dos pares. Marcação desconsiderada por ajuste
 * aprovado sai da conta; dia com número ímpar de marcações fica "incompleto".
 */
export type Marcacao = { id: string; nsr: number; marcado_em: string; origem: string; hash?: string | null };
export type Jornada = { carga_diaria_min: number; intervalo_min: number; dias_semana: number[]; entrada_prevista: string; tolerancia_min: number };
export type DiaEspelho = {
  data: string; marcacoes: Marcacao[]; trabalhado: number; previsto: number; saldo: number; incompleto: boolean; abonado: boolean;
};

export const JORNADA_PADRAO: Jornada = { carga_diaria_min: 480, intervalo_min: 60, dias_semana: [1, 2, 3, 4, 5], entrada_prevista: "08:00", tolerancia_min: 10 };

export const diaSP = (iso: string | Date) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
export const horaSP = (iso: string) => new Date(iso).toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });

export function minutosEmHoras(min: number) {
  const s = min < 0 ? "-" : "";
  const m = Math.abs(Math.round(min));
  return `${s}${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}`;
}

/** Espelho de um mês (AAAA-MM). `abonos`: dias abonados por ajuste aprovado. */
export function montarEspelho(mes: string, marcacoes: Marcacao[], jornada: Jornada, desconsideradas: Set<string>, abonos: Set<string>): DiaEspelho[] {
  const [ano, m] = mes.split("-").map(Number);
  const ultimo = new Date(ano, m, 0).getDate();
  const hoje = diaSP(new Date());
  const porDia = new Map<string, Marcacao[]>();
  for (const x of marcacoes) {
    if (desconsideradas.has(x.id)) continue;
    const d = diaSP(x.marcado_em);
    porDia.set(d, [...(porDia.get(d) ?? []), x]);
  }
  const dias: DiaEspelho[] = [];
  for (let d = 1; d <= ultimo; d++) {
    const data = `${mes}-${String(d).padStart(2, "0")}`;
    if (data > hoje) break;
    const lista = (porDia.get(data) ?? []).sort((a, b) => +new Date(a.marcado_em) - +new Date(b.marcado_em));
    let trabalhado = 0;
    for (let i = 0; i + 1 < lista.length; i += 2) trabalhado += (+new Date(lista[i + 1].marcado_em) - +new Date(lista[i].marcado_em)) / 60_000;
    const dow = new Date(`${data}T12:00:00`).getDay() || 7; // 1 = segunda … 7 = domingo
    const abonado = abonos.has(data);
    const previsto = jornada.dias_semana.includes(dow) && !abonado ? jornada.carga_diaria_min : 0;
    const incompleto = lista.length % 2 === 1 && data !== hoje;
    dias.push({ data, marcacoes: lista, trabalhado, previsto, saldo: data === hoje ? 0 : trabalhado - previsto, incompleto, abonado });
  }
  return dias.reverse();
}
