// Datas "só dia" (AAAA-MM-DD) no fuso da escola.
//
// O servidor de produção roda em UTC. Perguntar "que dia é hoje" em UTC dá o
// dia seguinte a partir das 21h no Brasil: o gráfico da semana andava um dia
// antes da hora e uma semana salva no domingo à noite caía na semana seguinte.
//
// Convenção: QUAL dia é hoje se pergunta no fuso da escola (APP_TIMEZONE);
// uma data sem hora é gravada como meia-noite UTC desse dia.

const DEFAULT_TIMEZONE = 'America/Sao_Paulo';

function appTimeZone(): string {
  const timeZone = process.env.APP_TIMEZONE || DEFAULT_TIMEZONE;
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone });
    return timeZone;
  } catch {
    // Nome de fuso inválido na variável de ambiente: usa o padrão em vez de derrubar a rota
    return DEFAULT_TIMEZONE;
  }
}

// Dia de hoje no fuso da escola, como "AAAA-MM-DD"
export function todayInAppTz(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: appTimeZone(),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

// Meia-noite UTC do dia informado
export function utcMidnight(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00.000Z`);
}

export function addDays(dateStr: string, days: number): string {
  const date = utcMidnight(dateStr);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

// 0 = domingo ... 6 = sábado
export function weekdayOf(dateStr: string): number {
  return utcMidnight(dateStr).getUTCDay();
}

// Segunda-feira da semana (segunda a domingo) que contém o dia informado
export function mondayOf(dateStr: string): string {
  const weekday = weekdayOf(dateStr);
  return addDays(dateStr, weekday === 0 ? -6 : 1 - weekday);
}
