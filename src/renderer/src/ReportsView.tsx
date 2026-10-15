import { useEffect, useRef, useState } from 'react'
import type { KeptSchedule, LastSend, SavedReport, Schedule, ScheduleKey, Scheduled } from '../../main/config'
import type { ReportRef } from '../../main/scheduler'
import { choices as filterChoices, listName } from './ListView'
import { rowCount } from '../../main/export'
import { FORMATS, type ExportFormat } from '../../main/report'
import { ACTIVITY_ACTIONS, ACTIVITY_ITEM_TYPES, actionLabel, ASSET_VIEWS, itemTypeName, LOCATION_CATEGORY_REPORTS, REPORT_NAMES, REPORTS, takesRange, type Report, type ReportKind, type ReportQuery, type StatusLabel } from '../../main/snipeit'

// What the date range bounds in each report; a snapshot Report has none.
const rangeName: Partial<Record<ReportKind, string>> = { activity: 'When', overdue: 'Expected Checkin', expiring: 'Warranty ends', auditDue: 'Next audit', auditLate: 'Next audit', lastAudited: 'Last audited', endOfLife: 'End of life', maintenances: 'Started', tempHistory: 'Checked out' }

/** Saves a List or Report as a CSV, HTML or PDF file where the Operator chooses; false when they cancel. name: what it holds, e.g. "Activity Report". */
export const saveExport = (format: ExportFormat, name: string, columns: string[], rows: string[][]) => window.exporter.save({ format, name, columns, rows })

