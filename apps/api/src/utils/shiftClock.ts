// Horário de plantão em minutos desde 00:00, no fuso do hospital.
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

// Minutos restantes se `now` cai dentro desta faixa; null se está fora dela.
export function minutesLeftInWindow(window: ShiftWindow, now: LocalNow): number | null {
  const { weekday, startMinute, endMinute } = window;
  if (startMinute === endMinute) return null;

  if (startMinute < endMinute) {
    if (weekday !== now.weekday) return null;
    const dentro = now.minuteOfDay >= startMinute && now.minuteOfDay < endMinute;
    return dentro ? endMinute - now.minuteOfDay : null;
  }

  // Plantão que vira o dia (19h→7h): a faixa é [start, 24h) no dia cadastrado
  // mais [0, end) no dia seguinte.
  if (weekday === now.weekday && now.minuteOfDay >= startMinute) {
    return MINUTES_IN_DAY - now.minuteOfDay + endMinute;
  }
  const diaAnterior = (now.weekday + 6) % 7;
  if (weekday === diaAnterior && now.minuteOfDay < endMinute) {
    return endMinute - now.minuteOfDay;
  }
  return null;
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
