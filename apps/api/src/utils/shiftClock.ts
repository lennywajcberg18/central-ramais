// Contas de relógio no fuso do hospital: escala de plantão em minutos desde 00:00
// e a janela de datas dos relatórios.
// Tudo aqui é função pura: a escala é o dado, o relógio é parâmetro.

export const MINUTES_IN_DAY = 1440;

export interface ShiftWindow {
  weekday: number; // 0=domingo … 6=sábado
  startMinute: number; // 0..1439
  endMinute: number; // 1..1440 (1440 = meia-noite seguinte)
}

export interface LocalNow {
  weekday: number;
  minuteOfDay: number;
}

const WEEKDAYS: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

const WEEKDAY_LABELS = [
  'domingo',
  'segunda-feira',
  'terça-feira',
  'quarta-feira',
  'quinta-feira',
  'sexta-feira',
  'sábado',
];

// hourCycle h23 evita a hora "24" que alguns ambientes devolvem com hour12:false.
function partsIn(timezone: string, at: Date) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
}

export function localNow(timezone: string, at: Date = new Date()): LocalNow {
  let parts;
  try {
    parts = partsIn(timezone, at);
  } catch {
    // Fuso inválido no cadastro do tenant não pode derrubar o login de todo mundo.
    console.warn(`[shiftClock] fuso inválido "${timezone}", usando UTC`);
    parts = partsIn('UTC', at);
  }

  const find = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const weekday = WEEKDAYS[find('weekday')] ?? 0;
  const hour = parseInt(find('hour'), 10) || 0;
  const minute = parseInt(find('minute'), 10) || 0;

  return { weekday, minuteOfDay: hour * 60 + minute };
}

const MINUTES_IN_WEEK = 7 * MINUTES_IN_DAY;

// Cada faixa vira um intervalo absoluto na semana, replicado na semana anterior
// e na seguinte para que a virada de domingo não corte um plantão no meio.
function absoluteRanges(windows: ShiftWindow[]): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  for (const w of windows) {
    if (w.startMinute === w.endMinute) continue;
    const inicio = w.weekday * MINUTES_IN_DAY + w.startMinute;
    const duracao =
      w.endMinute > w.startMinute
        ? w.endMinute - w.startMinute
        : MINUTES_IN_DAY - w.startMinute + w.endMinute;
    for (const deslocamento of [-MINUTES_IN_WEEK, 0, MINUTES_IN_WEEK]) {
      ranges.push([inicio + deslocamento, inicio + duracao + deslocamento]);
    }
  }
  return ranges;
}

// Faixas que se encostam formam um plantão só. Sem isto, a escala 00:00–24:00
// termina toda meia-noite e o plantonista é deslogado no meio do turno; a dobra
// (07:00–13:00 + 12:00–19:00) acabaria às 13:00.
export function minutesLeftInShift(windows: ShiftWindow[], now: LocalNow): number | null {
  const ranges = absoluteRanges(windows);
  const agora = now.weekday * MINUTES_IN_DAY + now.minuteOfDay;

  let fim: number | null = null;
  for (const [inicio, termino] of ranges) {
    if (inicio <= agora && agora < termino && (fim === null || termino > fim)) fim = termino;
  }
  if (fim === null) return null;

  // Estende enquanto houver faixa começando antes (ou exatamente) do fim atual.
  // O teto de uma semana existe para escala 24/7 não virar laço infinito.
  const limite = agora + MINUTES_IN_WEEK;
  let avancou = true;
  while (avancou && fim < limite) {
    avancou = false;
    for (const [inicio, termino] of ranges) {
      if (inicio <= fim && termino > fim) {
        fim = termino;
        avancou = true;
      }
    }
  }

  return Math.min(fim, limite) - agora;
}

export function shiftEndsAt(
  windows: ShiftWindow[],
  timezone: string,
  at: Date = new Date()
): Date | null {
  const restante = minutesLeftInShift(windows, localNow(timezone, at));
  return restante === null ? null : new Date(at.getTime() + restante * 60_000);
}

