/**
 * Horário e prazo (SLA) de atendimento por setor (migration 0171).
 * Funções puras: o servidor lê a tabela e passa o horário para cá.
 * Dias no padrão ISO: 1 = segunda … 7 = domingo. Fuso de Brasília.
 */
export type HorarioSetor = {
  setor: string; dias: number[]; inicio: string; fim: string; prazo_minutos: number; mensagem_fora: string;
};

export const DIAS_SEMANA: { n: number; curto: string }[] = [
  { n: 1, curto: "Seg" }, { n: 2, curto: "Ter" }, { n: 3, curto: "Qua" }, { n: 4, curto: "Qui" },
  { n: 5, curto: "Sex" }, { n: 6, curto: "Sáb" }, { n: 7, curto: "Dom" },
];

const FUSO = "America/Sao_Paulo";
const ISO: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

/** "08:00" ou "08:00:00" → minutos do dia. */
export function minutosDoDia(hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

/** Dia da semana (ISO) e minuto do dia, no horário de Brasília. */
export function local(d: Date) {
  const p = new Intl.DateTimeFormat("en-GB", { timeZone: FUSO, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(d);
  const v = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return { dia: ISO[v("weekday")] ?? 1, minuto: Number(v("hour")) * 60 + Number(v("minute")) };
}

export function dentroDoHorario(h: Pick<HorarioSetor, "dias" | "inicio" | "fim">, agora = new Date()) {
  const { dia, minuto } = local(agora);
  return h.dias.includes(dia) && minuto >= minutosDoDia(h.inicio) && minuto < minutosDoDia(h.fim);
}

/**
 * Momento em que vence o prazo de `minutos` de expediente contados a partir de
 * `inicio`, no horário do setor. Mesma regra da fn_atendimento_prazo (0171).
 */
export function prazoNoHorario(h: Pick<HorarioSetor, "dias" | "inicio" | "fim">, inicio: Date, minutos: number) {
  const ini = minutosDoDia(h.inicio), fim = minutosDoDia(h.fim);
  if (fim <= ini || !h.dias.length) return new Date(inicio.getTime() + minutos * 60000);
  let resto = Math.max(1, minutos);
  let t = inicio.getTime();
  for (let guarda = 0; guarda < 30; guarda++) {
    const { dia, minuto } = local(new Date(t));
    const inicioDoDia = t - minuto * 60000 - (new Date(t).getSeconds() * 1000 + new Date(t).getMilliseconds());
    if (!h.dias.includes(dia) || minuto >= fim) { t = inicioDoDia + 86400000 + ini * 60000; continue; }
    if (minuto < ini) { t = inicioDoDia + ini * 60000; continue; }
    const livre = fim - minuto;
    if (resto <= livre) return new Date(t + resto * 60000);
    resto -= livre;
    t = inicioDoDia + 86400000 + ini * 60000;
  }
  return new Date(inicio.getTime() + minutos * 60000);
}

/** Valida o que vem do formulário da Diretoria. Devolve a mensagem de erro ou null. */
export function validarHorario(h: Partial<HorarioSetor>): string | null {
  if (!Array.isArray(h.dias) || !h.dias.length || h.dias.some((d) => !Number.isInteger(d) || d < 1 || d > 7)) return "Escolha ao menos um dia.";
  const hora = /^([01]\d|2[0-3]):[0-5]\d$/;
  if (!hora.test(String(h.inicio)) || !hora.test(String(h.fim))) return "Horário inválido (use HH:MM).";
  if (minutosDoDia(h.fim!) <= minutosDoDia(h.inicio!)) return "O fim do expediente precisa ser depois do início.";
  if (!Number.isInteger(h.prazo_minutos) || h.prazo_minutos! < 5 || h.prazo_minutos! > 1440) return "Prazo entre 5 e 1440 minutos.";
  if (typeof h.mensagem_fora !== "string" || h.mensagem_fora.length > 1000) return "Mensagem de fora do horário até 1000 caracteres.";
  return null;
}
