// The End-of-day reminder (#62 §1–§7) and Automatic check-in (#62 §8): two jobs on the main process's minute tick, beside
// the Report scheduler, each once a School day.
import { clock, endOn, stamp } from './calendar'
import type { Settings } from './config'
import { appNote } from './notes'
import type { OverdueRow } from './snipeit'

/** Tells the window to open the dashboard Overdue list with Temp only on (the reminder was clicked). */
export type ReminderApi = {
  onOpen(listener: () => void): () => void
  /** An Automatic check-in notification was clicked: day ("YYYY-MM-DD") is the day it ran. */
  onAutomatic(listener: (day: string) => void): () => void
}

type JobSettings = Pick<Settings, 'hasToken' | 'tempCheckout' | 'schoolCalendar'>

const LISTED = 10
// The Asset Tags (as given), at most 10 then "and N more". Never names: notifications show on lock screens.
const listed = (tags: string[]) => tags.slice(0, LISTED).join(', ') + (tags.length > LISTED ? ` and ${tags.length - LISTED} more` : '')
const temps = (n: number) => `${n} Temp checkout${n === 1 ? '' : 's'}`

/** The reminder: the count and Asset Tags, most late first. automaticAt: today's Automatic check-in time ("HH:MM") when it's on. */
export function reminderText(tags: string[], automaticAt?: string) {
  return {
    title: `${temps(tags.length)} still out`,
    body: [listed(tags), automaticAt && `Any still out at ${clock(automaticAt)} will be checked in automatically.`].filter(Boolean).join('\n'),
  }
}

/** After Automatic check-in: the count and Asset Tags it checked in. */
export const automaticText = (tags: string[]) => ({ title: `Checked in ${temps(tags.length)} automatically`, body: listed(tags) })

const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))
const pad = (n: number) => String(n).padStart(2, '0')
/**
 * A date's Automatic check-in time ("HH:MM"): the same gap after its end-of-day time (a half day's own) as the set time is
 * after the usual one. null when it isn't a School day, or the gap runs past midnight.
 */
export function automaticAt(date: Date, { tempCheckout: t, schoolCalendar }: Pick<Settings, 'tempCheckout' | 'schoolCalendar'>): string | null {
  const end = endOn(date, { endOfDay: t.endOfDay, calendar: schoolCalendar })
  if (!end) return null
  const at = minutes(end) + minutes(t.automaticAt) - minutes(t.endOfDay)
  return at < 24 * 60 ? `${pad(Math.floor(at / 60))}:${pad(at % 60)}` : null
}

/**
 * Each tick reads Settings. On a School day at or past its time (at: null when it's off or not a School day), with a
 * connection set up and today not yet recorded, it looks, records today, then acts on what it found. A failed look rejects
 * (to be logged) and records nothing, so the next tick tries again until the day ends; a missed day is never caught up.
 * A tick still running makes the next do nothing.
 */
function daily<T>({ now, settings, at, last, record, look, act }: {
  now: () => Date
  settings: () => JobSettings
  at: (when: Date, s: JobSettings) => string | null
  last: () => string | undefined
  record: (day: string) => void
  look: () => Promise<T>
  act: (found: T, today: { when: Date; day: string; at: string; settings: JobSettings }) => void | Promise<void>
}) {
  let ticking = false
  return {
    async tick() {
      if (ticking) return
      const when = now()
      const [day, time] = stamp(when).split(' ')
      const s = settings()
      const due = s.hasToken ? at(when, s) : null
      if (!due || time < due || last() === day) return
      ticking = true
      try {
        const found = await look()
        record(day)
        await act(found, { when, day, at: due, settings: s })
      } finally {
        ticking = false
      }
    },
  }
}

/** Past today's end-of-day time, the outstanding Temp checkouts Overdue now, in one notification (none: no notification). */
export function createEndOfDayReminder({ now, settings, lastShown, recordShown, outstanding, notify }: {
  now: () => Date
  settings: () => JobSettings
  lastShown: () => string | undefined
  recordShown: (day: string) => void
  /** The outstanding Temp checkouts Overdue now, most late first: their Asset Tags. */
  outstanding: () => Promise<string[]>
  notify: (text: ReturnType<typeof reminderText>) => void
}) {
  return daily({
    now, settings, last: lastShown, record: recordShown, look: outstanding,
    at: (when, s) => (s.tempCheckout.reminder ? endOn(when, { endOfDay: s.tempCheckout.endOfDay, calendar: s.schoolCalendar }) : null),
    act: (tags, { when, settings: s }) => {
      if (tags.length) notify(reminderText(tags, (s.tempCheckout.automatic && automaticAt(when, s)) || undefined))
    },
  })
}

/**
 * Opt-in, at its time: checks in each outstanding Temp checkout Overdue then, one at a time. Each Checkin sends only its
 * note and is skipped when the Asset is no longer Overdue on the tagged Checkout (see automaticCheckin). One notification of those checked in; a Checkin that fails is only logged. No Undo.
 */
export function createAutomaticCheckin({ now, settings, lastRan, recordRan, outstanding, checkin, notify, log }: {
  now: () => Date
  settings: () => JobSettings
  lastRan: () => string | undefined
  recordRan: (day: string) => void
  outstanding: () => Promise<Pick<OverdueRow, 'id' | 'assetTag' | 'lastCheckout'>[]>
  /** One Asset's Checkin, only on the Checkout made at checkout (its last_checkout), with just the note; false: skipped. */
  checkin: (id: number, checkout: string, note: string) => Promise<boolean>
  /** day: the day it ran ("YYYY-MM-DD"), for the Activity Report the click opens. */
  notify: (text: ReturnType<typeof automaticText>, day: string) => void
  log: (message: string) => void
}) {
  return daily({
    now, settings, last: lastRan, record: recordRan, look: outstanding,
    at: (when, s) => (s.tempCheckout.automatic ? automaticAt(when, s) : null),
    act: async (rows, { day, at }) => {
      const note = appNote('Automatic check-in', `Temp checkout not scanned back by ${clock(at)}`)
      const done: string[] = []
      for (const r of rows) {
        try {
          // No last Checkout matches none, so it's skipped.
          if (await checkin(r.id, r.lastCheckout ?? '', note)) done.push(r.assetTag)
        } catch (e) {
          log(`${r.assetTag}: ${(e as Error).message}`)
        }
      }
      if (done.length) notify(automaticText(done), day)
    },
  })
}