export function formatMinuteOfDay(minute: number): string {
  const normalizado = minute % MINUTES_IN_DAY;
  const hh = String(Math.floor(normalizado / 60)).padStart(2, '0');
  const mm = String(normalizado % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}

// ---------- janela de datas no fuso do hospital ----------

function offsetPartsIn(timezone: string, at: Date) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
}

// Quantos minutos o fuso está à frente do UTC no instante `at`: a diferença entre
// o relógio de parede de lá e o relógio UTC. É o que permite sair de "22:00 em São
// Paulo" para o instante que o banco guarda.
function offsetMinutes(timezone: string, at: Date): number {
  let parts;
  try {
    parts = offsetPartsIn(timezone, at);
  } catch {
    // Mesmo motivo de localNow: fuso inválido no cadastro do tenant não pode
    // derrubar o relatório — cai em UTC.
    console.warn(`[shiftClock] fuso inválido "${timezone}", usando UTC`);
    return 0;
  }
  const find = (type: string) =>
    parseInt(parts.find((p) => p.type === type)?.value ?? '0', 10) || 0;
  const relogioLocal = Date.UTC(
    find('year'),
    find('month') - 1,
    find('day'),
    find('hour'),
    find('minute'),
    find('second')
  );
  return Math.round((relogioLocal - Math.floor(at.getTime() / 1000) * 1000) / 60_000);
}

// Instante UTC da meia-noite local de uma data. Duas passadas porque o próprio
// deslocamento depende do instante: no dia da virada do horário de verão a
// primeira estimativa cai do lado errado da mudança.
function startOfLocalDay(timezone: string, isoDate: string, maisDias = 0): Date {
  const [ano, mes, dia] = isoDate.split('-').map(Number);
  const alvo = Date.UTC(ano, mes - 1, dia + maisDias);
  const primeira = alvo - offsetMinutes(timezone, new Date(alvo)) * 60_000;
  return new Date(alvo - offsetMinutes(timezone, new Date(primeira)) * 60_000);
}

// A janela do relatório é dita em datas ("de 1 a 7 de agosto") e o hospital lê
// essas datas no relógio DELE. Sem esta conversão a janela era resolvida no fuso
// do processo: com o Node em UTC, "hoje" para um tenant em São Paulo começava às
// 21h de ontem e o plantão da noite inteiro caía no relatório do dia seguinte.
export function dayRangeInZone(
  timezone: string,
  from?: string,
  to?: string
): { from?: Date; to?: Date } {
  return {
    from: from ? startOfLocalDay(timezone, from) : undefined,
    // Fim do dia é a véspera da meia-noite seguinte: as consultas filtram com
    // `lte`, e parar em 23:59:59 deixaria o último segundo de fora.
    to: to ? new Date(startOfLocalDay(timezone, to, 1).getTime() - 1) : undefined,
  };
}

// Para a mensagem de recusa do login: "quinta-feira, 07:00".
// Sem isso, quem tenta entrar fora da escala não sabe se é regra ou defeito.
export function describeNextWindow(windows: ShiftWindow[], now: LocalNow): string | null {
  if (windows.length === 0) return null;

  // Vai até 7 (e não 6): quem só trabalha aos sábados, tentando entrar sábado à
  // noite, precisa ouvir "sábado, 07:00" — o sábado da semana que vem.
  for (let adiante = 0; adiante <= 7; adiante++) {
    const weekday = (now.weekday + adiante) % 7;
    const candidatas = windows
      .filter((w) => w.weekday === weekday)
      .filter((w) => adiante > 0 || w.startMinute > now.minuteOfDay)
      .sort((a, b) => a.startMinute - b.startMinute);

    if (candidatas.length > 0) {
      const quando = formatMinuteOfDay(candidatas[0].startMinute);
      if (adiante === 0) return `hoje, ${quando}`;
      if (adiante === 1) return `amanhã, ${quando}`;
      return `${WEEKDAY_LABELS[weekday]}, ${quando}`;
    }
  }
  return null;
}
