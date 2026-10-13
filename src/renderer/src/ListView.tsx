import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ACTIVITY_ACTIONS, actionLabel, ASSET_VIEWS, lateness, BULK_FORMS, DELETE_KINDS, LIST_PAGE, LIST_SORTS, MISSING_FIELDS, REPORT_MAX, type Asset, type MissingField, type AssetView, type AuditOptions, type BulkKind, type Can, type DeleteKind, type CheckinOptions, type CheckoutOptions, type ListKind, type ListPage, type ListQuery, type ListRows, type OtherKind, type RecordKind, type EditKind, type SnipeItBridge, type StatusLabel } from '../../main/snipeit'
import { editable } from './RecordView'
import { AssetSheet, AuditForm, CheckoutForm, NOT_ALLOWED, auditedResult, StatusChip, checkinReason, checkoutReason, keyPlace, type KeyPlace, type SheetForm, type SheetProps } from './App'
import { BulkEditForm } from './RecordForm'
import { PrintLabel } from './AssetCodes'
import { FerpaConfirm, saveCsv } from './ReportsView'
import { cellText, exportTable, LIST_COLUMNS, shownColumns, viewColumns, type AnyColumn } from '../../main/export'
import type { SavedReport } from '../../main/config'

export const listName: Record<ListKind, string> = {
  assets: 'Assets', users: 'Users', locations: 'Locations', models: 'Asset Models', activity: 'Activity Report',
  licenses: 'Licenses', accessories: 'Accessories', consumables: 'Consumables', components: 'Components', categories: 'Categories',
  manufacturers: 'Manufacturers', suppliers: 'Suppliers', departments: 'Departments', companies: 'Companies', statuslabels: 'Status Labels',
}
// What a List shows in a cell instead of its text (LIST_COLUMNS' text, which Export writes): the status as a chip, a note set off.
// An Asset's Status flags it Temp (marked on the All View) and Overdue; a Damaged one's Status Label, named as the Damaged
// View finds it, is itself the flag.
const CELLS: { [K in ListKind]?: { [C in keyof ListRows[K]]?: (row: ListRows[K]) => ReactNode } } = {
  assets: {
    status: (a) => <>
      {a.status.trim().toLowerCase() === ASSET_VIEWS.damaged.filter![1].toLowerCase() ? <span className="flag c-red">{a.status}</span> : <StatusChip asset={a} />}
      {a.temp && <span className="flag c-blue">Temp</span>}
      {a.overdue && <span className="flag c-red">Overdue {lateness(a.overdue)}</span>}
    </>,
  },
  activity: { note: (r) => r.note && <span className="note">{r.note}</span> },
}
/** The keys of the columns that hold numbers (counts like Assets, Seats, Remaining), which right-align. */
export const numericColumns = (columns: AnyColumn[], rows: object[]) =>
  new Set(columns.filter((c) => rows.some((r) => typeof (r as Record<string, unknown>)[c.key] === 'number')).map((c) => c.key))
// Stored per computer and per List once the Operator picks: which columns show.
const columnsKey = (kind: ListKind) => `columns:${kind}`
// The List used to store its Columns on every open, so Assets' old defaults stored as they were mean never picked.
// ponytail: an Operator who picked exactly the old defaults gets the new ones; drop this once every computer has opened Assets.
const OLD_ASSET_DEFAULTS = ['assetTag', 'name', 'status', 'model', 'category', 'location', 'assignee']
/** A List's Columns from what this computer stored: the Operator's pick, or the defaults when they never picked. */
export function storedColumns(kind: ListKind, stored: unknown): string[] {
  const unpicked = kind === 'assets' && Array.isArray(stored) && stored.length === OLD_ASSET_DEFAULTS.length && OLD_ASSET_DEFAULTS.every((k) => stored.includes(k))
  return shownColumns(kind, unpicked ? null : stored)
}
function readColumns(kind: ListKind): string[] {
  try { return storedColumns(kind, JSON.parse(localStorage.getItem(columnsKey(kind)) ?? 'null')) }
  catch { return shownColumns(kind, null) }
}
// Lists whose rows hold Users or Assignees (an Asset's, a History entry's, a Department's manager): exporting one asks for
// the FERPA confirmation first.
const STUDENT_INFO: ListKind[] = ['assets', 'users', 'activity', 'departments']
export const holdsStudentInfo = (kind: ListKind) => STUDENT_INFO.includes(kind)

type Option = { value: string; label: string }
type Filter = { key: string; label: string; options: Option[] }
type Names = Partial<Record<'models' | 'categories' | 'departments', StatusLabel[]>>
const toOptions = (list: StatusLabel[] = []): Option[] => list.map((l) => ({ value: String(l.id), label: l.name }))
const namesNeeded: Partial<Record<ListKind, (keyof Names)[]>> = { assets: ['models', 'categories'], users: ['departments'], models: ['categories'] }

function filtersFor(kind: ListKind, names: Names, statusLabels: StatusLabel[], locations: StatusLabel[]): Filter[] {
  switch (kind) {
    case 'assets': return [
      { key: 'status', label: 'Checked out or available', options: [{ value: 'Deployed', label: 'Checked out' }, { value: 'RTD', label: 'Available' }] },
      { key: 'status_id', label: 'Any status', options: toOptions(statusLabels) },
      { key: 'location_id', label: 'Any Location', options: toOptions(locations) },
      { key: 'model_id', label: 'Any Asset Model', options: toOptions(names.models) },
      { key: 'category_id', label: 'Any category', options: toOptions(names.categories) },
      { key: 'missing', label: 'Missing a field or not', options: MISSING_FIELDS.map((f) => ({ value: f, label: `Missing ${missingWhat[f]}` })) },
    ]
    case 'users': return [
      { key: 'location_id', label: 'Any Location', options: toOptions(locations) },
      { key: 'department_id', label: 'Any department', options: toOptions(names.departments) },
      { key: 'activated', label: 'Activated or deactivated', options: [{ value: '1', label: 'Activated' }, { value: '0', label: 'Deactivated' }] },
    ]
    case 'models': return [{ key: 'category_id', label: 'Any category', options: toOptions(names.categories) }]
    case 'activity': return [
      { key: 'action_type', label: 'Any action', options: ACTIVITY_ACTIONS.map((a) => ({ value: a, label: actionLabel(a) })) },
    ]
    default: return []
  }
}

/** What an Asset is missing, for the Assets List's missing filter ("Missing a Serial") and the Health warning that opens it. */
export const missingWhat: Record<MissingField, string> = { serial: 'a Serial', model: 'an Asset Model', location: 'a Location' }

/** A List opened already filtered to one record, e.g. a Location's Assets; label names a filter that has no filter box.
 * sort: where it starts sorted (a Health warning's most urgent first). */
export type Drill = { filters: Record<string, string>; label?: string; sort?: SavedReport['sort'] }
// "Categories" → "Category", "Status Labels" → "Status Label".
export const singular = (kind: ListKind) => listName[kind].replace(/ies$/, 'y').replace(/s$/, '')
/** What a Drill from one record is called: a User's Assets are "Checked out to" them, anything else "Kind: name". */
export const drillLabel = (kind: RecordKind, name: string) => (kind === 'users' ? `Checked out to ${name}` : `${singular(kind)}: ${name}`)
export const drillTo = (kind: OtherKind, { id, name }: { id: number; name: string }): Drill =>
  kind === 'users' ? { filters: { user_id: String(id) }, label: drillLabel(kind, name) } : { filters: { [kind === 'locations' ? 'location_id' : 'model_id']: String(id) } }

