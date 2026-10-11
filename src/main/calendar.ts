// The School calendar and when a Temp checkout is due (#61 §3–§5, #74). Shared by the main process (checked on save)
// and the window (the due time), so it imports nothing. Every date and time is plain local (Central) time.

/** One School calendar line: a date (from = to) or a range, with no school, or a half day ending at halfDay ("HH:MM"). */
export type CalendarEntry = { from: string; to: string; halfDay?: string; label: string }
/** The end-of-day time until Settings change it (#61 §3). */
export const END_OF_DAY = '14:50'
/** What a due time is worked out from: the end-of-day time ("HH:MM") and the School calendar. */
export type SchoolTimes = { endOfDay: string; calendar: CalendarEntry[] }

const pad = (n: number) => String(n).padStart(2, '0')
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const hhmm = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`
/** A moment as "YYYY-MM-DD HH:MM", the way due times are written. */
export const stamp = (d: Date) => `${ymd(d)} ${hhmm(d)}`
const dateOf = (s: string) => new Date(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)))
const DATE = /^\d{4}-\d{2}-\d{2}$/
export const realDate = (s: string) => DATE.test(s) && ymd(dateOf(s)) === s
export const realTime = (s: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(s)

// A line: a date, optionally "to" an end date (a label may start with the word: "to" and no digit isn't a range), optionally "half day" and a time, then the label.
const LINE = /^(\S+)(?:\s+to\s+(\d\S*))?(\s+half\s+day\b\s*(\d{1,2}:\d{2}\b)?)?\s*(.*)$/i

/** The School calendar's text, one entry per line, checked and sorted by date. Throws "Line N: …" at the first bad line. */
export function parseCalendar(text: string): CalendarEntry[] {
  const entries = text.split('\n').flatMap((raw, i): CalendarEntry[] => {
    const line = raw.trim()
    if (!line) return []
    const no = (why: string): never => { throw new Error(`Line ${i + 1}: ${why}`) }
    const [, from, to = from, half, typed, label] = LINE.exec(line)!
    const time = typed?.padStart(5, '0')
    if (!DATE.test(from)) no('start with a date like 2026-11-26')
    if (!realDate(from)) no(`${from} isn't a real date`)
    if (!DATE.test(to)) no('the end date must be a date like 2026-11-27')
    if (!realDate(to)) no(`${to} isn't a real date`)
    if (to < from) no('the end date is before the start date')
    if (half && !time) no('a half day needs its time, like half day 12:00')
    if (time && !realTime(time)) no(`${time.replace(/^0(?=\d\d:)/, '')} isn't a real time`)
    // 00:00 would read back as a date-only Expected Checkin (#71).
    if (time === '00:00') no("a half day can't end at midnight (00:00)")
    if (!label.trim()) no('add a label, like Thanksgiving')
    return [{ from, to, ...(time && { halfDay: time }), label: label.trim() }]
  })
  return entries.sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to))
}

/** The entries as the School calendar box shows them, one per line. */
export const formatCalendar = (entries: CalendarEntry[]) =>
  entries.map((e) => [e.from, e.to !== e.from && `to ${e.to}`, e.halfDay && `half day ${e.halfDay}`, e.label].filter(Boolean).join(' ')).join('\n')

/** A date's end-of-day time ("HH:MM"), or null when it isn't a School day: weekends, and any no-school entry (which beats a half day). */
export function endOn(date: Date, { endOfDay, calendar }: SchoolTimes): string | null {
  if (date.getDay() === 0 || date.getDay() === 6) return null
  const day = ymd(date)
  const on = calendar.filter((e) => e.from <= day && day <= e.to)
  if (on.some((e) => !e.halfDay)) return null
  return on.map((e) => e.halfDay!).sort()[0] ?? endOfDay
}

/**
 * When a Temp checkout made now is due, "YYYY-MM-DD HH:MM": today's end-of-day time on a School day before it, else the
 * next School day's. null when the School calendar leaves no School day within a year.
 */
export function dueAt(now: Date, times: SchoolTimes): string | null {
  for (let i = 0; i <= 366; i++) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i)
    const end = endOn(day, times)
    if (end && (i > 0 || hhmm(now) < end)) return `${ymd(day)} ${end}`
  }
  return null
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** "2:50 pm" from "14:50". */
export const clock = (t: string) => {
  const h = Number(t.slice(0, 2))
  return `${h % 12 || 12}:${t.slice(3, 5)} ${h < 12 ? 'am' : 'pm'}`
}
/** A due time as the header says it ("today 2:50 pm", "Tue 13 Oct 2:50 pm"), or short for a Running list row ("2:50 pm", "Tue 2:50 pm"). */
export function dueLabel(due: string, now: Date, short = false): string {
  const date = dateOf(due)
  const day = ymd(date) === ymd(now) ? (short ? '' : 'today') : short ? DAYS[date.getDay()] : `${DAYS[date.getDay()]} ${date.getDate()} ${MONTHS[date.getMonth()]}`
  return [day, clock(due.slice(11, 16))].filter(Boolean).join(' ')
}
