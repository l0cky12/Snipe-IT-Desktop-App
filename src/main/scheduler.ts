import type { SavedReport } from './config'
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

// The Report scheduler: emails a Report to the Operator, and only to them at REPORT_DOMAIN. now, run, recipient and
// send are passed in so it can be tested on a fake clock and sender.
export function createReportScheduler({ now, run, recipient, send }: {
  now: () => Date
  run: (ref: ReportRef) => Promise<ReportRun>
  /** The Operator's Snipe-IT email address. */
  recipient: () => Promise<string>
  send: (mail: Mail) => Promise<void>
}): ReportsApi {
  return {
    async emailNow(ref) {
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