/** What a List is showing: its View (Assets only; All elsewhere), search, filter boxes and sort. */
export type ListState = { view: AssetView; search: string; filters: Record<string, string>; sort: SavedReport['sort'] }
/** Where a List opens: on All, with a Drill's filters, or a Saved Report's View, search and sort (its filters come as the Drill). */
export const opening = (drill?: Drill, report?: SavedReport): ListState => ({ view: report?.view ?? 'all', search: report?.search ?? '', filters: drill?.filters ?? {}, sort: report?.sort ?? drill?.sort ?? null })
/** A Saved Report's filters as the Drill it opens with, so a filter with no box shows as its chip. */
export const reportDrill = (r: SavedReport): Drill => ({ filters: r.filters, label: r.label })
/** Where picking an Assets View starts: no search or filters, and the View's own sort, as if another List were opened. */
export const picking = (view: AssetView): ListState => ({ view, search: '', filters: {}, sort: ASSET_VIEWS[view].sort ?? null })
/** What a List asks Snipe-IT for; only Assets have Views. */
export const listQuery = (kind: ListKind, { view, search, filters, sort }: ListState): ListQuery =>
  ({ search, filters, sort: sort?.key, order: sort?.order, ...(kind === 'assets' && { view }) })

const VIEW_COUNT = Object.keys(ASSET_VIEWS).length

type Row = ListPage<ListKind>['rows'][number]

/** What a key does on the Assets List: move the focused row (and the open Asset panel with it), open it, tick, or close. */
export type ListKey = 'up' | 'down' | 'open' | 'tick' | 'close'
// ↑/↓ work anywhere but a field; Enter and Space only where they'd do nothing else (not in a field, not on a button or checkbox);
// Esc anywhere but a field outside the Asset panel, whose own Esc (a filter box's list, the report name) comes first.
export function listKey(e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>, place: KeyPlace, inPanel: boolean): ListKey | null {
  if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return null
  switch (e.key) {
    case 'ArrowUp': case 'ArrowDown': return place === 'field' ? null : e.key === 'ArrowUp' ? 'up' : 'down'
    case 'Enter': return place === 'none' ? 'open' : null
    case ' ': return place === 'none' ? 'tick' : null
    case 'Escape': return place !== 'field' || inPanel ? 'close' : null
    default: return null
  }
}
/** Whether ↑/↓ take the Asset panel along and Esc closes it: while it shows, or while an open is still loading (the first, before
 * any panel shows), so that open can't land after and pull the focused row back, or open a panel the Operator dismissed. */
export const panelLive = (shown: boolean, loading: boolean) => shown || loading
/** The panel's Asset to reload when a Bulk Action ends: only the open that showed as the run began (n), and only if the run changed
 * it without deleting it. An open made mid-run (a Quick Action's form) is newer and keeps its inputs. */
export const panelToRefresh = (startN: number | undefined, panel: { n: number; id: number } | null, run: { deletes?: true; records: { id: number }[] } | null) =>
  panel && panel.n === startN && !run?.deletes && run?.records.some((r) => r.id === panel.id) ? panel.id : undefined
/** The row focused after ↑ (-1) or ↓ (1): the next one on the page, stopping at either end; from none, the first or the last. */
export function moveCursor(ids: number[], at: number | null, by: -1 | 1): number | null {
  if (!ids.length) return null
  const i = at === null ? -1 : ids.indexOf(at)
  return i < 0 ? ids[by > 0 ? 0 : ids.length - 1] : ids[Math.min(ids.length - 1, Math.max(0, i + by))]
}
/** Gives the List's row for id DOM focus (it's focusable, but not in the Tab order), so after ↑/↓ Enter and Space act on the row shown
 * rather than a button on the row focus was left on. */
export const focusRow = (table: Pick<ParentNode, 'querySelector'> | null, id: number) =>
  table?.querySelector<HTMLElement>(`tr[data-id="${id}"]`)?.focus({ preventScroll: true })
/** Starts opening a row's Asset in the Asset panel (its first column or a Quick Action): the focused row moves onto it at once, not when
 * the fetch lands, so ↑/↓ meanwhile move on from it. */
export const openRow = (setCursor: (id: number) => void, onOpenAsset: (id: number, form?: SheetForm) => void) => (id: number, form?: SheetForm) =>
  (setCursor(id), onOpenAsset(id, form))
/** The Asset docked in the Asset panel (App owns it, so a scan can open it), with the form a Quick Action opened. */
export type ListPanel = { n: number; form?: SheetForm; sheet: SheetProps }

/** The Records ticked in the open List, by id, across its pages; kept with their rows so a Bulk Action has what it needs. */
export type Selection<T extends { id: number } = { id: number }> = Map<number, T>
// Ticking rows (one, or a page by its header box): ticks them all, or clears them when every one is already ticked.
export function tick<T extends { id: number }>(s: Selection<T>, rows: T[]): Selection<T> {
  const next = new Map(s)
  if (pageTicks(s, rows) === 'all') for (const r of rows) next.delete(r.id)
  else for (const r of rows) next.set(r.id, r)
  return next
}
// The Selection with any of its rows that just reloaded swapped for their new values.
export const refreshed = <T extends { id: number }>(s: Selection<T>, rows: T[]): Selection<T> =>
  rows.some((r) => s.has(r.id)) ? new Map([...s].map(([id, r]) => [id, rows.find((x) => x.id === id) ?? r])) : s
// What a page's header box shows.
export const pageTicks = (s: Selection, rows: { id: number }[]) => {
  const n = rows.filter((r) => s.has(r.id)).length
  return n && n === rows.length ? 'all' : n ? 'some' : 'none'
}
// "Select all N matching" asks first past this many, so a Bulk Action can't reach thousands of Records by accident.
const SELECT_ALL_ASK = 100
export const confirmSelectAll = (n: number) => n > SELECT_ALL_ASK
// Every Record matching the List's search and filters, page by page; null if the Operator left or changed the List meanwhile.
// ponytail: one page at a time (50 rows); 2,000 matches is 40 requests, a few seconds.
export async function allMatching<T extends { id: number }>(page: (offset: number) => Promise<Pick<ListPage<ListKind>, 'total'> & { rows: T[] }>, stale = () => false): Promise<Selection<T> | null> {
  const all: Selection<T> = new Map()
  for (let offset = 0; ; ) {
    const p = await page(offset)
    if (stale()) return null
    for (const r of p.rows) all.set(r.id, r)
    offset += p.rows.length
    if (!p.rows.length || offset >= p.total) return all
  }
}

/** How one Record fared in a Bulk Action's run (a Workflow's Running list rows use the same states). */
export type Outcome = { state: 'working' } | { state: 'done'; text: string } | { state: 'failed'; reason: string }

