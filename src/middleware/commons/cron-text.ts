// A routine's cron pattern in plain words, for approval cards and lists:
// "0 8 * * *" is "Every day at 08:00". Patterns it doesn't know are shown
// as they are, so the card never says something untrue.

const days = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

const isNumber = (part: string) => /^\d+$/.test(part);
const time = (hour: string, minute: string) =>
  `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`;

function dayList(part: string): string | null {
  if (part === '1-5') return 'weekdays';
  if (part === '0,6' || part === '6,0') return 'weekends';
  const numbers = part.split(',');
  if (!numbers.every((n) => /^[0-7]$/.test(n))) return null;
  return numbers.map((n) => days[Number(n) % 7]).join(', ');
}

export function describeCron(cron: string): string {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return `Cron: ${cron}`;
  const [minute, hour, dayOfMonth, month, weekday] = parts;
  const every = /^\*\/(\d+)$/;

  if (
    every.test(minute) &&
    hour === '*' &&
    dayOfMonth === '*' &&
    month === '*' &&
    weekday === '*'
  ) {
    return `Every ${every.exec(minute)?.[1]} minutes`;
  }
  if (
    isNumber(minute) &&
    hour === '*' &&
    dayOfMonth === '*' &&
    month === '*' &&
    weekday === '*'
  ) {
    return `Every hour at minute ${minute}`;
  }
  if (
    isNumber(minute) &&
    every.test(hour) &&
    dayOfMonth === '*' &&
    month === '*' &&
    weekday === '*'
  ) {
    return `Every ${every.exec(hour)?.[1]} hours at minute ${minute}`;
  }
  if (!isNumber(minute) || !isNumber(hour) || month !== '*') {
    return `Cron: ${cron}`;
  }
  const at = time(hour, minute);
  if (dayOfMonth === '*' && weekday === '*') return `Every day at ${at}`;
  if (dayOfMonth === '*') {
    const list = dayList(weekday);
    return list ? `Every ${list} at ${at}` : `Cron: ${cron}`;
  }
  if (isNumber(dayOfMonth) && weekday === '*') {
    return `Every month on day ${dayOfMonth} at ${at}`;
  }
  return `Cron: ${cron}`;
}
