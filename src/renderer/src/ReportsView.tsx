import { useEffect, useRef, useState } from 'react'
import type { SavedReport } from '../../main/config'
import { listName } from './ListView'
import { ACTIVITY_ACTIONS, ACTIVITY_ITEM_TYPES, actionLabel, itemTypeName, type Report, type ReportKind, type ReportQuery } from '../../main/snipeit'

const reportName: Record<ReportKind, string> = { activity: 'Activity Report', overdue: 'Overdue', expiring: 'Warranty expiring' }
// What the date range bounds in each report.
const rangeName: Record<ReportKind, string> = { activity: 'When', overdue: 'Expected Checkin', expiring: 'Warranty ends' }

// Every cell quoted, so commas, quotes and line breaks survive. A cell a spreadsheet would run as a formula
// (=, +, -, @ first) gets a leading ' so a note can't become one. The byte-order mark lets Excel read it as UTF-8.
export function toCsv(columns: string[], rows: string[][]): string {
  const cell = (v: string) => `"${(/^[=+\-@\t\r]/.test(v) ? `'${v}` : v).replace(/"/g, '""')}"`
  return '\uFEFF' + [columns, ...rows].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n'
}

// Saves a CSV where the Operator chooses; nothing is written without that. name: what it holds, e.g. "Activity Report".
export function saveCsv(name: string, columns: string[], rows: string[][]) {
  const url = URL.createObjectURL(new Blob([toCsv(columns, rows)], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  // Local date, so a late-evening export isn't stamped with tomorrow (UTC).
  const d = new Date()
  const stamp = [d.getFullYear(), d.getMonth() + 1, d.getDate()].map((n) => String(n).padStart(2, '0')).join('-')
  a.download = `${name.toLowerCase().replace(/ /g, '-')}-${stamp}.csv`
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

// Runs when asked (a report can page through a lot), not on every change of a filter. A Saved Report opens as its List.
export function ReportsView({ onOpenSaved }: { onOpenSaved: (report: SavedReport) => void }) {
  const [kind, setKind] = useState<ReportKind>('activity')
  const [query, setQuery] = useState<ReportQuery>({})
  const [report, setReport] = useState<Report | null>(null)
  const [ran, setRan] = useState<{ kind: ReportKind; query: ReportQuery } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [exporting, setExporting] = useState(false)
  // Bumped by every run and every change of report or filter; a result for an older one is dropped, so what shows
  // (and what exports) always matches the filters on screen.
  const latest = useRef(0)
  const stale = () => (latest.current++, setReport(null), setRan(null), setExporting(false), setBusy(false), setError(''))
  const set = (change: ReportQuery) => (setQuery((q) => ({ ...q, ...change })), stale())

  async function run(e: React.FormEvent) {
    e.preventDefault()
    const mine = ++latest.current
    setBusy(true)
    setError('')
    setExporting(false)
    try {
      const r = await window.snipeIt.report(kind, kind === 'activity' ? query : { from: query.from, to: query.to })
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

  function download(r: Report, what: ReportKind) {
    saveCsv(reportName[what], r.columns, r.rows)
    setExporting(false)
  }

  return (
    <>
      <header className="head">
        <h1>Reports</h1>
        <span className="dim mono">{busy ? 'Loading…' : report && ran && `${report.rows.length.toLocaleString()} rows`}</span>
        <div className="actions">
          <button className="quiet" disabled={!report?.rows.length || busy} onClick={() => setExporting((x) => !x)} aria-expanded={exporting}>Export CSV…</button>
        </div>
        <form className="actions" onSubmit={run}>
          <select value={kind} onChange={(e) => (setKind(e.target.value as ReportKind), stale())} aria-label="Report">
            {(Object.keys(reportName) as ReportKind[]).map((k) => <option key={k} value={k}>{reportName[k]}</option>)}
          </select>
          <label className="range">{rangeName[kind]} from <input type="date" value={query.from ?? ''} onChange={(e) => set({ from: e.target.value })} /></label>
          <label className="range">to <input type="date" value={query.to ?? ''} onChange={(e) => set({ to: e.target.value })} /></label>
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
            </>
          )}
          <button disabled={busy}>{busy ? 'Running…' : 'Run report'}</button>
        </form>
      </header>
      {exporting && report && ran && (
        <FerpaConfirm rows={report.rows.length} onExport={() => download(report, ran.kind)} onCancel={() => setExporting(false)} />
      )}
      {error && <p className="message error" role="alert">{error}</p>}
      <SavedReports onOpen={onOpenSaved} />
      {report?.capped && <p className="message list-message" role="status">Only the newest {report.rows.length.toLocaleString()} rows are shown; narrow the dates for the rest.</p>}
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

// The Operator's Saved Reports, each opening as its List, renamed in place, or deleted after asking.
function SavedReports({ onOpen }: { onOpen: (report: SavedReport) => void }) {
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
                <td className="dim">{listName[r.kind]}</td>
                <td><div className="actions">
                  {deleting === r.id ? (
                    <span className="confirm" role="alertdialog" aria-label={`Delete ${r.name}?`}>
                      <span>Delete "{r.name}"?</span>
                      <button className="danger" autoFocus onClick={() => change(window.settings.deleteReport(r.id))}>Delete</button>
                      <button className="quiet" onClick={() => setDeleting(null)}>Cancel</button>
                    </span>
                  ) : (
                    <>
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