// Runs the action on each Record in turn and reports each outcome as it lands; one failing doesn't stop the rest, stop() does.
// Each is the usual single edit, delete, Checkout, Checkin or Audit, so History credits the Operator for every one. Work
// that answers with text (an Audit's dates) is reported with it instead of `done`.
// ponytail: one at a time, gentle on Snipe-IT's rate limit (a Checkout or an Audit is two requests); a Selection of 30 takes ~20s on a busy server.
export async function eachInTurn(ids: number[], work: (id: number) => Promise<string | void>, done: string, report: (id: number, outcome: Outcome) => void, stop = () => false) {
  for (const id of ids) {
    if (stop()) return
    report(id, { state: 'working' })
    try {
      report(id, { state: 'done', text: (await work(id)) || done })
    } catch (e) {
      report(id, { state: 'failed', reason: (e as Error).message })
    }
  }
}

// What a run's result cell says for one Record.
export function OutcomeText({ outcome: o }: { outcome: Outcome }) {
  return o.state === 'working' ? <span className="dim">Working…</span> : o.state === 'done' ? <span className="chip c-green">{o.text}</span> : <span className="late">{o.reason}</span>
}

/** A Bulk Action: what it does to each Record of a List (done: what its result says), under a title. deletes: a Record it's done leaves the List. */
export type BulkAction = { kind: ListKind; title: string; done: string; work: (id: number) => Promise<string | void>; deletes?: true }
// Checkout… and Checkin… on the Assets List: each selected Asset gets the usual single Checkout or Checkin with the form's options.
export const checkoutAction = (bridge: Pick<SnipeItBridge, 'checkout'>, o: CheckoutOptions): BulkAction =>
  ({ kind: 'assets', title: MOVES.checkout.title, done: 'Checked out', work: (id) => bridge.checkout(id, o) })
export const checkinAction = (bridge: Pick<SnipeItBridge, 'checkin'>, o: CheckinOptions): BulkAction =>
  ({ kind: 'assets', title: MOVES.checkin.title, done: 'Checked in', work: (id) => bridge.checkin(id, o) })
// Snipe-IT would refuse each one anyway; saying so up front beats a run of failed rows.
export const cantCheckout = (assets: Pick<Asset, 'can'>[]) => assets.some((a) => !a.can.checkout)
export const cantCheckin = (assets: Pick<Asset, 'can'>[]) => assets.some((a) => !a.can.checkin)
// The two, as the Selection bar offers them.
const MOVES = {
  checkout: { button: 'Checkout…', title: 'Checkout Assets', verb: 'Check out', cant: cantCheckout },
  checkin: { button: 'Checkin…', title: 'Checkin Assets', verb: 'Check in', cant: cantCheckin },
}
/** A Bulk Action's run: each Record by name with how it fared, and the ones this run (or a retry) goes over. stopping: Stop was pressed. */
export type BulkRun = { records: { id: number; name: string; outcome?: Outcome }[]; ids: number[]; busy: boolean; stopping?: true }
const finished = (o?: Outcome) => o?.state === 'done' || o?.state === 'failed'
// How many of this run's Records are done or failed so far, of how many.
function counts({ records, ids }: BulkRun) {
  const run = new Set(ids)
  return { finished: records.filter((r) => run.has(r.id) && finished(r.outcome)).length, of: ids.length }
}
// "14 of 30"
export const progress = (run: BulkRun) => { const c = counts(run); return `${c.finished.toLocaleString()} of ${c.of.toLocaleString()}` }
// The same run again over only the ones that failed, their results cleared.
export function retrying({ records, busy }: BulkRun): BulkRun {
  const ids = records.filter((r) => r.outcome?.state === 'failed').map((r) => r.id)
  const again = new Set(ids)
  return { busy, ids, records: records.map((r) => (again.has(r.id) ? { id: r.id, name: r.name } : r)) }
}
export const deleteQuestion = (kind: ListKind, n: number) => `Delete ${n.toLocaleString()} ${n === 1 ? singular(kind) : listName[kind]}?`
export const deletable = (kind: ListKind): kind is DeleteKind => (DELETE_KINDS as readonly string[]).includes(kind)
// Offered when Snipe-IT lets the Operator delete any of them. Its available_actions also says no to one it won't let go
// (a User with items checked out); that one is still tried, so Snipe-IT's reason shows beside it.
export const mayDelete = (kind: ListKind, rows: { can: Can }[]) => deletable(kind) && rows.some((r) => r.can.delete)
const bulkEditable = (kind: ListKind): kind is BulkKind => Object.hasOwn(BULK_FORMS, kind)
// "Edit shared fields" is offered on Assets and Users when Snipe-IT lets the Operator edit them.
export const mayEdit = (kind: ListKind, rows: { can: Can }[]) => bulkEditable(kind) && rows.some((r) => r.can.update)
// Audit… is offered on Assets when Snipe-IT lets the Operator audit any of them; the rest are still tried, so Snipe-IT's reason shows.
export const mayAudit = (kind: ListKind, rows: { can: Can }[]) => kind === 'assets' && rows.some((r) => r.can.audit)
/** The Audit Bulk Action: the same Next audit and note for each Asset, one Audit at a time (not Snipe-IT's bulk audit, which
 * would lose Stop, progress and Retry failed), each result with its next audit date and the one it was. */
export const auditAction = (o: AuditOptions): BulkAction =>
  ({ kind: 'assets', title: 'Audit Assets', done: 'Audited', work: async (id) => auditedResult(await window.snipeIt.audit(id, o)) })

