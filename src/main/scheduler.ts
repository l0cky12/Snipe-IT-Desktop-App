import type { KeptSchedule, LastSend, SavedReport, Schedule, ScheduleKey, Scheduled } from './config'
import { csvName, exportTable, localDate, rowCount, shownColumns, toCsv } from './export'
import type { Mail } from './mail'
import { REPORT_NAMES, type ReportKind, type ReportQuery, type SnipeIt } from './snipeit'

/** Reports are emailed only to an Operator at this domain, so student information stays in the district. Not a setting. */
export const REPORT_DOMAIN = 'nomma.net'

/** A Report to run: a Saved Report, by id, or a built-in Report with its filters. */
export type ReportRef = { saved: string } | { builtIn: ReportKind; query: ReportQuery }
/** A Report run to rows, as Export saves it. capped: more rows matched than a Report holds. */
export type ReportRun = { name: string; columns: string[]; rows: string[][]; capped: boolean }
export type ReportsApi = {
  /** Emails the Report to the Operator now; resolves to the address and the row count. */
  emailNow(ref: ReportRef): Promise<{ to: string; rows: number }>
}

// The latest time the schedule came due, at or before `when`.
function lastDue({ every, day = 0, time }: Schedule, when: Date): Date {
  const [h, m] = time.split(':').map(Number)
  const [y, mo, d] = [when.getFullYear(), when.getMonth(), when.getDate()]
  // The time it comes due `back` days, weeks or months before the current one.
  const due = (back: number) => every === 'month' ? new Date(y, mo - back, Math.min(day, new Date(y, mo - back + 1, 0).getDate()), h, m)
    : every === 'week' ? new Date(y, mo, d - (when.getDay() - day + 7) % 7 - 7 * back, h, m)
    : new Date(y, mo, d - back, h, m)
  return due(0) <= when ? due(0) : due(1)
}
const RETRY_MS = 60 * 60_000
// Due once it has come due since it was set and since its last send, so sends missed while the app was closed go out
// as one. A failed send (a catch-up at launch before the network is up, a mail server down) tries again each hour
// until it goes out. ponytail: hourly, however it failed; back off if a long-failing Report runs too often.
function isDue(s: KeptSchedule, when: Date) {
  const due = lastDue(s, when).getTime()
  if (due > Math.max(Date.parse(s.since), s.last ? Date.parse(s.last.at) : 0)) return true
  return !!s.last && 'error' in s.last && when.getTime() - Date.parse(s.last.at) >= RETRY_MS && due > Date.parse(s.sentAt ?? s.since)
}
// A built-in Report's dates for a send at `when`: whole days before that day, or from the day of the last send that went out.
function rangeOf({ range, since, sentAt }: KeptSchedule, when: Date): ReportQuery {
  if (range === undefined) return {}
  const daysBack = (n: number) => localDate(new Date(when.getFullYear(), when.getMonth(), when.getDate() - n))
  return range === 'since' ? { from: localDate(new Date(sentAt ?? since)), to: daysBack(0) } : { from: daysBack(range), to: daysBack(1) }
}

// The Report scheduler: emails a Report to the Operator, and only to them at REPORT_DOMAIN, now or when its schedule
// comes due (tick, every minute while the app runs). now, run, recipient, send, the schedules and failed are passed in
// so it can be tested on a fake clock and sender.
export function createReportScheduler({ now, run, recipient, send, schedules, recordSend, failed }: {
  now: () => Date
  run: (ref: ReportRef) => Promise<ReportRun>
  /** The Operator's Snipe-IT email address. */
  recipient: () => Promise<string>
  send: (mail: Mail) => Promise<void>
  schedules: () => Scheduled[]
  recordSend: (report: ScheduleKey, last: LastSend) => void
  /** A scheduled send failed (each try), with why. */
  failed: (error: string) => void
}): ReportsApi & { tick(): Promise<void> } {
  let ticking = false
  const api = {
    /** Sends every Report that's due, one at a time, recording each result. A tick still sending makes the next do nothing. */
    async tick() {
      if (ticking) return
      ticking = true
      try {
        const when = now()
        const at = when.toISOString()
        for (const { report, schedule } of schedules()) {
          if (!isDue(schedule, when)) continue
          const ref = 'saved' in report ? report : { builtIn: report.builtIn, query: rangeOf(schedule, when) }
          const last: LastSend = await api.emailNow(ref).then(({ rows }) => ({ at, rows }), (e: Error) => ({ at, error: e.message }))
          recordSend(report, last)
          if ('error' in last) failed(last.error)
        }
      } finally {
        ticking = false
      }
    },
    async emailNow(ref: ReportRef) {
      const to = await recipient()
      if (!to.toLowerCase().endsWith(`@${REPORT_DOMAIN}`))
        throw new Error(`Reports are emailed only to @${REPORT_DOMAIN} addresses, and your Snipe-IT email is ${to}. Student information mustn't leave the district; ask a Snipe-IT Superuser to change your email.`)
      const report = await run(ref)
      const when = now()
      await send({
        to,
        subject: `${report.name}, ${localDate(when)}`,
        text: `${report.name} has ${rowCount(report.rows.length)}. The CSV is attached.\n\n`
          + (report.capped ? `More rows matched than a Report holds, so only the first ${rowCount(report.rows.length)} are attached. Narrow the Report for the rest.\n\n` : '')
          + "It may hold student information. Under FERPA it must stay with authorized district staff: don't forward it outside the district, and delete it when you're done.\n",
        attachments: [{ filename: csvName(report.name, when), content: toCsv(report.columns, report.rows), contentType: 'text/csv; charset=utf-8' }],
      })
      return { to, rows: report.rows.length }
    },
  }
  return api
}

/** Runs a Report to rows: a Saved Report as its List shows it (search, filters, sort, Columns), a built-in one as the Reports page does. */
export function reportRunner(client: Pick<SnipeIt, 'exportList' | 'report'>, savedReports: () => SavedReport[]) {
  return async (ref: ReportRef): Promise<ReportRun> => {
    if ('builtIn' in ref) {
      // From the screen over IPC; report() checks the query.
      if (!Object.hasOwn(REPORT_NAMES, ref.builtIn)) throw new Error(`Unknown report: ${ref.builtIn}`)
      return { name: REPORT_NAMES[ref.builtIn], ...await client.report(ref.builtIn, ref.query) }
    }
    const r = savedReports().find((s) => s.id === ref.saved)
    if (!r) throw new Error('That Saved Report no longer exists.')
    const { rows, capped } = await client.exportList(r.kind, { search: r.search, filters: r.filters, sort: r.sort?.key, order: r.sort?.order })
    return { name: r.name, ...exportTable(r.kind, shownColumns(r.kind, r.columns), rows), capped }
  }
}
