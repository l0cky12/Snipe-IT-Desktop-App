import type { KeptSchedule, LastSend, SavedReport, Schedule, ScheduleKey, Scheduled } from './config'
import { exportTable, localDate, rowCount, shownColumns, viewColumns } from './export'
import type { Attachment, Mail } from './mail'
import { FORMATS, type ExportFormat } from './report'
import { REPORT_NAMES, type ReportKind, type ReportQuery, type SnipeIt } from './snipeit'

/** A Report to run: a Saved Report, by id, or a built-in Report with its filters. */
export type ReportRef = { saved: string } | { builtIn: ReportKind; query: ReportQuery }
/** A Report run to rows, as Export saves it. capped: more rows matched than a Report holds. */
export type ReportRun = { name: string; columns: string[]; rows: string[][]; capped: boolean }
export type ReportsApi = {
  /** Emails the Report to the Operator now, as the format's file (CSV until chosen); resolves to the address and the row count. */
  emailNow(ref: ReportRef, format?: ExportFormat): Promise<{ to: string; rows: number }>
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

// The Report scheduler: emails a Report to the Operator, and only to them at the Email settings' domain, now or when its schedule
// comes due (tick, every minute while the app runs). Each send captures its connection and Report definitions before
// any async work. Saving the connection or logging out cancels pending sends and the rest of the current tick.
export function createReportScheduler({ now, session, schedules, recordSend, failed }: {
  now: () => Date
  session: () => {
    run: (ref: ReportRef) => Promise<ReportRun>
    /** The Operator's Snipe-IT email address. */
    recipient: () => Promise<string>
    /** The domain Reports may be emailed to (reportDomain). */
    domain: string
    /** The Report as the format's file, named for the day. */
    attach: (report: ReportRun, format: ExportFormat, when: Date) => Promise<Attachment>
    send: (mail: Mail) => Promise<void>
  }
  schedules: () => Scheduled[]
  recordSend: (report: ScheduleKey, last: LastSend) => void
  /** A scheduled send failed (each try), with why. */
  failed: (error: string) => void
}): ReportsApi & { tick(): Promise<void>; cancelPending(): void } {
  let ticking = false
  let generation = 0
  const api = {
    cancelPending() { generation++ },
    /** Sends every Report that's due, one at a time, recording each result. A tick still sending makes the next do nothing. */
    async tick() {
      if (ticking) return
      ticking = true
      const started = generation
      try {
        const when = now()
        const at = when.toISOString()
        for (const { report, schedule } of schedules()) {
          if (!isDue(schedule, when)) continue
          const ref = 'saved' in report ? report : { builtIn: report.builtIn, query: rangeOf(schedule, when) }
          const last: LastSend = await api.emailNow(ref, schedule.format).then(({ rows }) => ({ at, rows }), (e: Error) => ({ at, error: e.message }))
          // Neither the old queue nor its result belongs to the new connection.
          if (started !== generation) return
          recordSend(report, last)
          if ('error' in last) failed(last.error)
        }
      } finally {
        ticking = false
      }
    },
    async emailNow(ref: ReportRef, format: ExportFormat = 'csv') {
      if (!Object.hasOwn(FORMATS, format)) throw new Error('Choose CSV, HTML or PDF.')
      const started = generation
      const { recipient, run, send, domain, attach } = session()
      const check = () => {
        if (started !== generation) throw new Error('Report email cancelled because the connection was saved or you logged out. Run it again after connecting.')
      }
      const to = await recipient()
      check()
      if (!to.toLowerCase().endsWith(`@${domain}`))
        throw new Error(`Reports are emailed only to @${domain} addresses, and your Snipe-IT email is ${to}. Student information mustn't leave the organisation; ask a Snipe-IT Superuser to change your email, or change the domain in Settings.`)
      const report = await run(ref)
      const when = now()
      const attachment = await attach(report, format, when)
      check()
      // No await between the check and SMTP handoff. A message already handed to SMTP cannot be recalled.
      await send({
        to,
        subject: `${report.name}, ${localDate(when)}`,
        text: `${report.name} has ${rowCount(report.rows.length)}. The ${FORMATS[format]} is attached.\n\n`
          + (report.capped ? `More rows matched than a Report holds, so only the first ${rowCount(report.rows.length)} are attached. Narrow the Report for the rest.\n\n` : '')
          + "It may hold student information. Under FERPA it must stay with authorized district staff: don't forward it outside the district, and delete it when you're done.\n",
        attachments: [attachment],
      })
      return { to, rows: report.rows.length }
    },
  }
  return api
}

/** Runs a Report to rows: a Saved Report as its List shows it (View, search, filters, sort, Columns), a built-in one as the Reports page does. */
export function reportRunner(client: Pick<SnipeIt, 'exportList' | 'report'>, savedReports: () => SavedReport[]) {
  return async (ref: ReportRef): Promise<ReportRun> => {
    if ('builtIn' in ref) {
      // From the screen over IPC; report() checks the query.
      if (!Object.hasOwn(REPORT_NAMES, ref.builtIn)) throw new Error(`Unknown report: ${ref.builtIn}`)
      return { name: REPORT_NAMES[ref.builtIn], ...await client.report(ref.builtIn, ref.query) }
    }
    const r = savedReports().find((s) => s.id === ref.saved)
    if (!r) throw new Error('That Saved Report no longer exists.')
    // A template runs the Custom Asset Report with its columns and filters, under its name.
    if (r.kind === 'custom') return { name: r.name, ...await client.report('custom', { columns: r.columns, filters: r.filters }) }
    // Its View's route, or its in-app lookup (Out on temp, Overdue), with the View's own column.
    const { rows, capped } = await client.exportList(r.kind, { search: r.search, filters: r.filters, sort: r.sort?.key, order: r.sort?.order, ...(r.view && { view: r.view }) })
    const shown = shownColumns(r.kind, r.columns)
    return { name: r.name, ...exportTable(r.kind, r.view ? viewColumns(shown, r.view) : shown, rows), capped }
  }
}
