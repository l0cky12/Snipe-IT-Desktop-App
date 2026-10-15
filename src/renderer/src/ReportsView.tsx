import { useEffect, useRef, useState } from 'react'
import type { KeptSchedule, LastSend, SavedListReport, SavedReport, Schedule, ScheduleKey, Scheduled } from '../../main/config'
import type { ReportRef } from '../../main/scheduler'
import { choices as filterChoices, listName } from './ListView'
import { csvName, rowCount, toCsv } from '../../main/export'
import { ACTIVITY_ACTIONS, ACTIVITY_ITEM_TYPES, actionLabel, ASSET_VIEWS, CUSTOM_COLUMN_GROUPS, CUSTOM_DATE_LABELS, itemTypeName, LOCATION_CATEGORY_REPORTS, REPORT_NAMES, REPORTS, takesRange,
  type CustomColumn, type NamesKind, type Report, type ReportKind, type ReportQuery, type StatusLabel } from '../../main/snipeit'

// What the date range bounds in each report; a snapshot Report has none.
const rangeName: Partial<Record<ReportKind, string>> = { activity: 'When', overdue: 'Expected Checkin', expiring: 'Warranty ends', auditDue: 'Next audit', auditLate: 'Next audit', lastAudited: 'Last audited', endOfLife: 'End of life', maintenances: 'Started', tempHistory: 'Checked out' }