// Asked before saving: which file to make and, for rows that hold Users or Assignees (ferpa), that it stays in the district.
export function ExportConfirm({ rows, ferpa, onExport, onCancel }: { rows: number; ferpa: boolean; onExport: (format: ExportFormat) => void; onCancel: () => void }) {
  return (
    <div className="ferpa" role={ferpa ? 'alertdialog' : 'dialog'} aria-labelledby="export-heading">
      {ferpa
        ? <p><b id="export-heading">This export includes student information.</b> Under FERPA it must stay with authorized district staff: don't email it outside the district,
          post it, or save it to a shared or personal drive, and delete it when you're done.</p>
        : <p><b id="export-heading">Export {rows.toLocaleString()} rows.</b> HTML and PDF carry your organisation's name and icon.</p>}
      <div className="actions">
        <span>{ferpa ? `I understand, export ${rows.toLocaleString()} rows as` : 'Save as'}</span>
        {(Object.keys(FORMATS) as ExportFormat[]).map((f) => <button key={f} onClick={() => onExport(f)}>{f.toUpperCase()}</button>)}
        <button className="quiet" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  )
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const ordinal = (n: number) => n + ((n % 100 >= 11 && n % 100 <= 13) ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th')
const RANGE_NAMES = { 1: 'the previous day', 7: 'the previous 7 days', 30: 'the previous 30 days', since: 'since the last send' } as const
/** When a Report emails itself, e.g. "Weekly on Mondays at 07:00 · the previous 7 days". */
export function scheduleText({ every, day = 1, time, range }: Schedule) {
  const when = every === 'day' ? 'Daily' : every === 'week' ? `Weekly on ${WEEKDAYS[day]}s`
    : `Monthly on the ${ordinal(day)}${day > 28 ? " (or the month's last day)" : ''}`
  return `${when} at ${time}${range === undefined ? '' : ` · ${RANGE_NAMES[range]}`}`
}
/** How a scheduled send went, e.g. "Last sent Oct 5, 7:00 AM: 3 rows". */
export function lastSendText(last: LastSend) {
  const at = new Date(last.at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  return 'rows' in last ? `Last sent ${at}: ${rowCount(last.rows)}` : `Last send failed ${at}: ${last.error}`
}
const keyOf = (r: ScheduleKey) => ('saved' in r ? `saved:${r.saved}` : r.builtIn)

// A Report's schedule and its last send, changed in place.
function ScheduleCell({ report, schedule, name, onChange }: { report: ScheduleKey; schedule?: KeptSchedule; name: string; onChange: (all: Scheduled[]) => void }) {
  const [editing, setEditing] = useState(false)
  if (editing) return <ScheduleForm report={report} schedule={schedule} name={name} onDone={(all) => (all && onChange(all), setEditing(false))} />
  return (
    <div className="schedule">
      <span>{schedule ? scheduleText(schedule) : <span className="dim">Not scheduled</span>}</span>
      {schedule && <span className={schedule.last && 'error' in schedule.last ? 'field-error' : 'dim'}>{schedule.last ? lastSendText(schedule.last) : 'Not sent yet'}</span>}
      <div className="actions"><button className="quiet" onClick={() => setEditing(true)}>{schedule ? 'Change schedule…' : 'Schedule…'}</button></div>
    </div>
  )
}

// onDone: the schedules after saving or stopping, or nothing when cancelled. range: the schedule sets the Report's dates (see Schedule).
function ScheduleForm({ report, schedule, name, onDone }: { report: ScheduleKey; schedule?: KeptSchedule; name: string; onDone: (all?: Scheduled[]) => void }) {
  const range = takesRange(report)
  const [s, setS] = useState<Schedule>(schedule ?? { every: 'week', day: 1, time: '07:00', ...(range && { range: 7 }) })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function save(next: Schedule | null) {
    setBusy(true)
    try {
      onDone(await window.settings.setSchedule(report, next))
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }
  function setRange(v: string) {
    const { range: _, ...rest } = s
    setS(v ? { ...rest, range: v === 'since' ? 'since' : Number(v) as 1 | 7 | 30 } : rest)
  }
  return (
    <form className="schedule" onSubmit={(e) => (e.preventDefault(), save(s))} aria-label={`Schedule ${name}`}>
      <div className="actions">
        <select value={s.every} onChange={(e) => setS({ ...s, every: e.target.value as Schedule['every'], day: 1 })} aria-label="How often">
          <option value="day">Daily</option><option value="week">Weekly</option><option value="month">Monthly</option>
        </select>
        {s.every === 'week' && (
          <select value={s.day} onChange={(e) => setS({ ...s, day: Number(e.target.value) })} aria-label="Day of the week">
            {WEEKDAYS.map((d, i) => <option key={d} value={i}>on {d}s</option>)}
          </select>
        )}
        {s.every === 'month' && (
          <select value={s.day} onChange={(e) => setS({ ...s, day: Number(e.target.value) })} aria-label="Date">
            {Array.from({ length: 31 }, (_, i) => <option key={i} value={i + 1}>on the {ordinal(i + 1)}</option>)}
          </select>
        )}
        <label className="range">at <input type="time" required value={s.time} onChange={(e) => setS({ ...s, time: e.target.value })} /></label>
        {range && (
          <select value={s.range ?? ''} onChange={(e) => setRange(e.target.value)} aria-label="Date range">
            <option value="">All dates</option>
            <option value="1">Previous day</option><option value="7">Previous 7 days</option><option value="30">Previous 30 days</option><option value="since">Since the last send</option>
          </select>
        )}
      </div>
      {s.every === 'month' && s.day! > 28 && <span className="dim">In a shorter month it sends on the month's last day.</span>}
      {'builtIn' in report && report.builtIn === 'activity' && <span className="dim">It sends every record type and action.</span>}
      {'builtIn' in report && LOCATION_CATEGORY_REPORTS.includes(report.builtIn) && <span className="dim">It sends every Location and Category.</span>}
      <div className="actions">
        <button disabled={busy}>Save schedule</button>
        {schedule && <button type="button" className="quiet danger" disabled={busy} onClick={() => save(null)}>Stop schedule</button>}
        <button type="button" className="quiet" onClick={() => onDone()}>Cancel</button>
      </div>
      {error && <p className="field-error" role="alert">{error}</p>}
    </form>
  )
}

// Every Report's Schedule, built-in Reports then Saved Reports; shown in Settings. Read again each minute so a send
// the scheduler just made (or failed) shows.
export function ScheduledReports() {
  const [schedules, setSchedules] = useState<Scheduled[]>([])
  const [saved, setSaved] = useState<SavedReport[]>([])
  const [error, setError] = useState('')
  useEffect(() => {
    const fail = (e: Error) => setError(e.message)
    const load = () => window.settings.schedules().then(setSchedules, fail)
    load()
    window.settings.savedReports().then(setSaved, fail)
    const timer = setInterval(load, 60_000)
    return () => clearInterval(timer)
  }, [])
  const rows: { report: ScheduleKey; name: string }[] = [
    ...REPORTS.map((k) => ({ report: { builtIn: k }, name: REPORT_NAMES[k] })),
    ...saved.map((r) => ({ report: { saved: r.id }, name: r.name })),
  ]
  return (
    <section className="settings-section scheduled-reports">
      <h2>Scheduled Reports</h2><p className="dim">Reports emailed to you on a schedule, through the Email settings above.</p>
      {error && <p className="message error" role="alert">{error}</p>}
      <table className="history">
        <tbody>
          {rows.map(({ report, name }) => (
            <tr key={keyOf(report)}>
              <td>{name}</td>
              <td><ScheduleCell report={report} schedule={schedules.find((s) => keyOf(s.report) === keyOf(report))?.schedule} name={name} onChange={setSchedules} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

type Notice = { text: string; error?: true }
// Emails the Report to the Operator now (the main process runs it afresh); what happened shows as the page's notice.
function EmailNow({ report, name, onDone }: { report: ReportRef; name: string; onDone: (notice: Notice) => void }) {
  const [busy, setBusy] = useState(false)
  async function send() {
    setBusy(true)
    try {
      const { to, rows } = await window.reports.emailNow(report)
      onDone({ text: `Emailed ${name} (${rowCount(rows)}) to ${to}` })
    } catch (e) {
      onDone({ text: `${name} wasn't emailed. ${(e as Error).message}`, error: true })
    }
    setBusy(false)
  }
  return <button className="quiet" disabled={busy} onClick={send}>{busy ? 'Emailing…' : 'Email me now'}</button>
}

// Runs when asked (a report can page through a lot), not on every change of a filter. A Saved Report opens as its List.
// A Location or Category picker's options: names shared by two choices (two buildings' "Room 101") get their ids, as in the list filters.
export function pickerOptions(label: string, list: StatusLabel[] = []) {
  return filterChoices({ label, options: list.map((l) => ({ value: String(l.id), label: l.name })) })
}

/** A Report and its filters for the Reports page to open on, and run. */
export type ReportStart = { kind: ReportKind; query: ReportQuery }
/** A day's automatic check-ins ("YYYY-MM-DD"): what Automatic check-in's notification opens. */
export const automaticCheckins = (day: string): ReportStart =>
  ({ kind: 'activity', query: { from: day, to: day, itemType: 'asset', actionType: 'checkin from', search: 'Automatic check-in' } })
/** A week's Asset Checkouts (its Monday, "YYYY-MM-DD", through Sunday): what a week of the dashboard's Checkouts over time opens. */
export function weekCheckouts(monday: string): ReportStart {
  const sunday = new Date(`${monday}T00:00Z`)
  sunday.setUTCDate(sunday.getUTCDate() + 6)
  return { kind: 'activity', query: { from: monday, to: sunday.toISOString().slice(0, 10), itemType: 'asset', actionType: 'checkout' } }
}
/** The filters the Report has: only the Activity Report narrows by record type, action and search, only LOCATION_CATEGORY_REPORTS by Location and Category. */
export const reportFilters = (kind: ReportKind, query: ReportQuery): ReportQuery => ({
  ...(rangeName[kind] && { from: query.from, to: query.to }),
  ...(kind === 'activity' && { itemType: query.itemType, actionType: query.actionType, search: query.search }),
  ...(LOCATION_CATEGORY_REPORTS.includes(kind) && { locationId: query.locationId, categoryId: query.categoryId }),
})

// start: opened on that Report and its filters, run at once.
export function ReportsView({ start, onOpenSaved }: { start?: ReportStart; onOpenSaved: (report: SavedReport) => void }) {
  const [kind, setKind] = useState<ReportKind>(start?.kind ?? 'activity')
  const [query, setQuery] = useState<ReportQuery>(start?.query ?? {})
  const [report, setReport] = useState<Report | null>(null)
  const [ran, setRan] = useState<{ kind: ReportKind; query: ReportQuery } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [exporting, setExporting] = useState(false)
  const [notice, setNotice] = useState<Notice | null>(null)
  // Whether the chosen report narrows to a Location and a Category, and their choices, loaded the first time one is chosen;
  // a list that doesn't load just leaves fewer choices.
  const placeFilters = LOCATION_CATEGORY_REPORTS.includes(kind)
  const [choices, setChoices] = useState<{ locations: StatusLabel[]; categories: StatusLabel[] } | null>(null)
  useEffect(() => {
    if (!placeFilters || choices) return
    setChoices({ locations: [], categories: [] })
    window.snipeIt.locations().then((locations) => setChoices((c) => ({ categories: [], ...c, locations })), () => {})
    window.snipeIt.names('categories').then((categories) => setChoices((c) => ({ locations: [], ...c, categories })), () => {})
  }, [placeFilters, choices])
  const sent = reportFilters(kind, query)
  // Bumped by every run and every change of report or filter; a result for an older one is dropped, so what shows
  // (and what exports) always matches the filters on screen.
  const latest = useRef(0)
  const stale = () => (latest.current++, setReport(null), setRan(null), setExporting(false), setBusy(false), setError(''))
  const set = (change: ReportQuery) => (setQuery((q) => ({ ...q, ...change })), stale())

  async function run(e?: React.FormEvent) {
    e?.preventDefault()
    const mine = ++latest.current
    setBusy(true)
    setError('')
    setExporting(false)
    try {
      const r = await window.snipeIt.report(kind, sent)
      if (mine !== latest.current) return
      setReport(r)
      setRan({ kind, query })
    } catch (err) {
      if (mine !== latest.current) return
      setReport(null)
      setError((err as Error).message)
    } finally {
      if (mine === latest.current) setBusy(false)
    }
  }

  // Opened on a starting query: run it once.
  useEffect(() => { if (start) run() }, [])

  async function download(r: Report, what: ReportKind, format: ExportFormat) {
    setExporting(false)
    if (await saveExport(format, REPORT_NAMES[what], r.columns, r.rows)) setNotice({ text: `Exported ${rowCount(r.rows.length)}.` })
  }

  return (
    <>
      <header className="head">
        <h1>Reports</h1>
        <span className="dim">{busy ? 'Loading…' : report && ran && `${report.rows.length.toLocaleString()} rows`}</span>
        <div className="actions">
          <button className="quiet" disabled={!report?.rows.length || busy} onClick={() => setExporting((x) => !x)} aria-expanded={exporting}>Export…</button>
          <EmailNow report={{ builtIn: kind, query: sent }} name={REPORT_NAMES[kind]} onDone={setNotice} />
        </div>
        <form className="actions" onSubmit={run}>
          <select value={kind} onChange={(e) => (setKind(e.target.value as ReportKind), stale())} aria-label="Report">
            {(Object.keys(REPORT_NAMES) as ReportKind[]).map((k) => <option key={k} value={k}>{REPORT_NAMES[k]}</option>)}
          </select>
          {rangeName[kind] && (
            <>
              <label className="range">{rangeName[kind]} from <input type="date" value={query.from ?? ''} onChange={(e) => set({ from: e.target.value })} /></label>
              <label className="range">to <input type="date" value={query.to ?? ''} onChange={(e) => set({ to: e.target.value })} /></label>
            </>
          )}
          {kind === 'activity' && (
            <>
              <select value={query.itemType ?? ''} onChange={(e) => set({ itemType: e.target.value })} aria-label="Record type">
                <option value="">Any record type</option>
                {ACTIVITY_ITEM_TYPES.map((t) => <option key={t} value={t}>{itemTypeName[t]}</option>)}
              </select>
              <select value={query.actionType ?? ''} onChange={(e) => set({ actionType: e.target.value })} aria-label="Action">
                <option value="">Any action</option>
                {ACTIVITY_ACTIONS.map((a) => <option key={a} value={a}>{actionLabel(a)}</option>)}
              </select>
              <input type="search" value={query.search ?? ''} onChange={(e) => set({ search: e.target.value })} placeholder="Search" aria-label="Search" />
            </>
          )}
          {placeFilters && (
            <>
              <select value={query.locationId ?? ''} onChange={(e) => set({ locationId: e.target.value })} aria-label="Location">
                <option value="">Any Location</option>
                {pickerOptions('Any Location', choices?.locations).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              <select value={query.categoryId ?? ''} onChange={(e) => set({ categoryId: e.target.value })} aria-label="Category">
                <option value="">Any Category</option>
                {pickerOptions('Any Category', choices?.categories).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </>
          )}
          {kind === 'auditDue' && <span className="dim">How far ahead comes from Snipe-IT's Audit warning setting.</span>}
          <button disabled={busy}>{busy ? 'Running…' : 'Run report'}</button>
        </form>
      </header>
      {exporting && report && ran && (
        <ExportConfirm ferpa rows={report.rows.length} onExport={(f) => download(report, ran.kind, f)} onCancel={() => setExporting(false)} />
      )}
      {error && <p className="message error" role="alert">{error}</p>}
      {notice && <p className={`message ${notice.error ? 'error' : 'list-message'}`} role={notice.error ? 'alert' : 'status'}>{notice.text}</p>}
      <SavedReports onOpen={onOpenSaved} onEmailed={setNotice} />
      {report?.capped && <p className="message notice" role="status">Only the newest {report.rows.length.toLocaleString()} rows are shown; narrow the dates for the rest.</p>}
      {report && (
        <table className="history list-table">
          <thead><tr>{report.columns.map((c) => <th key={c}>{c}</th>)}</tr></thead>
          <tbody>{report.rows.map((r, i) => <tr key={i}>{r.map((v, j) => <td key={j}>{v || '—'}</td>)}</tr>)}</tbody>
        </table>
      )}
      {report && report.rows.length === 0 && <p className="empty">Nothing matches</p>}
      {!report && !error && !busy && <p className="empty">Choose a report and run it</p>}
    </>
  )
}

// The Operator's Saved Reports, each opening as its List, emailed now, renamed in place, or deleted after asking. Schedules are in Settings.
function SavedReports({ onOpen, onEmailed }: { onOpen: (report: SavedReport) => void; onEmailed: (notice: Notice) => void }) {
  const [reports, setReports] = useState<SavedReport[] | null>(null)
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [error, setError] = useState('')
  useEffect(() => { window.settings.savedReports().then(setReports, (e: Error) => setError(e.message)) }, [])
  const change = async (work: Promise<SavedReport[]>) => {
    try {
      setReports(await work)
      setRenaming(null)
      setDeleting(null)
      setError('')
    } catch (e) {
      setError((e as Error).message)
    }
  }
  return (
    <section className="saved-reports" aria-label="Saved Reports">
      <h2>Saved Reports</h2>
      {error && <p className="message error" role="alert">{error}</p>}
      {reports?.length === 0 && <p className="dim">None yet. Save any List as a report with its Save report button.</p>}
      {!!reports?.length && (
        <table className="history">
          <tbody>
            {reports.map((r) => (
              <tr key={r.id}>
                <td>
                  {renaming?.id === r.id ? (
                    <form className="actions" onSubmit={(e) => (e.preventDefault(), change(window.settings.renameReport(r.id, renaming.name)))}>
                      <input autoFocus value={renaming.name} onChange={(e) => setRenaming({ id: r.id, name: e.target.value })}
                        onKeyDown={(e) => e.key === 'Escape' && setRenaming(null)} aria-label={`New name for ${r.name}`} />
                      <button disabled={!renaming.name.trim()}>Rename</button>
                      <button type="button" className="quiet" onClick={() => setRenaming(null)}>Cancel</button>
                    </form>
                  ) : <button className="link" onClick={() => onOpen(r)}>{r.name}</button>}
                </td>
                <td className="dim">{listName[r.kind]}{r.view && `, ${ASSET_VIEWS[r.view].name}`}</td>
                <td><div className="actions">
                  {deleting === r.id ? (
                    <span className="confirm" role="alertdialog" aria-label={`Delete ${r.name}?`}>
                      <span>Delete "{r.name}"?</span>
                      <button className="danger" autoFocus onClick={() => change(window.settings.deleteReport(r.id))}>Delete</button>
                      <button className="quiet" onClick={() => setDeleting(null)}>Cancel</button>
                    </span>
                  ) : (
                    <>
                      <EmailNow report={{ saved: r.id }} name={r.name} onDone={onEmailed} />
                      <button className="quiet" onClick={() => (setDeleting(null), setRenaming({ id: r.id, name: r.name }))}>Rename</button>
                      <button className="quiet danger" onClick={() => (setRenaming(null), setDeleting(r.id))}>Delete…</button>
                    </>
                  )}
                </div></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}