// Loads when opened and whenever the search, a filter, the sort, or the page changes; no background polling.
// Opening a row: an Asset opens its sheet, any other record its page of fields.
// report: the Saved Report it was opened from; its View, search, sort and Columns start the List (App passes its filters as drill).
export function ListView({ kind, drill, report, assetView, baseUrl, statusLabels, locations, defaultLocation, onOpenAsset, onOpenRecord, onNew, bulk, onBulk, onStopBulk, onCloseBulk, panel, onClosePanel, panelLoading, onRefreshPanel, onDropPanel }: {
  onNew: (kind: EditKind) => void
  // The Asset panel (Assets only): what it shows, and closing it.
  panel: ListPanel | null
  onClosePanel: () => void
  // A lookup or open still loading, which ↑/↓ supersede.
  panelLoading: boolean
  // When a Bulk Action ends: reload the panel's Asset, or close the panel after a delete; neither cancels an open still loading.
  onRefreshPanel: (id: number, n: number) => void
  onDropPanel: (id: number) => void
  // App runs a Bulk Action, so leaving the List mid-run loses nothing; its panel shows on the List it acts on.
  bulk: (BulkRun & BulkAction) | null
  onBulk: (action: BulkAction, run: BulkRun) => void
  onStopBulk: () => void
  onCloseBulk: () => void
  kind: ListKind
  baseUrl: string
  drill?: Drill
  report?: SavedReport
  /** Opens the Assets List on this View instead of All (a Health warning's click). */
  assetView?: AssetView
  statusLabels: StatusLabel[]
  locations: StatusLabel[]
  // What Checkout… and Checkin… on a Selection start with, as the Asset panel's forms do.
  defaultLocation: StatusLabel | null
  // On the Assets List an Asset opens in the Asset panel; form: the form a Quick Action opens there.
  onOpenAsset: (id: number, form?: SheetForm) => void
  onOpenRecord: (kind: RecordKind, id: number) => void
}) {
  const [start] = useState(() => (assetView ? picking(assetView) : opening(drill, report)))
  // The Drill in force: App's, or that of a Saved Report opened from the tab bar.
  const [drilled, setDrilled] = useState(drill)
  const [view, setView] = useState(start.view)
  const [text, setText] = useState(start.search)
  const [search, setSearch] = useState(start.search)
  const [filters, setFilters] = useState(start.filters)
  const [sort, setSort] = useState(start.sort)
  const [offset, setOffset] = useState(0)
  const [page, setPage] = useState<ListPage<ListKind> | null>(null)
  const [loading, setLoading] = useState(false)
  const [reloads, setReloads] = useState(0)
  const [names, setNames] = useState<Names>({})
  const [shown, setShown] = useState(() => (report ? shownColumns(kind, report.columns) : readColumns(kind)))
  // The Saved Report this List is (once opened from or saved as one), so Save writes over it; and the name being typed.
  const [saved, setSaved] = useState(report ?? null)
  const [naming, setNaming] = useState<string | null>(null)
  // The Operator's Saved Reports of Assets, shown in the tab bar after the Views.
  const [tabReports, setTabReports] = useState<SavedReport[]>([])
  const [customizing, setCustomizing] = useState(false)
  // The row ↑/↓ have moved to (Assets only), by id.
  const [cursor, setCursor] = useState<number | null>(null)
  const openAsset = openRow(setCursor, onOpenAsset)
  // The id of the panel's Asset once it's found outside the open View; kept while a reload checks again, so the notice doesn't blink.
  const [outside, setOutside] = useState<number | null>(null)
  const [message, setMessage] = useState<{ text: string; error?: boolean }>({ text: '' })
  // The Selection lives with this List, across its Views; leaving it (or opening another) starts the next one empty.
  const [selection, setSelection] = useState<Selection<Row>>(new Map())
  // "Select all N matching": asking to confirm, or fetching; a newer query or Clear makes a fetch still going stale.
  const [selectingAll, setSelectingAll] = useState<'asking' | 'fetching' | null>(null)
  const selectEpoch = useRef(0)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  // Export CSV: asking for the FERPA confirmation, or fetching every matching row.
  const [exporting, setExporting] = useState<'asking' | 'fetching' | null>(null)
  const [editing, setEditing] = useState(false)
  // The Checkout… or Checkin… form open under the Selection bar (Assets only).
  const [bulkForm, setBulkForm] = useState<keyof typeof MOVES | null>(null)
  const [auditing, setAuditing] = useState(false)
  const mine = bulk?.kind === kind ? bulk : null
  // A deleted Record leaves the Selection; one that failed stays ticked.
  useEffect(() => {
    if (!mine?.deletes) return
    const gone = new Set(mine?.records.filter((r) => r.outcome?.state === 'done').map((r) => r.id))
    if (gone.size) setSelection((s) => ([...gone].some((id) => s.has(id)) ? new Map([...s].filter(([id]) => !gone.has(id))) : s))
    // A deleted Asset can't stay in the Asset panel.
    if (panel && gone.has(panel.sheet.asset.id)) onDropPanel(panel.sheet.asset.id)
  }, [mine])
  // The List refreshes when its run ends (finished or stopped), and so does the Asset panel if the run included its Asset.
  const running = !!mine?.busy
  const wasRunning = useRef(running)
  // The panel's open (n) as the run began.
  const startN = useRef<number>(undefined)
  useEffect(() => {
    if (!wasRunning.current && running) startN.current = panel?.n
    if (wasRunning.current && !running) {
      setReloads((n) => n + 1)
      const shown = panelToRefresh(startN.current, panel && { n: panel.n, id: panel.sheet.asset.id }, mine)
      if (shown !== undefined) onRefreshPanel(shown, startN.current!)
    }
    wasRunning.current = running
  }, [running])
  // One page of this List as searched, filtered and sorted now, in its View; "select all" pages it in id order instead.
  const fetchPage = (offset: number, order = sort) => window.snipeIt.list(kind, { ...listQuery(kind, { view, search, filters, sort: order }), offset })

  // Search after a short pause in typing, from the first page.
  useEffect(() => {
    if (text === search) return
    const timer = setTimeout(() => (setSearch(text), setOffset(0)), 300)
    return () => clearTimeout(timer)
  }, [text])
  // A "select all" still fetching stops when what matches changes; turning the page or a refresh doesn't change that.
  useEffect(() => () => { selectEpoch.current++; setSelectingAll(null) }, [kind, view, search, filters, sort])
  useEffect(() => {
    let stale = false
    setLoading(true)
    fetchPage(offset).then(
      (p) => {
        if (stale) return
        // An action in the Asset panel can shrink the List under the current page; step back to the last page that has rows.
        if (offset > 0 && offset >= p.total) return setOffset(Math.max(0, Math.ceil(p.total / LIST_PAGE) - 1) * LIST_PAGE)
        setPage(p)
        setSelection((s) => refreshed(s, p.rows))
        setMessage((m) => (m.error ? { text: '' } : m))
      },
      (e: Error) => !stale && (setPage(null), setMessage({ text: e.message, error: true })),
    ).finally(() => !stale && setLoading(false))
    return () => { stale = true }
  }, [kind, view, search, filters, sort, offset, reloads])
  // A tab bar without them still has the Views.
  useEffect(() => {
    let stale = false
    if (kind === 'assets') window.settings.savedReports().then((all) => !stale && setTabReports(all.filter((r) => r.kind === 'assets')), () => {})
    return () => { stale = true }
  }, [kind])
  // A filter whose names don't load just has fewer choices.
  useEffect(() => {
    let stale = false
    for (const n of namesNeeded[kind] ?? []) window.snipeIt.names(n).then((v) => !stale && setNames((names) => ({ ...names, [n]: v })), () => {})
    return () => { stale = true }
  }, [kind])
  // The Operator's pick is stored; a Saved Report's Columns are its own and don't change the List's usual ones.
  const pickColumn = (key: string) => {
    const next = shown.includes(key) ? shown.filter((k) => k !== key) : [...shown, key]
    setShown(next)
    if (!saved) localStorage.setItem(columnsKey(kind), JSON.stringify(next))
  }

  const all: AnyColumn[] = LIST_COLUMNS[kind]
  // The open Assets View (none on other Lists); its own column shows whatever the Operator picked under Columns.
  const viewSpec = kind === 'assets' ? ASSET_VIEWS[view] : undefined
  const viewColumn = viewSpec?.column
  const showing = viewSpec ? viewColumns(shown, view) : shown
  const columns = all.filter((c) => showing.includes(c.key))
  const sortable: Record<string, string> = LIST_SORTS[kind]
  const setFilter = (key: string, value: string) => (setFilters((f) => ({ ...f, [key]: value })), setOffset(0))
  // Picking a View or a Saved Report's tab keeps the Selection; the rest starts again as that View or Saved Report.
  const show = (next: ListState) => (setView(next.view), setText(next.search), setSearch(next.search), setFilters(next.filters), setSort(next.sort), setOffset(0), setPage(null))
  const pickView = (v: AssetView) => {
    // Leaving a Saved Report: the List's usual Columns come back, and Save report… makes a new one (its form, named for the
    // one left, closes).
    if (saved) setSaved(null), setDrilled(undefined), setShown(readColumns(kind)), setNaming(null)
    show(picking(v))
  }
  const openReport = (r: SavedReport) => {
    const d = reportDrill(r)
    setSaved(r), setDrilled(d), setShown(shownColumns(kind, r.columns)), setNaming(null)
    show(opening(d, r))
  }
  const toggleSort = (key: string) => (setSort((s) => (s?.key === key && s.order === 'asc' ? { key, order: 'desc' } : { key, order: 'asc' })), setOffset(0))

  const reload = () => setReloads((n) => n + 1)

  const selectionRun = (): BulkRun => {
    const records = [...selection.values()].map((r) => ({ id: r.id, name: rowName(r) }))
    return { records, ids: records.map((r) => r.id), busy: true }
  }
  const deleteSelection = () => {
    setConfirmingDelete(false)
    if (deletable(kind)) onBulk({ kind, title: `Delete ${listName[kind]}`, done: 'Deleted', deletes: true, work: (id) => window.snipeIt.remove(kind, id) }, selectionRun())
  }
  // Each Record gets the usual single edit with only the filled-in fields; Snipe-IT's reasons show beside the one it refused.
  const editSelection = (values: Record<string, string>) => {
    setEditing(false)
    if (!bulkEditable(kind)) return
    const work = async (id: number) => {
      const result = await window.snipeIt.save(kind, id, values)
      if (!result.ok) throw new Error(Object.values(result.errors).join(' ') || result.message)
    }
    onBulk({ kind, title: `Edit ${listName[kind]}`, done: 'Saved', work }, selectionRun())
  }
  const runForm = (action: BulkAction) => (setBulkForm(null), onBulk(action, selectionRun()))
  const auditSelection = (o: AuditOptions) => (setAuditing(false), onBulk(auditAction(o), selectionRun()))
  // The List as shown, every matching row up to the Report row cap; saved where the Operator chooses.
  async function exportCsv() {
    setExporting('fetching')
    try {
      const { rows, capped } = await window.snipeIt.exportList(kind, listQuery(kind, { view, search, filters, sort }))
      const table = exportTable(kind, showing, rows)
      saveCsv(listName[kind], table.columns, table.rows)
      setMessage({ text: capped ? `Exported the first ${rows.length.toLocaleString()} rows; filter the List for the rest.` : `Exported ${rows.length.toLocaleString()} rows` })
    } catch (e) {
      setMessage({ text: (e as Error).message, error: true })
    }
    setExporting(null)
  }
  // The List as it is now, under the typed name: over the Saved Report it is (asNew: as another), or as a new one.
  // The search as typed, even if the List hasn't caught up with the last keystrokes; the label while its chip shows.
  async function saveReport(asNew: boolean) {
    const chip = Object.keys(drilled?.filters ?? {}).some((k) => filters[k] && !filterBar.some((f) => f.key === k))
    try {
      const r = await window.settings.saveReport({ id: asNew ? undefined : saved?.id, name: naming ?? '', kind, search: text, filters, label: chip ? drilled?.label : undefined, sort, columns: shown,
        ...(kind === 'assets' && { view }) })
      setSaved(r)
      setTabReports((all) => (r.kind !== 'assets' ? all : all.some((x) => x.id === r.id) ? all.map((x) => (x.id === r.id ? r : x)) : [...all, r]))
      setNaming(null)
      setMessage({ text: `Saved report "${r.name}"` })
    } catch (e) {
      setMessage({ text: (e as Error).message, error: true })
    }
  }
  const rowName = (row: Row) => (kind === 'assets' ? (row as Asset).assetTag : (row as { name?: string }).name ?? `#${row.id}`)

  function open(row: Row): (() => void) | undefined {
    if (kind === 'assets') return () => openAsset(row.id)
    if (kind !== 'activity') return () => onOpenRecord(kind, row.id)
    const item = (row as ListRows['activity']).item
    return item?.type === 'asset' ? () => onOpenAsset(item.id) : undefined
  }

  function cell(c: AnyColumn, row: Row, first: boolean) {
    const custom = (CELLS[kind] as Record<string, (row: Row) => ReactNode> | undefined)?.[c.key]
    const value = custom ? custom(row) : cellText(c, row)
    const shownValue = value === '' || value == null ? '—' : value
    // The row's way in: the first column, or for the Activity Report the Asset it names.
    const go = (first && kind !== 'activity') || (kind === 'activity' && c.key === 'item') ? open(row) : undefined
    // Space Mono only for Asset Tags and Serials; the link inherits it. Numbers right-align.
    return <td key={c.key} className={c.key === 'assetTag' || c.key === 'serial' ? 'mono' : numeric.has(c.key) ? 'num' : undefined}>{go ? <button className="link" onClick={go}>{shownValue}</button> : shownValue}</td>
  }

  const rows = page?.rows ?? []
  const total = page?.total ?? 0
  const numeric = numericColumns(columns, rows)
  // Activity Report rows are log entries, not Records: nothing to select.
  const selectable = kind !== 'activity'
  const ticks = pageTicks(selection, rows)
  async function selectAll() {
    const mine = ++selectEpoch.current
    setSelectingAll('fetching')
    try {
      const all = await allMatching((offset) => fetchPage(offset, { key: 'id', order: 'asc' }), () => mine !== selectEpoch.current)
      if (all) setSelection((s) => new Map([...s, ...all]))
    } catch (e) {
      if (mine === selectEpoch.current) setMessage({ text: (e as Error).message, error: true })
    }
    if (mine === selectEpoch.current) setSelectingAll(null)
  }
  const clear = () => (selectEpoch.current++, setSelectingAll(null), setSelection(new Map()))
  const tickedHere = rows.filter((r) => selection.has(r.id)).length
  const moveOff = !!bulk?.busy || !!selectingAll
  // A View that fixes a filter (Checked out, Available, Damaged) has no box for it.
  const filterBar = filtersFor(kind, names, statusLabels, locations).filter((f) => f.key !== viewSpec?.filter?.[0])

  const panelAsset = panel?.sheet.asset
  // The panel's Asset as a row of the Selection: its row on this page if it has one, else the panel's copy without its History.
  const panelRow = (): Row | undefined => {
    if (!panelAsset) return undefined
    const { history: _h, historyError: _e, fields: _f, ...a } = panelAsset
    return rows.find((r) => r.id === a.id) ?? a
  }
  // Ticks or unticks one row; false when there's none to tick.
  const tickRow = (row?: Row) => !!row && (setSelection((s) => tick(s, [row])), true)
  // The focused row follows the panel: its row when it opens on one of this page, else none (so Space ticks the panel's Asset).
  useEffect(() => { if (panelAsset) setCursor(rows.some((r) => r.id === panelAsset.id) ? panelAsset.id : null) }, [panel?.n])
  // The panel's Asset is outside the View when it's not among the rows and searching the View for its Asset Tag doesn't find it;
  // the List's own search and filter boxes don't count. ponytail: one search per check; a tag that matches 50+ others reads as outside.
  useEffect(() => {
    if (!panelAsset || !page) return
    if (view === 'all' || page.rows.some((r) => r.id === panelAsset.id)) return setOutside(null)
    let stale = false
    window.snipeIt.list('assets', listQuery('assets', { view, search: panelAsset.assetTag, filters: {}, sort: null }))
      .then((p) => !stale && setOutside(p.rows.some((r) => r.id === panelAsset.id) ? null : panelAsset.id), () => {})
    return () => { stale = true }
  }, [panelAsset, view, page])
  // ↑/↓, Enter, Space and Esc on the Assets List (listKey); always the latest render's handler, so it sees the rows and panel shown.
  const onKey = useRef<(e: KeyboardEvent) => void>(() => {})
  onKey.current = (e) => {
    const k = e.defaultPrevented ? null : listKey(e, keyPlace(e.target), e.target instanceof Element && !!e.target.closest('.asset-panel'))
    const ids = rows.map((r) => r.id)
    if (k === 'up' || k === 'down') {
      const next = moveCursor(ids, cursor, k === 'up' ? -1 : 1)
      if (next === null) return
      setCursor(next)
      focusRow(table.current, next)
      // Even back onto the Asset shown, so an open still loading for the row passed over can't land after it.
      if (panelLive(!!panel, panelLoading)) onOpenAsset(next)
    } else if (k === 'open') {
      if (cursor === null || !ids.includes(cursor)) return
      onOpenAsset(cursor)
    } else if (k === 'tick') {
      // The focused row, which the panel follows (and which ↑/↓ move before the panel catches up); with none, the panel's Asset (a scan, then Space).
      if (!tickRow(rows.find((r) => r.id === cursor) ?? panelRow())) return
    } else if (k === 'close') {
      if (!panelLive(!!panel, panelLoading)) return
      onClosePanel()
    } else return
    e.preventDefault()
  }
  useEffect(() => {
    if (kind !== 'assets') return
    const listener = (e: KeyboardEvent) => onKey.current(e)
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  }, [kind])
  const table = useRef<HTMLTableElement>(null)
  useEffect(() => { table.current?.querySelector('tr.cursor')?.scrollIntoView({ block: 'nearest' }) }, [cursor])
  // After an action in the panel the List reloads its page; an Asset that leaves the View loses its row and the panel stays on it.
  const reloading = <A extends unknown[]>(f: (...a: A) => Promise<void>) => (...a: A) => f(...a).then(reload)
  return (
    <div className="docked">
      <div className="docked-list">
        {/* The 44px top bar: the breadcrumb (a Saved Report under its List), the count, and the List's own buttons. */}
        <header className="head topbar">
          <h1>{saved ? <><span className="dim">{listName[kind]} / </span>{saved.name}</> : listName[kind]}</h1>
          <span className="dim">{loading ? 'Loading…' : page && total.toLocaleString()}</span>
          <div className="actions">
            <button className={`quiet${customizing ? ' on' : ''}`} onClick={() => setCustomizing((c) => !c)} aria-expanded={customizing}>Columns</button>
            <button className={`quiet${naming !== null ? ' on' : ''}`} onClick={() => setNaming((n) => (n === null ? saved?.name ?? '' : null))} aria-expanded={naming !== null}>Save report…</button>
            <button className="quiet" disabled={!total || exporting === 'fetching'} aria-expanded={holdsStudentInfo(kind) ? exporting === 'asking' : undefined}
              onClick={() => (holdsStudentInfo(kind) ? setExporting((x) => (x ? null : 'asking')) : exportCsv())}>
              {exporting === 'fetching' ? 'Exporting…' : holdsStudentInfo(kind) ? 'Export CSV…' : 'Export CSV'}
            </button>
            <button className="quiet" onClick={() => (reload(), panelAsset && onOpenAsset(panelAsset.id))} disabled={loading}>Refresh</button>
            {editable(kind) && <button onClick={() => onNew(kind)}>New {singular(kind)}</button>}
          </div>
        </header>
        {/* Everything between the top bar and the table stays in view when a wide List scrolls sideways. */}
        <div className="list-top">
          {/* The Assets Views, then the Operator's Saved Reports of Assets, which open in place; only the open tab shows its count. */}
          {kind === 'assets' && (
            <div className="view-tabs" role="tablist" aria-label="Views and Saved Reports">
              {[
                ...(Object.keys(ASSET_VIEWS) as AssetView[]).map((v) => ({ key: v, name: ASSET_VIEWS[v].name, on: !saved && v === view, pick: () => pickView(v), title: undefined })),
                ...tabReports.map((r) => ({ key: r.id, name: r.name, on: saved?.id === r.id, pick: () => openReport(r), title: `Saved Report: ${ASSET_VIEWS[r.view ?? 'all'].name}` })),
              ].map((t, i) => [
                i === VIEW_COUNT && <span key="sep" className="tab-sep" aria-hidden="true" />,
                <button key={t.key} role="tab" aria-selected={t.on} className={t.on ? 'on' : undefined} onClick={() => !t.on && t.pick()} title={t.title}>
                  {t.name}
                  {t.on && page && !loading && <span className="count">{total.toLocaleString()}</span>}
                </button>,
              ])}
            </div>
          )}
          {customizing && (
            <div className="customize">
              <ol aria-label="Columns">
                <li className="k">Columns</li>
                {all.slice(1).map((c) => (
                  <li key={c.key}>
                    <label>
                      <input type="checkbox" checked={showing.includes(c.key)} disabled={c.key === viewColumn} onChange={() => pickColumn(c.key)} />
                      {c.label}{c.key === viewColumn && <span className="dim"> (this View's)</span>}
                    </label>
                  </li>
                ))}
              </ol>
            </div>
          )}
          {naming !== null && (
            <form className="toolbar actions" onSubmit={(e) => (e.preventDefault(), saveReport(false))}>
              <input autoFocus value={naming} onChange={(e) => setNaming(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setNaming(null)} placeholder="Report name" aria-label="Report name" />
              <button disabled={!naming.trim()}>{saved ? 'Save' : 'Save report'}</button>
              {saved && <button type="button" className="quiet" disabled={!naming.trim()} onClick={() => saveReport(true)}>Save as new</button>}
              <button type="button" className="quiet" onClick={() => setNaming(null)}>Cancel</button>
              <span className="dim">Saves this List's {kind === 'assets' && 'View, '}search, filters, sort and Columns.</span>
            </form>
          )}
          {/* The toolbar: search and filters, then the Selection bar at its right end while rows are ticked. */}
          <div className="toolbar actions">
            <input value={text} onChange={(e) => setText(e.target.value)} placeholder={`Search ${listName[kind]}…`} aria-label={`Search ${listName[kind]}`} />
            {filterBar.map((f) => <FilterBox key={f.key} filter={f} value={filters[f.key] ?? ''} onPick={(v) => setFilter(f.key, v)} />)}
            {/* A drilled-into filter with no box of its own (e.g. a User's, a Manufacturer's) shows as a chip that removes it. */}
            {Object.keys(drilled?.filters ?? {}).filter((k) => filters[k] && !filterBar.some((f) => f.key === k)).map((k) => (
              <button key={k} className="quiet" onClick={() => setFilter(k, '')} aria-label={`Remove filter: ${drilled?.label ?? k}`}>
                {drilled?.label ?? 'Filtered'} ×
              </button>
            ))}
            {selectable && (selection.size > 0 || selectingAll) && (
              <div className="selection-bar" role="region" aria-label="Selection">
                {/* Ticks on other pages, or hidden by the filter, still count; the bar says how many are here. */}
                <b>{selection.size.toLocaleString()} selected</b>
                {tickedHere < selection.size && <span className="dim">{tickedHere.toLocaleString()} on this page</span>}
                {selectingAll === 'asking' ? (
                  <span className="confirm" role="alertdialog" aria-label={`Select all ${total.toLocaleString()} ${listName[kind]}?`}>
                    <span>Select all {total.toLocaleString()} matching {listName[kind]}?</span>
                    <button autoFocus onClick={selectAll}>Select all</button>
                    <button className="quiet" onClick={() => setSelectingAll(null)}>Cancel</button>
                  </span>
                ) : total > rows.length && (
                  <button className="quiet" disabled={selectingAll === 'fetching' || bulk?.busy} onClick={() => (confirmSelectAll(total) ? setSelectingAll('asking') : selectAll())}>
                    {selectingAll === 'fetching' ? 'Selecting…' : `Select all ${total.toLocaleString()} matching`}
                  </button>
                )}
                {kind === 'assets' && (Object.keys(MOVES) as (keyof typeof MOVES)[]).map((m) => {
                  const cant = MOVES[m].cant([...selection.values()] as Asset[])
                  return <button key={m} className={`quiet${bulkForm === m ? ' on' : ''}`} aria-expanded={bulkForm === m} disabled={moveOff || cant} title={cant ? NOT_ALLOWED : undefined}
                    onClick={() => setBulkForm((x) => (x === m ? null : m))}>{MOVES[m].button}</button>
                })}
                {kind === 'assets' && <PrintLabel baseUrl={baseUrl} assets={[...selection.values()] as Asset[]} disabled={!!selectingAll} />}
                {mayEdit(kind, [...selection.values()]) && (
                  <button className="quiet" disabled={bulk?.busy || !!selectingAll || editing} onClick={() => setEditing(true)}>Edit shared fields…</button>
                )}
                {mayAudit(kind, [...selection.values()]) && (
                  <button className="quiet" disabled={bulk?.busy || !!selectingAll || auditing} onClick={() => setAuditing(true)}>Audit…</button>
                )}
                {mayDelete(kind, [...selection.values()]) && (confirmingDelete ? (
                  <span className="confirm" role="alertdialog" aria-label={deleteQuestion(kind, selection.size)}>
                    <span>{deleteQuestion(kind, selection.size)} They go to Snipe-IT's deleted items, one at a time.</span>
                    <button className="danger" autoFocus onClick={deleteSelection}>Delete</button>
                    <button className="quiet" onClick={() => setConfirmingDelete(false)}>Cancel</button>
                  </span>
                ) : <button className="quiet danger" disabled={bulk?.busy || !!selectingAll} onClick={() => setConfirmingDelete(true)}>Delete…</button>)}
                <button className="quiet" onClick={clear}>Clear</button>
              </div>
            )}
          </div>
          {exporting === 'asking' && <FerpaConfirm rows={Math.min(total, REPORT_MAX)} onExport={exportCsv} onCancel={() => setExporting(null)} />}
          {message.text && <p className={message.error ? 'message error' : 'message list-message'} role={message.error ? 'alert' : 'status'}>{message.text}</p>}
          {page?.tempError && <p className="message error" role="alert">Couldn't mark Temp checkouts: {page.tempError}</p>}
          {bulkForm && selection.size > 0 && kind === 'assets' && (
            <section className="list-panel" aria-label={MOVES[bulkForm].title}>
              <div className="actions">
                <b>{MOVES[bulkForm].verb} {selection.size.toLocaleString()} {selection.size === 1 ? 'Asset' : 'Assets'}</b>
                <span className="dim">One at a time, each with a result.</span>
                <button type="button" className="quiet" onClick={() => setBulkForm(null)}>Cancel</button>
              </div>
              {/* Off as its button is: while a run goes, or once the Selection holds an Asset Snipe-IT won't let the Operator act on. */}
              <fieldset className="plain" disabled={moveOff || MOVES[bulkForm].cant([...selection.values()] as Asset[])}>
                {bulkForm === 'checkout'
                  ? <CheckoutForm defaultLocation={defaultLocation} onCheckout={async (o) => runForm(checkoutAction(window.snipeIt, o))} onUnfinished={(text) => setMessage({ text, error: true })} />
                  : <BulkCheckinForm statusLabels={statusLabels} locations={locations} defaultLocation={defaultLocation} onCheckin={(o) => runForm(checkinAction(window.snipeIt, o))} />}
              </fieldset>
            </section>
          )}
          {editing && selection.size > 0 && bulkEditable(kind) && <BulkEditForm kind={kind} count={selection.size} busy={!!bulk?.busy} onApply={editSelection} onCancel={() => setEditing(false)} />}
          {auditing && selection.size > 0 && (
            <section className="list-panel" aria-label="Audit Assets">
              <AuditForm count={selection.size} busy={!!bulk?.busy} onAudit={auditSelection} onCancel={() => setAuditing(false)} />
            </section>
          )}
          {mine && <BulkResults title={mine.title} run={mine} onStop={onStopBulk} onRetry={() => onBulk(mine, retrying(mine))} onClose={onCloseBulk} />}
        </div>
        <table ref={table} className="history list-table">
          <thead>
            <tr>
              {selectable && (
                <th className="tick">
                  {/* The label fills the cell, so the whole cell ticks the box. */}
                  <label><input type="checkbox" checked={ticks === 'all'} ref={(el) => { if (el) el.indeterminate = ticks === 'some' }} disabled={!rows.length}
                    onChange={() => setSelection((s) => tick(s, rows))} aria-label="Select this page" /></label>
                </th>
              )}
              {columns.map((c) => (
                <th key={c.key} className={numeric.has(c.key) ? 'num' : undefined} aria-sort={sort?.key === c.key ? (sort.order === 'asc' ? 'ascending' : 'descending') : undefined}>
                  {Object.hasOwn(sortable, c.key)
                    ? <button className="sort" onClick={() => toggleSort(c.key)}>{c.label}{sort?.key === c.key ? (sort.order === 'asc' ? ' ▲' : ' ▼') : ''}</button>
                    : c.label}
                </th>
              ))}
              {kind === 'assets' && <th className="quick">Quick Actions</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const a = row as Asset
              // Open in the Asset panel, focused by ↑/↓, ticked.
              const docked = kind === 'assets' && panelAsset?.id === row.id
              const quickProps = (form: SheetForm) => ({ onClick: () => openAsset(row.id, form), className: docked && panel?.form === form ? 'on' : undefined })
              return (
                <tr key={row.id} {...(kind === 'assets' && { 'data-id': row.id, tabIndex: -1 })} className={[docked && 'sel', cursor === row.id && 'cursor', selection.has(row.id) && 'ticked'].filter(Boolean).join(' ') || undefined}>
                  {selectable && (
                    <td className="tick">
                      <label><input type="checkbox" checked={selection.has(row.id)} onChange={() => setSelection((s) => tick(s, [row]))}
                        aria-label={`Select ${rowName(row)}`} /></label>
                    </td>
                  )}
                  {columns.map((c, i) => cell(c, row, i === 0))}
                  {kind === 'assets' && (
                    <td className="quick">
                      {/* Each opens the Asset panel with its form ready. */}
                      <button disabled={!!checkinReason(a)} {...quickProps('checkin')} title={checkinReason(a)}>Checkin</button>
                      <button disabled={!!checkoutReason(a)} {...quickProps('checkout')} title={checkoutReason(a)}>Checkout</button>
                      <button disabled={!a.can.update} {...quickProps('status')} title={a.can.update ? undefined : NOT_ALLOWED}>Status</button>
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
        {page && rows.length === 0 && <p className="empty">{page.why ?? 'Nothing matches'}</p>}
        {total > LIST_PAGE && (
          <div className="pager actions">
            <span className="dim">{(offset + 1).toLocaleString()}–{Math.min(offset + LIST_PAGE, total).toLocaleString()} of {total.toLocaleString()}</span>
            <button className="quiet" disabled={offset === 0 || loading} onClick={() => setOffset((o) => Math.max(0, o - LIST_PAGE))}>Previous</button>
            <button className="quiet" disabled={offset + LIST_PAGE >= total || loading} onClick={() => setOffset((o) => o + LIST_PAGE)}>Next</button>
          </div>
        )}
      </div>
      {kind === 'assets' && panel && panelAsset && (
        <AssetSheet key={panel.n} {...panel.sheet} form={panel.form} onCheckin={reloading(panel.sheet.onCheckin)} onCheckout={reloading(panel.sheet.onCheckout)}
          onStatus={reloading(panel.sheet.onStatus)} onAudit={reloading(panel.sheet.onAudit)}
          onDeleted={() => (setSelection((s) => (s.has(panelAsset.id) ? new Map([...s].filter(([id]) => id !== panelAsset.id)) : s)), reload(), panel.sheet.onDeleted())}
          docked={{ ticked: selection.has(panelAsset.id), notInView: outside === panelAsset.id, onClose: onClosePanel, onTick: () => tickRow(panelRow()) }} />
      )}
    </div>
  )
}

// A Bulk Action's progress and each Record's result; Stop halts it before the next Record. Nothing is rolled back.
export function BulkResults({ title, run, onStop, onRetry, onClose }: { title: string; run: BulkRun; onStop: () => void; onRetry: () => void; onClose: () => void }) {
  const failed = run.records.filter((r) => r.outcome?.state === 'failed').length
  const inRun = new Set(run.ids)
  const c = counts(run)
  return (
    <section className="list-panel bulk" aria-label={title}>
      <div className="actions">
        <b>{title}</b>
        <span className="dim" role="status">{progress(run)}{run.busy ? '' : c.finished < c.of ? ', stopped' : ' finished'}</span>
        {run.busy
          ? <button disabled={run.stopping} onClick={onStop}>{run.stopping ? 'Stopping…' : 'Stop'}</button>
          : <>
            {failed > 0 && <button onClick={onRetry}>Retry failed ({failed.toLocaleString()})</button>}
            <button className="quiet" onClick={onClose}>Close</button>
          </>}
      </div>
      <div className="bulk-rows">
        <table className="history">
          <tbody>
            {run.records.map((r) => (
              <tr key={r.id}>
                <td>{r.name}</td>
                <td>{r.outcome ? <OutcomeText outcome={r.outcome} /> : <span className="dim">{run.busy && inRun.has(r.id) ? 'Waiting' : 'Not done: stopped before this one'}</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

// A filter box's choices as typed: a name shared with another choice, or with the "Any …" prompt, gets its id so each can be picked.
export function choices(f: Pick<Filter, 'label' | 'options'>): Option[] {
  const seen = new Map<string, number>([[f.label, 1]])
  for (const o of f.options) seen.set(o.label, (seen.get(o.label) ?? 0) + 1)
  return f.options.map((o) => (seen.get(o.label)! > 1 ? { ...o, label: `${o.label} (id ${o.value})` } : o))
}

// What typing `text` into a filter box picks: '' clears it, a choice's value picks that choice, null leaves it as it is.
// Case doesn't matter, like the datalist's own narrowing, unless two choices differ only by case.
export function filterPick(f: Pick<Filter, 'label' | 'options'>, text: string, opts = choices(f)): string | null {
  const t = text.trim().toLowerCase()
  if (!t || t === f.label.toLowerCase()) return ''
  const hits = opts.filter((o) => o.label.toLowerCase() === t)
  return (hits.length === 1 ? hits[0] : hits.find((o) => o.label === text))?.value ?? null
}

// Type to narrow the choices with the browser's own datalist: arrows move, Enter picks, Escape closes.
// Picking "Any …" or emptying the box clears the filter; text that names no choice is put back on leaving the box.
// Checkin… on a Selection: one Status Label, Location and note for every Asset. With no Location, Snipe-IT moves each to
// its own Default Location, or to none (#72).
function BulkCheckinForm({ statusLabels, locations, defaultLocation, onCheckin }: { statusLabels: StatusLabel[]; locations: StatusLabel[]; defaultLocation: StatusLabel | null; onCheckin: (o: CheckinOptions) => void }) {
  const [statusId, setStatusId] = useState<number | undefined>()
  const [locationId, setLocationId] = useState(defaultLocation?.id)
  const [note, setNote] = useState('')
  return (
    <form className="actions" onSubmit={(e) => (e.preventDefault(), onCheckin({ statusId, locationId, note }))}>
      <select autoFocus value={statusId ?? ''} onChange={(e) => setStatusId(e.target.value ? Number(e.target.value) : undefined)} aria-label="Status after Checkin">
        <option value="">Keep each Asset's status</option>
        {statusLabels.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
      </select>
      <select aria-label="Checkin Location" value={locationId ?? ''} onChange={(e) => setLocationId(e.target.value ? Number(e.target.value) : undefined)}>
        <option value="">Each Asset's Default Location, if it has one</option>
        {defaultLocation && !locations.some((l) => l.id === defaultLocation.id) && <option value={defaultLocation.id}>{defaultLocation.name}</option>}
        {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
      </select>
      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" aria-label="Checkin note" />
      <button>Checkin</button>
    </form>
  )
}

function FilterBox({ filter: f, value, onPick }: { filter: Filter; value: string; onPick: (value: string) => void }) {
  const options = choices(f)
  // A drilled-into value shows even before its names load.
  const label = options.find((o) => o.value === value)?.label ?? (value ? '…' : '')
  // Only text that names no choice yet is kept; a pick shows its label.
  const [draft, setDraft] = useState<string | null>(null)
  function change(t: string) {
    const picked = filterPick(f, t, options)
    setDraft(picked === null ? t : null)
    if (picked !== null && picked !== value) onPick(picked)
  }
  return (
    <>
      {/* Focusing selects the text, so typing starts a fresh search instead of adding to the chosen name. */}
      <input className="filter" list={`filter-${f.key}`} value={draft ?? label} placeholder={f.label} onChange={(e) => change(e.target.value)}
        onFocus={(e) => e.target.select()} onBlur={() => setDraft(null)} onKeyDown={(e) => e.key === 'Escape' && setDraft(null)} aria-label={f.label.replace(/^Any /, 'Filter by ')} />
      <datalist id={`filter-${f.key}`}>
        <option value={f.label} />
        {options.map((o) => <option key={o.value} value={o.label} />)}
      </datalist>
    </>
  )
}
