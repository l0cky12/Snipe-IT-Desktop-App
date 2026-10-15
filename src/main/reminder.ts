// The End-of-day reminder (#62 §1–§7) and Automatic check-in (#62 §8): two jobs on the main process's minute tick, beside
// the Report scheduler, each once a School day.
import { setTimeout as sleep } from 'node:timers/promises'
import { automaticOn, clock, endOn, stamp, type SchoolTimes } from './calendar'
import type { Settings } from './config'
import { appNote } from './notes'
import type { Failure, OverdueRow } from './snipeit'

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

const times = (s: JobSettings): SchoolTimes => ({ endOfDay: s.tempCheckout.endOfDay, calendar: s.schoolCalendar })
// Today's Automatic check-in time, null when it isn't a School day.
const automaticToday = (when: Date, s: JobSettings) => automaticOn(when, times(s), s.tempCheckout.automaticAt)

/**
 * Each tick reads Settings. On a School day at or past its time (at: null when it's off or not a School day), with a
 * connection set up and today not yet recorded, it looks up, records today, then acts on what it found. A failed lookup rejects
 * (to be logged) and records nothing, so the next tick tries again until the day ends; a missed day is never caught up.
 * A tick still running makes the next do nothing. cancel() (the connection was saved or logged out) stops a running tick,
 * as does its opt-in or connection being switched off: during the lookup, nothing is recorded, so the next tick starts afresh.
 */
function daily<T>({ now, settings, at, last, record, lookUp, onFound }: {
  now: () => Date
  settings: () => JobSettings
  at: (when: Date, s: JobSettings) => string | null
  last: () => string | undefined
  record: (day: string) => void
  lookUp: () => Promise<T>
  onFound: (found: T, today: { when: Date; day: string; at: string; settings: JobSettings; cancelled: () => boolean }) => void | Promise<void>
}) {
  let ticking = false
  let generation = 0
  return {
    cancel() { generation++ },
    async tick() {
      if (ticking) return
      const when = now()
      const [day, time] = stamp(when).split(' ')
      const s = settings()
      const runAt = s.hasToken ? at(when, s) : null
      if (!runAt || time < runAt || last() === day) return
      ticking = true
      const started = generation
      const cancelled = () => {
        if (started !== generation) return true
        const now = settings()
        return !now.hasToken || !at(when, now)
      }
      try {
        const found = await lookUp()
        if (cancelled()) return
        record(day)
        await onFound(found, { when, day, at: runAt, settings: s, cancelled })
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
    now, settings, last: lastShown, record: recordShown, lookUp: outstanding,
    at: (when, s) => (s.tempCheckout.reminder ? endOn(when, times(s)) : null),
    onFound: (tags, { when, settings: s }) => {
      if (tags.length) notify(reminderText(tags, (s.tempCheckout.automatic && automaticToday(when, s)) || undefined))
    },
  })
}

// A Checkin is a GET and a POST, so a second apart keeps the run within Snipe-IT's 120 requests a minute.
const PACE_MS = 1000
// Tries per Checkin while Snipe-IT answers 429; each waits out its Retry-After first.
const TRIES = 3

/** One connection to Snipe-IT, for a whole run, so a run never reaches a server saved after it started. */
export type AutomaticSession = {
  outstanding: () => Promise<Pick<OverdueRow, 'id' | 'assetTag' | 'lastCheckout'>[]>
  /** One Asset's Checkin with just the note, only on the Checkout made at checkout (its last_checkout); false: skipped. */
  checkin: (id: number, checkout: string, note: string) => Promise<boolean>
}

/**
 * Opt-in, at its time: checks in each outstanding Temp checkout Overdue then, one at a time and paced, over one connection.
 * Each Checkin sends only its note and is skipped when the Asset is no longer Overdue on the tagged Checkout (see
 * automaticCheckin). A 429 waits out its Retry-After and tries again. It stops when cancelled or switched off. One
 * notification of those checked in; a Checkin that fails is only logged. No Undo.
 */
export function createAutomaticCheckin({ now, settings, lastRan, recordRan, connect, notify, log, wait = sleep }: {
  now: () => Date
  settings: () => JobSettings
  lastRan: () => string | undefined
  recordRan: (day: string) => void
  connect: () => AutomaticSession
  /** day: the day it ran ("YYYY-MM-DD"), for the Activity Report the click opens. */
  notify: (text: ReturnType<typeof automaticText>, day: string) => void
  log: (message: string) => void
  wait?: (ms: number) => Promise<unknown>
}) {
  // Set by each run's lookup; one run at a time (see daily).
  let session: AutomaticSession
  return daily({
    now, settings, last: lastRan, record: recordRan,
    lookUp: () => (session = connect()).outstanding(),
    at: (when, s) => (s.tempCheckout.automatic ? automaticToday(when, s) : null),
    onFound: async (rows, { day, at, cancelled }) => {
      const note = appNote('Automatic check-in', `Temp checkout not scanned back by ${clock(at)}`)
      // No last Checkout matches none, so it's skipped.
      const checkin = async (r: (typeof rows)[number]) => {
        for (let tries = 1; ; tries++) {
          try {
            return await session.checkin(r.id, r.lastCheckout ?? '', note)
          } catch (e) {
            const { kind, retryAfter = 60 } = e as Partial<Failure>
            if (kind !== 'rateLimited' || tries === TRIES) throw e
            await wait(retryAfter * 1000)
            if (cancelled()) return false
          }
        }
      }
      const done: string[] = []
      for (const [i, r] of rows.entries()) {
        if (i) await wait(PACE_MS)
        if (cancelled()) break
        try {
          if (await checkin(r)) done.push(r.assetTag)
        } catch (e) {
          log(`${r.assetTag}: ${(e as Error).message}`)
        }
      }
      if (done.length) notify(automaticText(done), day)
    },
  })
}
