// The End-of-day reminder (#62 §1–§7): once each School day at its end-of-day time, a desktop notification of the Temp
// checkouts still out. A second job on the main process's minute tick, beside the Report scheduler.
import { clock, endOn, stamp } from './calendar'
import type { Settings } from './config'

/** Tells the window to open the dashboard Overdue list with Temp only on (the reminder was clicked). */
export type ReminderApi = { onOpen(listener: () => void): () => void }

const LISTED = 10
/**
 * The notification: the count and Asset Tags (as given, most late first), at most 10 then "and N more". Never names:
 * notifications show on lock screens. automaticAt: Automatic check-in's time ("HH:MM") when it's on.
 */
export function reminderText(tags: string[], automaticAt?: string) {
  const more = tags.length - LISTED
  return {
    title: `${tags.length} Temp checkout${tags.length === 1 ? '' : 's'} still out`,
    body: [tags.slice(0, LISTED).join(', ') + (more > 0 ? ` and ${more} more` : ''),
      automaticAt && `Any still out at ${clock(automaticAt)} will be checked in automatically.`].filter(Boolean).join('\n'),
  }
}

/**
 * Each tick reads Settings. Past today's end-of-day time on a School day, with the reminder on, a connection set up and
 * today not yet recorded, it looks up the outstanding Temp checkouts Overdue now, records today, then notifies (none: no
 * notification). A failed lookup rejects (to be logged) and records nothing, so the next tick tries again until the day ends;
 * a missed day is never caught up. A tick still looking makes the next do nothing.
 */
export function createEndOfDayReminder({ now, settings, lastShown, recordShown, outstanding, notify }: {
  now: () => Date
  settings: () => Pick<Settings, 'hasToken' | 'tempCheckout' | 'schoolCalendar'>
  lastShown: () => string | undefined
  recordShown: (day: string) => void
  /** The outstanding Temp checkouts Overdue now, most late first: their Asset Tags. */
  outstanding: () => Promise<string[]>
  notify: (text: ReturnType<typeof reminderText>) => void
}) {
  let ticking = false
  return {
    async tick() {
      if (ticking) return
      const when = now()
      const [day, time] = stamp(when).split(' ')
      const { hasToken, tempCheckout, schoolCalendar } = settings()
      const end = endOn(when, { endOfDay: tempCheckout.endOfDay, calendar: schoolCalendar })
      if (!tempCheckout.reminder || !hasToken || !end || time < end || lastShown() === day) return
      ticking = true
      try {
        const tags = await outstanding()
        recordShown(day)
        if (tags.length) notify(reminderText(tags))
      } finally {
        ticking = false
      }
    },
  }
}