// Saves a CSV where the Operator chooses; nothing is written without that. name: what it holds, e.g. "Activity Report".
export function saveCsv(name: string, columns: string[], rows: string[][]) {
  const url = URL.createObjectURL(new Blob([toCsv(columns, rows)], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = csvName(name, new Date())
  a.click()
  URL.revokeObjectURL(url)
}

// Asked before saving rows that hold Users or Assignees.
export function FerpaConfirm({ rows, onExport, onCancel }: { rows: number; onExport: () => void; onCancel: () => void }) {
  return (
    <div className="ferpa" role="alertdialog" aria-labelledby="ferpa-heading">
      <p><b id="ferpa-heading">This export includes student information.</b> Under FERPA it must stay with authorized district staff: don't email it outside the district,
        post it, or save it to a shared or personal drive, and delete it when you're done.</p>
      <div className="actions">
        <button onClick={onExport}>I understand, export {rows.toLocaleString()} rows</button>
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
    // The Custom Asset Report is scheduled as a template (a Saved Report), which has columns to send.
    ...REPORTS.filter((k) => k !== 'custom').map((k) => ({ report: { builtIn: k }, name: REPORT_NAMES[k] })),
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
/** The Custom Asset Report's columns until the Operator changes them: every standard one, as Snipe-IT's form starts. */
export const DEFAULT_CUSTOM_COLUMNS = CUSTOM_COLUMN_GROUPS.flatMap((g) => g.columns.map((c) => c.key))
/** The filters the Report has: only the Activity Report narrows by record type, action and search, only LOCATION_CATEGORY_REPORTS by Location and Category,
 * and only the Custom Asset Report has columns and filters of its own. */
export const reportFilters = (kind: ReportKind, query: ReportQuery): ReportQuery => ({
  ...(rangeName[kind] && { from: query.from, to: query.to }),
  ...(kind === 'activity' && { itemType: query.itemType, actionType: query.actionType, search: query.search }),
  ...(LOCATION_CATEGORY_REPORTS.includes(kind) && { locationId: query.locationId, categoryId: query.categoryId }),
  ...(kind === 'custom' && { columns: query.columns ?? DEFAULT_CUSTOM_COLUMNS, filters: query.filters ?? {} }),
})

// The Custom Asset Report's form: its columns, grouped as Snipe-IT's form groups them (the Custom Fields from Snipe-IT),
// and its filters (see CUSTOM_FILTERS). The choice lists load once; one that doesn't load just leaves fewer choices.
const PICKS: [key: string, label: string, names: NamesKind][] = [
  ['company_id', 'Company', 'companies'], ['location_id', 'Location', 'locations'], ['rtd_location_id', 'Default Location', 'locations'], ['supplier_id', 'Supplier', 'suppliers'],
  ['model_id', 'Asset Model', 'models'], ['manufacturer_id', 'Manufacturer', 'manufacturers'], ['category_id', 'Category', 'categories'], ['status_id', 'Status Label', 'statuslabels'],
]
function CustomReportForm({ columns, filters, onColumns, onFilter }: { columns: string[]; filters: Record<string, string>; onColumns: (columns: string[]) => void; onFilter: (key: string, value: string) => void }) {
  const [names, setNames] = useState<Partial<Record<NamesKind, StatusLabel[]>>>({})
  const [fields, setFields] = useState<CustomColumn[] | null>(null)
  useEffect(() => {
    let stale = false
    for (const n of new Set(PICKS.map(([, , names]) => names))) window.snipeIt.names(n).then((v) => !stale && setNames((all) => ({ ...all, [n]: v })), () => {})
    window.snipeIt.customFieldList().then((v) => !stale && setFields(v), () => !stale && setFields([]))
    return () => { stale = true }
  }, [])
  const groups = [...CUSTOM_COLUMN_GROUPS, { name: 'Custom Fields', columns: fields ?? [] }]
  const all = groups.flatMap((g) => g.columns.map((c) => c.key))
  // Columns stay in the form's order, whatever order they were ticked in; a template's column the form doesn't show stays too.
  const toggle = (key: string) => {
    const next = new Set(columns.includes(key) ? columns.filter((k) => k !== key) : [...columns, key])
    onColumns([...all.filter((k) => next.has(k)), ...[...next].filter((k) => !all.includes(k))])
  }
  const range = (label: string, type: 'date' | 'number', fromKey: string, toKey: string) => (
    <label key={fromKey}>{label}<span className="range">
      <input type={type} {...(type === 'number' && { min: 0, step: 0.01 })} value={filters[fromKey] ?? ''} onChange={(e) => onFilter(fromKey, e.target.value)} aria-label={`${label} from`} /> to
      <input type={type} {...(type === 'number' && { min: 0, step: 0.01 })} value={filters[toKey] ?? ''} onChange={(e) => onFilter(toKey, e.target.value)} aria-label={`${label} to`} />
    </span></label>
  )
  return (
    <div className="customize custom-report" aria-label="Custom Asset Report">
      {groups.map((g) => (
        <ol key={g.name} aria-label={`${g.name} columns`}>
          <li className="k">{g.name}{g.name === 'Asset' && <span className="actions"><button type="button" onClick={() => onColumns(all)}>All</button><button type="button" onClick={() => onColumns([])}>None</button></span>}</li>
          {g.columns.map((c) => (
            <li key={c.key}><label><input type="checkbox" checked={columns.includes(c.key)} onChange={() => toggle(c.key)} />{c.label}</label></li>
          ))}
          {g.name === 'Custom Fields' && !g.columns.length && <li className="dim">{fields ? 'None' : 'Loading…'}</li>}
        </ol>
      ))}
      <div className="ranges">
        <span className="k">Filters</span>
        {PICKS.map(([key, label, n]) => (
          <label key={key}>{label}<select value={filters[key] ?? ''} onChange={(e) => onFilter(key, e.target.value)}>
            <option value="">Any</option>
            {pickerOptions(`Any ${label}`, names[n]).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select></label>
        ))}
        <label>Order number<input value={filters.order_number ?? ''} onChange={(e) => onFilter('order_number', e.target.value)} /></label>
        {range('Purchase cost', 'number', 'purchase_cost_min', 'purchase_cost_max')}
        {Object.entries(CUSTOM_DATE_LABELS).map(([key, label]) => range(label, 'date', `${key}_from`, `${key}_to`))}
        <label>Checked out<select value={filters.assignment ?? ''} onChange={(e) => onFilter('assignment', e.target.value)}>
          <option value="">Either</option><option value="assigned">Checked out</option><option value="unassigned">Not checked out</option>
        </select></label>
        <label>Deleted Assets<select value={filters.deleted ?? ''} onChange={(e) => onFilter('deleted', e.target.value)}>
          <option value="">Left out</option><option value="include">Included</option><option value="only">Only deleted</option>
        </select></label>
        <label className="check"><input type="checkbox" checked={filters.exclude_archived === '1'} onChange={(e) => onFilter('exclude_archived', e.target.checked ? '1' : '')} />Leave out Archived Assets</label>
      </div>
    </div>
  )
}

// start: opened on that Report and its filters, run at once.
export function ReportsView({ start, onOpenSaved }: { start?: ReportStart; onOpenSaved: (report: SavedListReport) => void }) {
  const [kind, setKind] = useState<ReportKind>(start?.kind ?? 'activity')
  // The template (a Custom Asset Report saved under a name) opened, if any, so Save updates it; the name being typed to
  // save under; and a count of saves, so the Saved Reports list reads again.
  const [template, setTemplate] = useState<{ id: string; name: string } | null>(null)
  const [naming, setNaming] = useState<string | null>(null)
  const [savedVersion, setSavedVersion] = useState(0)
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

  // what, filters: the Report to run when not the one on screen (a template just opened, before the screen catches up).
  async function run(e?: React.FormEvent, what: ReportKind = kind, filters: ReportQuery = sent) {
    e?.preventDefault()
    const mine = ++latest.current
    setBusy(true)
    setError('')
    setExporting(false)
    try {
      const r = await window.snipeIt.report(what, filters)
      if (mine !== latest.current) return
      setReport(r)
      setRan({ kind: what, query: filters })
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

  function download(r: Report, what: ReportKind) {
    saveCsv(what === 'custom' && template ? template.name : REPORT_NAMES[what], r.columns, r.rows)
    setExporting(false)
  }
  // A template opens as the Custom Asset Report with its columns and filters, run at once.
  function openTemplate(r: SavedReport & { kind: 'custom' }) {
    const opened = { columns: r.columns, filters: r.filters }
    setKind('custom')
    setQuery(opened)
    setTemplate({ id: r.id, name: r.name })
    setNaming(null)
    stale()
    run(undefined, 'custom', opened)
  }
  // The Custom Asset Report as it is now, under the typed name: over the template it was opened from, or as a new one.
  async function saveTemplate(asNew: boolean) {
    try {
      const r = await window.settings.saveReport({ id: asNew ? undefined : template?.id, name: naming ?? '', kind: 'custom', search: '', filters: sent.filters ?? {}, sort: null, columns: sent.columns ?? [] })
      setTemplate({ id: r.id, name: r.name })
      setNaming(null)
      setSavedVersion((v) => v + 1)
      setNotice({ text: `Saved report "${r.name}"` })
    } catch (e) {
      setNotice({ text: (e as Error).message, error: true })
    }
  }

  return (
    <>
      <header className="head">
        <h1>Reports{kind === 'custom' && template && <span className="sub">{template.name}</span>}</h1>
        <span className="dim">{busy ? 'Loading…' : report && ran && `${report.rows.length.toLocaleString()} rows`}</span>
        <div className="actions">
          {kind === 'custom' && <button className="quiet" onClick={() => setNaming(template?.name ?? '')} aria-expanded={naming !== null}>Save report…</button>}
          <button className="quiet" disabled={!report?.rows.length || busy} onClick={() => setExporting((x) => !x)} aria-expanded={exporting}>Export CSV…</button>
          <EmailNow report={{ builtIn: kind, query: sent }} name={kind === 'custom' && template ? template.name : REPORT_NAMES[kind]} onDone={setNotice} />
        </div>
        <form className="actions" onSubmit={run}>
          <select value={kind} onChange={(e) => (setKind(e.target.value as ReportKind), setTemplate(null), setNaming(null), stale())} aria-label="Report">
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
      {kind === 'custom' && naming !== null && (
        <form className="toolbar actions" onSubmit={(e) => (e.preventDefault(), saveTemplate(false))}>
          <input autoFocus value={naming} onChange={(e) => setNaming(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setNaming(null)} placeholder="Report name" aria-label="Report name" />
          <button disabled={!naming.trim()}>{template ? 'Save' : 'Save report'}</button>
          {template && <button type="button" className="quiet" disabled={!naming.trim()} onClick={() => saveTemplate(true)}>Save as new</button>}
          <button type="button" className="quiet" onClick={() => setNaming(null)}>Cancel</button>
          <span className="dim">Saves its columns and filters as a Saved Report, to open, email or schedule.</span>
        </form>
      )}
      {kind === 'custom' && <CustomReportForm columns={sent.columns ?? []} filters={sent.filters ?? {}} onColumns={(columns) => set({ columns })} onFilter={(key, value) => set({ filters: { ...sent.filters, [key]: value } })} />}
      {exporting && report && ran && (
        <FerpaConfirm rows={report.rows.length} onExport={() => download(report, ran.kind)} onCancel={() => setExporting(false)} />
      )}
      {error && <p className="message error" role="alert">{error}</p>}
      {notice && <p className={`message ${notice.error ? 'error' : 'list-message'}`} role={notice.error ? 'alert' : 'status'}>{notice.text}</p>}
      <SavedReports onOpen={onOpenSaved} onOpenCustom={openTemplate} version={savedVersion} onEmailed={setNotice} />
      {report?.capped && <p className="message notice" role="status">Only the {ran?.kind === 'custom' ? 'first' : 'newest'} {report.rows.length.toLocaleString()} rows are shown; narrow the {ran?.kind === 'custom' ? 'filters' : 'dates'} for the rest.</p>}
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

// The Operator's Saved Reports, each opening as its List (a template as the Custom Asset Report), emailed now, renamed in
// place, or deleted after asking. Schedules are in Settings. version: bumped when one is saved here, to read them again.
function SavedReports({ onOpen, onOpenCustom, version, onEmailed }: { onOpen: (report: SavedListReport) => void; onOpenCustom: (report: SavedReport & { kind: 'custom' }) => void; version: number; onEmailed: (notice: Notice) => void }) {
  const [reports, setReports] = useState<SavedReport[] | null>(null)
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [error, setError] = useState('')
  useEffect(() => { window.settings.savedReports().then(setReports, (e: Error) => setError(e.message)) }, [version])
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
      {reports?.length === 0 && <p className="dim">None yet. Save any List, or the Custom Asset Report, with its Save report button.</p>}
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
                  ) : <button className="link" onClick={() => (r.kind === 'custom' ? onOpenCustom(r) : onOpen(r))}>{r.name}</button>}
                </td>
                <td className="dim">{r.kind === 'custom' ? REPORT_NAMES.custom : <>{listName[r.kind]}{r.view && `, ${ASSET_VIEWS[r.view].name}`}</>}</td>
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
