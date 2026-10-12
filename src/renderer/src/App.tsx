import { useEffect, useReducer, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { Activity, Boxes, Briefcase, Building2, Cable, Cpu, Droplet, Factory, FileSpreadsheet, FileUp, KeyRound, Laptop, LayoutGrid, ListChecks, MapPin, Package, ScanBarcode, Search, Settings as SettingsIcon, ShieldCheck, Tag, Tags, Truck, Users, Workflow as WorkflowsIcon, X, type LucideIcon } from 'lucide-react'
import { ASSET_PIECES, ASSET_VIEWS, DASHBOARD_PIECES, MIN_SNIPEIT, healthLines, lateness, toSummary, type Asset, type AssetView, type Assignee, type AssetMatch, type AssetSummary, type AssetWithHistory, type CheckinOptions, type CheckoutOptions, type CheckoutTarget, type AuditDay, type Dashboard, type DashboardPiece, type EditKind, type Failed, type Health, type HealthLine, type ListKind, type Matches, type OtherKind, type RecordKind, type SearchKind, type StatusLabel, type Tally } from '../../main/snipeit'
import type { SavedReport, Settings } from '../../main/config'
import { WORKFLOWS, type Workflow } from '../../main/notes'
import { SettingsPage } from './SettingsPage'
import { ListView, drillTo, listName, type BulkAction, type BulkRun, type Drill } from './ListView'
import { BatchView, eachInTurn, type BatchAction, type BatchItem, type Outcome } from './BatchView'
import { ReportsView } from './ReportsView'
import { ImportView } from './ImportView'
import { FieldGrid, RecordView } from './RecordView'
import { DeleteButton, RecordForm } from './RecordForm'
import { GroupsView, type CanManage } from './AccessView'
import { AssetCodes, PrintLabel } from './AssetCodes'
import { createBulkCheckout, createBulkReturn, NOT_ALLOWED } from './workflows'
import { BUILT, BulkCheckoutView, BulkReturnView, errorSound, shortcut, workflowIcon, WorkflowsPage } from './WorkflowsView'
import { Bars, ChartCard, Donut, Timeline, auditRows, chartRows, longDay, type ChartPiece } from './Charts'

const statusColor: Record<string, string> = {
  deployed: 'blue',
  deployable: 'green',
  pending: 'amber',
  archived: 'grey',
  undeployable: 'red',
}

export const StatusChip = ({ asset }: { asset: AssetSummary }) => (
  <span className={`chip c-${statusColor[asset.statusMeta] ?? 'grey'}`}>{asset.status}</span>
)

// The current status is always offered, even if the status list didn't load.
export const statusChoices = (labels: StatusLabel[], a: Asset) =>
  labels.some((l) => l.id === a.statusId) || a.statusId === null ? labels : [{ id: a.statusId, name: a.status }, ...labels]

export { NOT_ALLOWED }
// Why an Asset's Checkin / Checkout button is disabled (its title), or undefined when it may go ahead.
export const checkinReason = (a: Pick<Asset, 'can' | 'assignee'>) => (!a.can.checkin ? NOT_ALLOWED : a.assignee ? undefined : 'Not checked out')
export const checkoutReason = (a: Pick<Asset, 'can' | 'assignee' | 'checkoutAllowed' | 'status'>) =>
  !a.can.checkout ? NOT_ALLOWED : a.checkoutAllowed ? undefined : a.assignee ? 'Already checked out' : `"${a.status}" can't be checked out`

// Where a keydown goes. 'panel': the Scan/Search panel opens and takes it, for Ctrl+K from anywhere or a typed character
// outside a field (a barcode scanner types like a keyboard), so a scan made while the panel is closed is not lost.
// On a Workflow page that character goes to the Workflow's field instead. A Workflow: Ctrl+1–5 from anywhere, in
// glossary order. null: the key keeps its usual job.
export function routeKey(e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey'>, inField: boolean, onWorkflow = false): 'panel' | 'workflow field' | Workflow | null {
  if (e.altKey || e.metaKey) return null
  if (e.ctrlKey) return e.key.toLowerCase() === 'k' ? 'panel' : /^[1-5]$/.test(e.key) ? WORKFLOWS[Number(e.key) - 1] : null
  return inField || e.key.length !== 1 || e.key === ' ' ? null : onWorkflow ? 'workflow field' : 'panel'
}

// Only another server (or logging out) starts the session over; saving Email, Background or a new key for the same
// server keeps the Workflows, Bulk Action results and the open List.
export const startsOver = (before: Settings | null, after: Settings) => !before || before.baseUrl !== after.baseUrl || !after.hasToken

/** Where a key was pressed: in a field (it takes typing), on a control (a button, link or checkbox has its own Enter and Space), or neither. */
export type KeyPlace = 'field' | 'control' | 'none'
export const keyPlace = (target: EventTarget | null): KeyPlace =>
  !(target instanceof Element) ? 'none'
  : target.closest('input:not([type=checkbox], [type=radio]), textarea, select, [contenteditable]') ? 'field'
  : target.closest('button, a, summary, label, input') ? 'control' : 'none'

/** Where an opened Asset shows. On the Assets List it docks in the Asset panel and the List stays as it is (the same view, so the
 * List isn't opened again and keeps its View, filters, page and Selection); anywhere else the full Asset sheet replaces the page. */
export const opensAt = <V extends { page: string }>(view: V | null, showSettings: boolean): { docked: true; view: V } | { docked: false; view: null } =>
  !showSettings && view?.page === 'assets' ? { docked: true, view } : { docked: false, view: null }

/** The Asset panel once something done to Asset id ends (a Bulk Action, a delete): changed only while it still shows that Asset,
 * so an open that landed meanwhile stays; given n (the panel's when the work began), only while it's still that open, so a newer
 * open of the same Asset (a Quick Action's form) stays too. It never touches `latest`, so an open still loading isn't cancelled either. */
export const ifShowing = <P extends { asset: { id: number }; n: number }>(p: P | null, id: number, next: (p: P) => P | null, n?: number): P | null =>
  p?.asset.id === id && (n === undefined || p.n === n) ? next(p) : p
/** The Asset panel with its Asset reloaded after a Bulk Action: the same open (n, its key), so the sheet isn't remounted and a form
 * opened from its header meanwhile keeps its inputs. */
export const reloadPanel = <P extends { asset: { id: number }; n: number }>(p: P | null, id: number, n: number, asset: P['asset']): P | null =>
  ifShowing(p, id, (q) => ({ ...q, asset }), n)

/** Whether the docked Asset panel takes focus as it opens: not from a field holding text (the next scan, half typed), which would lose it. */
export const panelTakesFocus = (place: KeyPlace, text: string) => place !== 'field' || !text

// Stored per computer, like the Dashboard layout: whether the Scan/Search panel is open.
const PANEL_KEY = 'scanPanelOpen'

// Session only: recent scans live in memory and are never written to disk.
const RECENT_MAX = 20
// The Lists in the sidebar; every List (these and the rest) is on the All records page.
const LISTS: ListKind[] = ['assets', 'users', 'locations', 'models', 'activity']
const listIcon: Record<ListKind, LucideIcon> = {
  assets: Laptop, users: Users, locations: MapPin, models: Package, activity: Activity, licenses: KeyRound, accessories: Cable, consumables: Droplet,
  components: Cpu, categories: Tags, manufacturers: Factory, suppliers: Truck, departments: Briefcase, companies: Building2, statuslabels: Tag,
}
const kindName: Record<SearchKind, string> = { users: 'Users', locations: 'Locations', models: 'Asset Models', licenses: 'Licenses', accessories: 'Accessories', consumables: 'Consumables', components: 'Components' }
// The kinds a match opens (the Assets List filtered to it); the stocked kinds are only listed.
const opens = (kind: SearchKind): kind is OtherKind => kind === 'users' || kind === 'locations' || kind === 'models'

// What the main area shows besides an Asset: the dashboard, the batch, a report, Import, the All records page, a List, or one record's fields.
// n is bumped on every visit so a List or record starts fresh.
type View = { page: 'dashboard' } | { page: 'batch' } | { page: 'workflows' } | { page: 'workflow'; workflow: Workflow } | { page: 'reports' } | { page: 'import' } | { page: 'records' } | { page: 'groups' } | { page: ListKind; drill?: Drill; report?: SavedReport; assetView?: AssetView; n: number } | { page: 'record'; kind: RecordKind; id: number; n: number }
  | { page: 'edit'; kind: EditKind; id: number | null; n: number }
type Panel = { asset: AssetWithHistory; form?: SheetForm; n: number }

export function App() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [settingsError, setSettingsError] = useState('')
  const [locations, setLocations] = useState<StatusLabel[]>([])
  const [query, setQuery] = useState('')
  const [asset, setAsset] = useState<AssetWithHistory | null>(null)
  const [view, setView] = useState<View | null>(null)
  // Search Matches.
  const [matches, setMatches] = useState<{ label: string; assets: (AssetSummary | AssetMatch)[] }>({ label: '', assets: [] })
  // Lookup's matches of the other kinds; Users, Locations and Asset Models open the Assets List filtered to them, the stocked kinds are listed only (until #1).
  const [others, setOthers] = useState<Matches[]>([])
  const [recent, setRecent] = useState<AssetSummary[]>([])
  // Assets gathered for one Checkout or Checkin (session only, like recent scans), and the last run over them.
  const [batch, setBatch] = useState<BatchItem[]>([])
  const [batchRun, setBatchRun] = useState<{ busy: boolean; last: BatchAction | null }>({ busy: false, last: null })
  // Bumped when Settings are saved; a run still going stops, since the rest of its Assets belong to the old server.
  const batchEpoch = useRef(0)
  // One run at a time: a second would act on the same Assets and overwrite the first's results.
  const batchBusy = useRef(false)
  // The last Bulk Action over a List's Selection, kept here like the batch's run so leaving the List mid-run loses nothing.
  const [bulk, setBulk] = useState<(BulkRun & BulkAction) | null>(null)
  const bulkBusy = useRef(false)
  const bulkStop = useRef(false)
  const [statusLabels, setStatusLabels] = useState<StatusLabel[]>([])
  // Each Workflow's step, queue and Running list, kept for the session (in memory only) so leaving one loses nothing.
  const [, changed] = useReducer((n: number) => n + 1, 0)
  const [bulkCheckout] = useState(() => createBulkCheckout(window.snipeIt, { changed, failed: errorSound }))
  const [bulkReturn] = useState(() => createBulkReturn(window.snipeIt, { changed, failed: errorSound }))
  const workflowField = useRef<HTMLInputElement>(null)
  // Whether the Operator's own account may manage permissions: null until Snipe-IT says, or why it couldn't be asked.
  const [canManage, setCanManage] = useState<CanManage>(null)
  // Whether the Operator's account has Snipe-IT's import permission; Import shows only once Snipe-IT says yes.
  const [canImport, setCanImport] = useState(false)
  // Bumped on every open so the sheet (and its Checkin form inputs) starts fresh.
  const [opened, setOpened] = useState(0)
  // The Asset docked in the Asset panel on the Assets List, the form a Quick Action opened in it, and n, bumped on every open so it starts fresh.
  const [panel, setPanel] = useState<Panel | null>(null)
  // Set when an open docks in the Asset panel, which then takes focus instead of the Scan box.
  const docking = useRef(false)
  // The last panel n handed out; never reused, so work begun on a closed panel can't match one reopened on the same Asset.
  const panelN = useRef(0)
  // One place for what the rail says: an info line, or an error (shown the same way for every failure).
  const [message, setMessage] = useState<{ text: string; error?: boolean }>({ text: '' })
  const search = useRef<HTMLInputElement>(null)
  const [panelOpen, setPanelOpen] = useState(() => localStorage.getItem(PANEL_KEY) !== 'false')
  useEffect(() => localStorage.setItem(PANEL_KEY, String(panelOpen)), [panelOpen])
  // Rendered now, so the box can take focus (and the keystroke being handled) straight away; what was in it is selected, so a scan replaces it.
  function openPanel() {
    flushSync(() => setPanelOpen(true))
    search.current?.focus()
    search.current?.select()
  }
  // Bumped by every lookup or open; a result that returns after a newer one started is discarded.
  const latest = useRef(0)
  // The lookup or open still loading, if any; the rail says so until it's done or discarded.
  const [busy, setBusy] = useState(0)
  // Discards any lookup or open still loading, so it can't pull the Operator off the page they chose.
  const cancel = () => (setBusy(0), ++latest.current)

  const page = !showSettings && view?.page
  const onWorkflow = page === 'workflow'
  // Read by run(), whose closure may predate the page it finishes on.
  const workflowShowing = useRef(onWorkflow)
  workflowShowing.current = onWorkflow
  // Straight in, skipping the Workflows page; from Settings too, like the sidebar. Rendered now, so its field takes focus
  // even when the Workflow was already showing (e.g. Ctrl+K, then Ctrl+2 to carry on scanning).
  function openWorkflow(workflow: Workflow) {
    cancel()
    flushSync(() => (setShowSettings(false), setView({ page: 'workflow', workflow })))
    workflowField.current?.focus()
  }

  useEffect(() => search.current?.focus(), [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const to = routeKey(e, keyPlace(e.target) === 'field', onWorkflow)
      if (!to) return
      // Ctrl+K and Ctrl+1–5 are the app's; a typed character goes on to the box or field once it has focus.
      if (e.ctrlKey) e.preventDefault()
      if (to === 'panel') openPanel()
      else if (to === 'workflow field') workflowField.current?.focus()
      // Unbuilt Workflows do nothing; nothing does until an API key is saved.
      else if (settings?.hasToken && BUILT.includes(to)) openWorkflow(to)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onWorkflow, settings?.hasToken])
  useEffect(() => {
    window.settings.get().then((value) => { setSettings(value); setShowSettings(!value.hasToken) }, (e: Error) => { setSettingsError(e.message); setShowSettings(true) })
  }, [])
  useEffect(() => {
    let stale = false
    if (settings?.hasToken) {
      // Keep the Asset's current status available if loading labels fails.
      window.snipeIt.statusLabels().then((v) => !stale && setStatusLabels(v), () => {})
      window.snipeIt.locations().then((v) => !stale && setLocations(v), () => {})
      window.snipeIt.canManagePermissions().then((v) => !stale && setCanManage(v), (e: Error) => !stale && setCanManage({ error: e.message }))
      // Unlike permissions, there's nowhere to say why it couldn't be checked; Import just stays hidden.
      window.snipeIt.canImport().then((v) => !stale && setCanImport(v), () => {})
    }
    return () => { stale = true }
  }, [settings])

  function saved(value: Settings) {
    const over = startsOver(settings, value)
    setSettings(value)
    if (!over) return
    bulkCheckout.reset()
    bulkReturn.reset()
    cancel(); setAsset(null); setPanel(null); setRecent([]); batchEpoch.current++; batchBusy.current = false; setBatch([]); bulkBusy.current = false; setBulk(null); setBatchRun({ busy: false, last: null }); setMatches({ label: '', assets: [] }); setOthers([]); setView(null); setQuery(''); setMessage({ text: '' }); setStatusLabels([]); setLocations([]); setCanManage(null); setCanImport(false)
  }

  // Runs one lookup/open; `work` gets an isStale() check to call after each await.
  async function run(work: (isStale: () => boolean) => Promise<void>) {
    const mine = ++latest.current
    const isStale = () => mine !== latest.current
    docking.current = false
    setBusy(mine)
    try {
      await work(isStale)
    } catch (err) {
      // The current Asset and rail stay as they were; only the message changes.
      if (!isStale()) setMessage({ text: (err as Error).message, error: true })
    } finally {
      setBusy((b) => (b === mine ? 0 : b))
      // Only the newest run moves focus: one superseded by ↑/↓ mustn't pull it into the Scan box after the panel took it.
      // Not while a Workflow shows either: its field keeps focus, so the next scan lands there.
      if (!isStale() && !docking.current && !workflowShowing.current) search.current?.focus()
    }
  }

  // form: the form a Quick Action opens in the Asset panel.
  async function open(id: number, isStale: () => boolean, form?: SheetForm) {
    const full = await window.snipeIt.getAsset(id)
    if (isStale()) return
    if (opensAt(view, showSettings).docked) {
      docking.current = true
      setPanel({ asset: full, form, n: ++panelN.current })
    } else {
      setShowSettings(false)
      setAsset(full)
      setView(null)
      setOpened((n) => n + 1)
    }
    setMessage({ text: '' })
    setRecent((r) => [toSummary(full), ...r.filter((x) => x.id !== full.id)].slice(0, RECENT_MAX))
  }

  const pick = (id: number, form?: SheetForm) => run((isStale) => open(id, isStale, form))
  // While the batch is open, a scanned or picked Asset joins it instead of opening.
  const batching = !showSettings && view?.page === 'batch'
  function addToBatch(...assets: AssetSummary[]) {
    // Membership is read from the render-time batch for the message; the updater re-checks so a stale closure can never add a duplicate.
    const known = assets.filter((a) => batch.some((b) => b.id === a.id)).length
    setBatch((b) => [...b, ...assets.filter((a) => !b.some((x) => x.id === a.id))])
    const added = assets.length - known
    setMessage({ text: assets.length === 1
      ? known ? `${assets[0].assetTag} is already in the batch` : `Added ${assets[0].assetTag} to the batch`
      : `Added ${added} ${added === 1 ? 'Asset' : 'Assets'} to the batch${known ? `; ${known} already in it` : ''}` })
  }
  const choose = (a: AssetSummary) => (batching ? addToBatch(a) : pick(a.id))
  async function runBatch(action: BatchAction, ids: number[]) {
    if (batchBusy.current) return
    batchBusy.current = true
    const epoch = batchEpoch.current
    const stale = () => epoch !== batchEpoch.current
    const setOutcome = (id: number, outcome?: Outcome) => setBatch((b) => b.map((a) => (a.id === id ? { ...a, outcome } : a)))
    // This run's rows start blank, so an earlier result can't pass for this one's.
    ids.forEach((id) => setOutcome(id))
    setBatchRun({ busy: true, last: action })
    // A result that lands after Settings changed belongs to the old server; drop it.
    await eachInTurn(ids, action.work, action.done, (id, outcome) => !stale() && setOutcome(id, outcome), stale)
    if (stale()) return
    batchBusy.current = false
    setBatchRun((r) => ({ ...r, busy: false }))
  }

  // Acts on each Record in turn with the usual single edit or delete, so History credits the Operator for each; a failure
  // doesn't stop the rest, Stop halts before the next one. Like the batch, it stops when Settings point at another server.
  async function runBulk(action: BulkAction, run: BulkRun) {
    if (bulkBusy.current) return
    bulkBusy.current = true
    bulkStop.current = false
    const epoch = batchEpoch.current
    const stale = () => epoch !== batchEpoch.current
    // A retry passes the last run as its action; only the action is kept from it.
    const { kind, title, done, work, deletes } = action
    setBulk({ kind, title, done, work, deletes, ...run, busy: true })
    await eachInTurn(run.ids, work, done, (id, outcome) => {
      if (stale()) return
      setBulk((b) => b && { ...b, records: b.records.map((r) => (r.id === id ? { ...r, outcome } : r)) })
      if (deletes && kind === 'assets' && outcome.state === 'done') forget(id)
    }, () => stale() || bulkStop.current)
    if (stale()) return
    bulkBusy.current = false
    setBulk((b) => b && { ...b, busy: false })
  }

  // A rejected Checkout/Checkin throws before the refresh, so the sheet and typed inputs stay and the rail shows Snipe-IT's reason.
  const act = (id: number, done: string, work: Promise<void>) =>
    run(async (isStale) => {
      await work
      // Don't let a failed refresh read as a failed action; retrying would only be refused.
      await open(id, isStale).catch((e: Error) => {
        throw new Error(`${done}, but couldn't refresh the Asset: ${e.message}`)
      })
    })
  const checkin = (id: number, options: CheckinOptions) => act(id, 'Checked in', window.snipeIt.checkin(id, options))
  const checkout = (id: number, options: CheckoutOptions) => act(id, 'Checked out', window.snipeIt.checkout(id, options))
  const changeStatus = (id: number, statusId: number) => act(id, 'Changed the status', window.snipeIt.updateStatus(id, statusId))

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    const q = query.trim()
    run(async (isStale) => {
      const result = await window.snipeIt.lookup(q)
      if (isStale()) return
      if (!result.exact) {
        setMatches({ label: `Assets (${result.assets.length})`, assets: result.assets })
        setOthers(result.others)
        const none = !result.assets.length && result.others.every((m) => 'rows' in m && !m.rows.length)
        return setMessage({ text: none ? `Nothing matches "${q}"` : '' })
      }
      // Only an exact Asset Tag hit clears the box; a text search keeps the query to refine.
      setMatches({ label: '', assets: [] })
      setOthers([])
      // Leave the box alone if the next scan has already started typing into it.
      setQuery((current) => (current.trim() === q ? '' : current))
      if (batching) return addToBatch(toSummary(result.assets[0]))
      await open(result.assets[0].id, isStale)
    })
  }

  const selected = view ? (opensAt(view, showSettings).docked ? panel?.asset.id : undefined) : asset?.id
  // An Upcoming audits day lists its Assets in the panel (there's no List filter by next audit date); the dashboard stays put,
  // so the Operator can click through several days in turn.
  const showAuditDay = (d: AuditDay) => (setPanelOpen(true), setMatches({ label: `Next audit ${longDay(d.day)} (${d.assets.length})`, assets: d.assets }), setOthers([]), setMessage({ text: '' }))
  const go = (page: ListKind, drill?: Drill, report?: SavedReport, assetView?: AssetView) => (setShowSettings(false), setPanel(null), setView({ page, drill, report, assetView, n: cancel() }))
  const openRecord = (kind: RecordKind, id: number) => (setShowSettings(false), setView({ page: 'record', kind, id, n: cancel() }))
  // A new record (id null) or an edit; saved, it opens, so the Operator sees what Snipe-IT kept.
  const editRecord = (kind: EditKind, id: number | null) => (setShowSettings(false), setView({ page: 'edit', kind, id, n: cancel() }))
  const shown = (kind: EditKind, id: number) => (kind === 'assets' ? pick(id) : openRecord(kind, id))
  // A deleted Asset leaves the rail.
  function forget(id: number) {
    setRecent((r) => r.filter((a) => a.id !== id))
    setMatches((m) => ({ ...m, assets: m.assets.filter((a) => a.id !== id) }))
  }
  function deleted(kind: EditKind, id: number, name: string) {
    if (kind === 'assets') forget(id)
    go(kind)
    setMessage({ text: `Deleted ${name}` })
  }
  // What the Asset sheet needs for one Asset; the full sheet and the Asset panel get the same, so the two act alike.
  const sheetProps = (a: AssetWithHistory, onDeleted: () => void): SheetProps => ({
    asset: a, baseUrl: settings?.baseUrl ?? '', defaultLocation: settings?.defaultLocation ?? null, locations, statusLabels,
    onCheckin: checkin, onCheckout: checkout, onStatus: changeStatus, onOpenRecord: openRecord, onOpenAsset: pick, onEdit: () => editRecord('assets', a.id), onDeleted,
  })
  // An Asset deleted from the panel leaves it (unless another Asset opened there meanwhile); the List stays.
  const panelDeleted = (a: Asset) => (forget(a.id), setPanel((p) => ifShowing(p, a.id, () => null)), setMessage({ text: `Deleted ${a.assetTag}` }))
  // After a Bulk Action: reload the panel's Asset, or close it after a delete, without cancelling an open still loading (a click on another row).
  // n: the panel's open as the Bulk Action began, so a newer open (of the same Asset too) stays.
  const refreshPanel = (id: number, n: number) => window.snipeIt.getAsset(id).then((full) => setPanel((p) => reloadPanel(p, id, n, full)), (e: Error) => setMessage({ text: e.message, error: true }))
  const dropPanel = (id: number) => setPanel((p) => ifShowing(p, id, () => null))
  // The All records item stands for every page not in the sidebar.
  const elsewhere = page === 'records' || page === 'record' || page === 'edit' || page === 'groups' || (!!page && page in listName && !LISTS.includes(page as ListKind))

  // Scans waiting or working across Workflows, so an Operator who left mid-run sees work is still going.
  const workflowsBusy = bulkCheckout.runner.pending + bulkReturn.runner.pending

  // What the rail says; with the panel closed it shows above the page instead, so an error is never hidden.
  const railMessage = <>
    {busy > 0 && <p className="message" role="status">Loading…</p>}
    {message.text && (
      <p className={message.error ? 'message error' : 'message'} role={message.error ? 'alert' : undefined}>
        {message.text}
      </p>
    )}
  </>

  return (
    <div className="layout">
      <aside className="rail">
        <nav className="sidebar" aria-label="Pages">
          <div className="brand"><span className="logo" aria-hidden="true">S</span>Snipe-IT Desktop</div>
          <button aria-label="Search or scan" aria-controls={panelOpen ? 'scan-panel' : undefined} className="find" onClick={openPanel}>
            <Search size={14} />Search or scan<kbd>Ctrl K</kbd>
          </button>
          <button aria-label="Dashboard" disabled={!settings?.hasToken} className={`nav${page === 'dashboard' ? ' sel' : ''}`} onClick={() => (cancel(), setShowSettings(false), setView({ page: 'dashboard' }))}>
            <LayoutGrid size={18} />Dashboard
          </button>
          {LISTS.map((k) => {
            const Icon = listIcon[k]
            return <button key={k} aria-label={listName[k]} disabled={!settings?.hasToken} className={`nav${page === k ? ' sel' : ''}`} onClick={() => go(k)}><Icon size={18} />{listName[k]}</button>
          })}
          <button aria-label="Reports" disabled={!settings?.hasToken} className={`nav${page === 'reports' ? ' sel' : ''}`} onClick={() => (cancel(), setShowSettings(false), setView({ page: 'reports' }))}>
            <FileSpreadsheet size={18} />Reports
          </button>
          {canImport && (
            <button aria-label="Import" disabled={!settings?.hasToken} className={`nav${page === 'import' ? ' sel' : ''}`} onClick={() => (cancel(), setShowSettings(false), setView({ page: 'import' }))}>
              <FileUp size={18} />Import
            </button>
          )}
          <button aria-label="All records" disabled={!settings?.hasToken} className={`nav${elsewhere ? ' sel' : ''}`} onClick={() => (cancel(), setShowSettings(false), setView({ page: 'records' }))}>
            <Boxes size={18} />All records
          </button>
          <button aria-label={`Batch, ${batch.length} ${batch.length === 1 ? 'Asset' : 'Assets'}`} disabled={!settings?.hasToken} className={`nav${page === 'batch' ? ' sel' : ''}`} onClick={() => (cancel(), setShowSettings(false), setView({ page: 'batch' }))}>
            <ListChecks size={18} />Batch
            {batch.length > 0 && <span className="badge">{batch.length}</span>}
          </button>
          <button aria-label={`Workflows${workflowsBusy ? `, ${workflowsBusy} waiting or working` : ''}`} disabled={!settings?.hasToken} className={`nav${page === 'workflows' ? ' sel' : ''}`} onClick={() => (cancel(), setShowSettings(false), setView({ page: 'workflows' }))}>
            <WorkflowsIcon size={18} />Workflows
            {workflowsBusy > 0 && <span className="badge">{workflowsBusy}</span>}
          </button>
          {BUILT.map((w) => {
            const Icon = workflowIcon[w]!
            return <button key={w} aria-label={w} disabled={!settings?.hasToken} className={`nav sub${page === 'workflow' && view?.page === 'workflow' && view.workflow === w ? ' sel' : ''}`} onClick={() => openWorkflow(w)}><Icon size={18} />{w}<kbd>{shortcut(w)}</kbd></button>
          })}
          <button aria-label="Settings" className={`nav settings-nav${showSettings ? ' sel' : ''}`} onClick={() => { cancel(); setShowSettings(true) }}><SettingsIcon size={18} />Settings</button>
        </nav>
        {panelOpen && <div className="panel" id="scan-panel">
          <form onSubmit={onSubmit}>
            <ScanBarcode size={18} />
            <input
              disabled={!settings?.hasToken || showSettings}
              ref={search}
              className="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Scan / search…"
              aria-label="Scan an Asset Tag, or search everything"
            />
            <button type="button" className="panel-close" aria-label="Close Scan/Search" onClick={() => setPanelOpen(false)}><X size={16} /></button>
          </form>
          {railMessage}
          <div className="list">
            {matches.assets.length > 0 && <AssetList label={matches.label} assets={matches.assets} selected={selected} onPick={choose} />}
            {others.map((m) => 'error' in m
              ? <p key={m.kind} className="message error">{kindName[m.kind]}: {m.error}</p>
              : m.rows.length > 0 && (
                <div key={m.kind}>
                  <div className="section">{kindName[m.kind]} ({m.rows.length})</div>
                  {m.rows.map((t) => {
                    const text = <>
                      <span className="t">{t.name}</span>
                      {t.detail && <span className="n">{t.detail}</span>}
                      {t.matched && <span className="n">Found in {t.matched}</span>}
                    </>
                    const kind = m.kind
                    return opens(kind)
                      ? <button key={t.id} className="row" onClick={() => go('assets', drillTo(kind, t))}>{text}</button>
                      : <div key={t.id} className="row static">{text}</div>
                  })}
                </div>
              ))}
            {recent.length > 0 && <AssetList label="Recent scans" assets={recent} selected={selected} onPick={choose} />}
          </div>
        </div>}
      </aside>
      <main className="sheet">{!panelOpen && <div className="sheet-status">{railMessage}</div>}{showSettings ? settings ? <SettingsPage settings={settings} onSaved={saved} onAppearance={setSettings} /> : <p className="message error" role="alert">{settingsError || 'Loading settings…'}</p> : view?.page === 'dashboard' ? <DashboardView onPick={pick} onDrill={(d) => go('assets', d)} onAuditDay={showAuditDay} onAssetView={(v) => go('assets', undefined, undefined, v)} onSettings={() => (cancel(), setShowSettings(true))} /> : view?.page === 'reports' ? <ReportsView onOpenSaved={(r) => go(r.kind, { filters: r.filters, label: r.label }, r)} /> : view?.page === 'import' ? <ImportView />
        : view?.page === 'workflows' ? <WorkflowsPage doneCount={(w) => (w === 'Bulk checkout' ? bulkCheckout : bulkReturn).runner.rows.filter((r) => r.result.state === 'done').length} onOpen={openWorkflow} />
        : view?.page === 'workflow' && view.workflow === 'Bulk checkout' ? <BulkCheckoutView flow={bulkCheckout} field={workflowField} onOpenAsset={pick} />
        : view?.page === 'workflow' ? <BulkReturnView flow={bulkReturn} locations={locations} field={workflowField} onOpenAsset={pick} onDone={() => (cancel(), bulkReturn.done(), setView({ page: 'workflows' }))} /> : view?.page === 'batch' ? <BatchView batch={batch} busy={batchRun.busy} last={batchRun.last} onRun={runBatch} onRemove={(ids) => setBatch((b) => b.filter((a) => !ids.includes(a.id)))} onClear={() => (setBatch([]), setBatchRun({ busy: false, last: null }))} statusLabels={statusLabels} locations={locations} defaultLocation={settings?.defaultLocation ?? null} onOpenAsset={pick} />
        : view?.page === 'records' ? <RecordsIndex onGo={go} onGroups={() => (cancel(), setView({ page: 'groups' }))} />
        : view?.page === 'groups' ? <GroupsView canManage={canManage} />
        : view?.page === 'record' ? <RecordView key={view.n} kind={view.kind} id={view.id} onOpenRecord={openRecord} onOpenAsset={pick} onDrill={go} onEdit={editRecord} onDeleted={deleted} canManage={canManage} />
        : view?.page === 'edit' ? <RecordForm key={view.n} kind={view.kind} id={view.id} onSaved={(id) => shown(view.kind, id)} onCancel={() => (view.id === null ? go(view.kind) : shown(view.kind, view.id))} />
        : view ? <ListView key={view.n} kind={view.page} drill={view.drill} report={view.report} assetView={view.assetView} baseUrl={settings?.baseUrl ?? ''} statusLabels={statusLabels} locations={locations} onOpenAsset={pick} onOpenRecord={openRecord} batch={batch} onBatch={(assets) => addToBatch(...assets)} onNew={(k) => editRecord(k, null)}
          panel={panel && { n: panel.n, form: panel.form, sheet: sheetProps(panel.asset, () => panelDeleted(panel.asset)) }} onClosePanel={() => (cancel(), setPanel(null))} panelLoading={busy !== 0} onRefreshPanel={refreshPanel} onDropPanel={dropPanel}
          bulk={bulk} onBulk={runBulk} onStopBulk={() => { bulkStop.current = true; setBulk((b) => b && { ...b, stopping: true }) }} onCloseBulk={() => setBulk(null)} />
        : asset ? <AssetSheet key={opened} {...sheetProps(asset, () => deleted('assets', asset.id, asset.assetTag))} /> : <p className="empty">Scan an Asset Tag</p>}</main>
    </div>
  )
}

// Every List, the ones in the sidebar and the rest.
function RecordsIndex({ onGo, onGroups }: { onGo: (page: ListKind) => void; onGroups: () => void }) {
  return (
    <>
      <header className="head"><h1>All records</h1></header>
      <div className="records">
        {(Object.keys(listName) as ListKind[]).map((k) => {
          const Icon = listIcon[k]
          return <button key={k} className="record-kind" onClick={() => onGo(k)}><Icon size={20} />{listName[k]}</button>
        })}
        <button className="record-kind" onClick={onGroups}><ShieldCheck size={20} />Permission groups</button>
      </div>
    </>
  )
}

function AssetList(props: { label: string; assets: (AssetSummary | AssetMatch)[]; selected?: number; onPick: (a: AssetSummary) => void }) {
  return (
    <>
      <div className="section">{props.label}</div>
      {props.assets.map((a) => (
        <button key={a.id} className={`row${a.id === props.selected ? ' sel' : ''}`} onClick={() => props.onPick(a)}>
          <span className="mono t">{a.assetTag}</span>
          <StatusChip asset={a} />
          <span className="n">
            <span>{a.name || '—'}</span>
            <span>{a.assignee?.name ?? 'Unassigned'}</span>
          </span>
          {'matched' in a && a.matched && <span className="n">Found in {a.matched}</span>}
        </button>
      ))}
    </>
  )
}

const kind: Record<Assignee['type'], string> = { user: 'User', location: 'Location', asset: 'Asset' }

// A Checkin with no Location moves the Asset to its Default Location, or to none; the empty choice says which.
export const defaultLocationChoice = (name: string) => (name ? `Default Location (${name})` : 'No Location')

// autoFocus: false keeps focus where it is (a half-typed scan in the Scan box) as the form opens.
export function CheckinForm(props: { defaultLocation: StatusLabel | null; locations: StatusLabel[]; asset: Asset; statusLabels: StatusLabel[]; onCheckin: (id: number, o: CheckinOptions) => Promise<void>; autoFocus?: boolean }) {
  const [locationId, setLocationId] = useState(props.defaultLocation?.id)
  const a = props.asset
  const [statusId, setStatusId] = useState(a.statusId)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const off = !a.assignee || !a.can.checkin || busy
  const labels = statusChoices(props.statusLabels, a)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    await props.onCheckin(a.id, { statusId: statusId ?? undefined, locationId, note })
    setBusy(false)
  }

  return (
    <form className="actions" onSubmit={onSubmit}>
      <select
        autoFocus={props.autoFocus ?? true}
        value={statusId ?? ''}
        onChange={(e) => setStatusId(Number(e.target.value))}
        disabled={off}
        aria-label="Status after Checkin"
      >
        {statusId === null && <option value="" disabled>Choose a status</option>}
        {labels.map((l) => (
          <option key={l.id} value={l.id}>{l.name}</option>
        ))}
      </select>
      <select aria-label="Checkin Location" disabled={off} value={locationId ?? ''} onChange={(e) => setLocationId(e.target.value ? Number(e.target.value) : undefined)}>
        <option value="">{defaultLocationChoice(a.defaultLocation)}</option>
        {props.defaultLocation && !props.locations.some((l) => l.id === props.defaultLocation?.id) && <option value={props.defaultLocation.id}>{props.defaultLocation.name}</option>}
        {props.locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
      </select>
      <input value={note} onChange={(e) => setNote(e.target.value)} disabled={off} placeholder="Note (optional)" aria-label="Checkin note" />
      <button disabled={off} title={checkinReason(a)}>
        {busy ? 'Checking in…' : 'Checkin'}
      </button>
    </form>
  )
}

export function CheckoutForm(props: { defaultLocation: StatusLabel | null; onCheckout: (o: CheckoutOptions) => Promise<void>; autoFocus?: boolean }) {
  const [targetType, setTargetType] = useState<CheckoutOptions['targetType']>('user')
  const [text, setText] = useState('')
  const [found, setFound] = useState<CheckoutTarget[]>([])
  const [searchError, setSearchError] = useState('')
  const [target, setTarget] = useState<CheckoutTarget | null>(null)
  const [expectedCheckin, setExpectedCheckin] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  // Search as the Operator types, after a short pause; an answer for older text is discarded.
  useEffect(() => {
    let stale = false
    const timer = setTimeout(() => {
      const search = targetType === 'user' ? window.snipeIt.searchUsers : window.snipeIt.searchLocations
      search(text).then(
        (t) => !stale && (setFound(t), setSearchError('')),
        (e: Error) => !stale && setSearchError(e.message),
      )
    }, 250)
    return () => {
      stale = true
      clearTimeout(timer)
    }
  }, [targetType, text])

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!target) return
    setBusy(true)
    await props.onCheckout({ targetType, targetId: target.id, expectedCheckin: expectedCheckin || undefined, note })
    setBusy(false)
  }

  return (
    <form className="checkout" onSubmit={onSubmit}>
      <div className="actions">
        <select
          value={targetType}
          // Drop the other kind's results so a User id is never sent as a Location (or vice versa).
          onChange={(e) => (setTargetType(e.target.value as CheckoutOptions['targetType']), setTarget(e.target.value === 'location' && props.defaultLocation ? { ...props.defaultLocation, detail: '' } : null), setText(e.target.value === 'location' ? props.defaultLocation?.name ?? '' : ''), setFound([]))}
          aria-label="Check out to"
        >
          <option value="user">User</option>
          <option value="location">Location</option>
        </select>
        <input
          autoFocus={props.autoFocus ?? true}
          value={text}
          onChange={(e) => (setText(e.target.value), setTarget(null))}
          placeholder={`Search ${kind[targetType]}s by name…`}
          aria-label={`Search ${kind[targetType]}s`}
        />
        <input type="date" value={expectedCheckin} onChange={(e) => setExpectedCheckin(e.target.value)} aria-label="Expected Checkin (optional)" title="Expected Checkin (optional)" />
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" aria-label="Checkout note" />
        <button disabled={!target || busy}>{busy ? 'Checking out…' : target ? `Checkout to ${target.name}` : 'Checkout'}</button>
      </div>
      {searchError ? (
        <p className="message error" role="alert">{searchError}</p>
      ) : (
        !target && text.trim() && (
          <div className="targets">
            {found.map((t) => (
              <button type="button" key={t.id} onClick={() => setTarget(t)}>
                {t.name} {t.detail && <span className="dim">{t.detail}</span>}
              </button>
            ))}
            {found.length === 0 && <span className="dim">No {kind[targetType]} matches "{text.trim()}"</span>}
          </div>
        )
      )}
    </form>
  )
}

export function StatusForm({ asset: a, statusLabels, onSave, autoFocus = true }: { asset: Asset; statusLabels: StatusLabel[]; onSave: (statusId: number) => Promise<void>; autoFocus?: boolean }) {
  const [statusId, setStatusId] = useState(a.statusId)
  const [busy, setBusy] = useState(false)
  const labels = statusChoices(statusLabels, a)
  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (statusId === null) return
    setBusy(true)
    await onSave(statusId)
    setBusy(false)
  }
  return (
    <form className="actions" onSubmit={onSubmit}>
      <select autoFocus={autoFocus} value={statusId ?? ''} onChange={(e) => setStatusId(Number(e.target.value))} aria-label={`New status for ${a.assetTag}`}>
        {statusId === null && <option value="" disabled>Choose a status</option>}
        {labels.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
      </select>
      <button disabled={busy || statusId === null || statusId === a.statusId}>{busy ? 'Saving…' : 'Save status'}</button>
    </form>
  )
}

/** The forms the Asset sheet opens under its header; a Quick Action opens one in the Asset panel. */
export type SheetForm = 'checkin' | 'checkout' | 'status'
/** What the Asset sheet needs; App builds it, so the full sheet and the Asset panel act the same way. */
export type SheetProps = {
  asset: AssetWithHistory
  baseUrl: string
  defaultLocation: StatusLabel | null
  locations: StatusLabel[]
  statusLabels: StatusLabel[]
  onCheckin: (id: number, o: CheckinOptions) => Promise<void>
  onCheckout: (id: number, o: CheckoutOptions) => Promise<void>
  onStatus: (id: number, statusId: number) => Promise<void>
  onOpenRecord: (kind: RecordKind, id: number) => void
  onOpenAsset: (id: number) => void
  onEdit: () => void
  onDeleted: () => void
}
/** The Asset panel's extras: Tick (the Asset in the List's Selection or not), Close, and whether the Asset is outside the open View. */
export type Docked = { ticked: boolean; onTick: () => void; onClose: () => void; notInView: boolean }

// One component in two places: the full Asset sheet, or docked beside the Assets List as the Asset panel.
// form: the form it opens with (a Quick Action's).
export function AssetSheet({ asset: a, baseUrl, statusLabels, onCheckin, onCheckout, onStatus, defaultLocation, locations, onOpenRecord, onOpenAsset, onEdit, onDeleted, form: initialForm, docked }: SheetProps & { form?: SheetForm; docked?: Docked }) {
  const [form, setForm] = useState<SheetForm | null>(initialForm ?? null)
  const root = useRef<HTMLDivElement>(null)
  // Read as it renders, before a form's autoFocus moves it: a field holding text (a half-typed scan) keeps focus.
  const active = document.activeElement
  const takesFocus = panelTakesFocus(keyPlace(active), (active as HTMLInputElement | null)?.value ?? '')
  // Docked without a form, the panel takes focus, so ↑/↓, Space and Esc work at once and the next scan still reaches the Scan box.
  useEffect(() => {
    if (docked && !initialForm && takesFocus) root.current?.focus()
  }, [])
  const toggle = (f: SheetForm) => setForm((open) => (open === f ? null : f))
  // Esc cancels the open form and stops there; with no form open it goes on to close the Asset panel.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'Escape' || !form) return
    e.preventDefault()
    setForm(null)
    root.current?.focus()
  }
  const facts: [string, string, boolean?][] = [
    ['Assignee', a.assignee?.name ?? 'Unassigned'],
    ['Type', a.assignee ? kind[a.assignee.type] : ''],
    ['Expected checkin', a.expectedCheckin ?? ''],
    ['Location', a.location],
    ['Last audited', a.lastAudited ?? 'Never'],
    ['Next audit', a.nextAudit ?? ''],
    ['Serial', a.serial, true],
    ['Category', a.category],
    ['Purchased', a.purchaseDate ?? ''],
    ['Warranty ends', a.warrantyEnd ?? ''],
  ]
  const canCheckout = !checkoutReason(a)
  return (
    <div ref={root} onKeyDown={onKeyDown} {...(docked && { className: 'asset-panel', tabIndex: -1, role: 'region', 'aria-label': `Asset panel: ${a.assetTag}` })}>
      <header className="head">
        <span className="tag">{a.assetTag}</span>
        <h1>
          {a.name || 'Unnamed Asset'}
          <span className="sub">{a.model}</span>
        </h1>
        {docked && <button className="panel-close" aria-label="Close the Asset panel" title="Close (Esc)" onClick={docked.onClose}><X size={16} /></button>}
        <div className="sheet-status-line">
          <StatusChip asset={a} />
          {a.overdue !== null && <span className="flag c-red">Overdue {lateness(a.overdue)}</span>}
          {a.warranty &&
            (a.warranty.expired ? (
              <span className="flag c-grey">Warranty expired</span>
            ) : (
              <span className="flag c-amber">Warranty {a.warranty.daysLeft}d left</span>
            ))}
        </div>
        <div className="actions">
          <button className={checkinReason(a) ? 'quiet' : undefined} disabled={!!checkinReason(a)} title={checkinReason(a)} aria-expanded={form === 'checkin'} onClick={() => toggle('checkin')}>Checkin</button>
          <button className={canCheckout ? undefined : 'quiet'} disabled={!canCheckout} title={checkoutReason(a)} aria-expanded={form === 'checkout'} onClick={() => toggle('checkout')}>Checkout…</button>
          <button className={`quiet${form === 'status' ? ' on' : ''}`} disabled={!a.can.update} title={a.can.update ? undefined : NOT_ALLOWED} aria-expanded={form === 'status'} onClick={() => toggle('status')}>Status</button>
          <button className="quiet" onClick={onEdit} disabled={!a.can.update} title={a.can.update ? undefined : NOT_ALLOWED}>Edit</button>
          <PrintLabel baseUrl={baseUrl} assets={[a]} />
          <DeleteButton kind="assets" id={a.id} name={a.assetTag} onDeleted={onDeleted} allowed={a.can.delete} />
          {docked && <button className={`quiet${docked.ticked ? ' on' : ''}`} aria-pressed={docked.ticked} title="Add to the Selection or take it out (Space)" onClick={docked.onTick}>{docked.ticked ? 'Ticked' : 'Tick'}</button>}
        </div>
      </header>
      {docked?.notInView && <p className="notice">Not in this View</p>}
      {form && (
        <div className="sheet-form">
          {form === 'checkin' && <CheckinForm defaultLocation={defaultLocation} locations={locations} asset={a} statusLabels={statusLabels} onCheckin={onCheckin} autoFocus={takesFocus} />}
          {form === 'checkout' && canCheckout && <CheckoutForm defaultLocation={defaultLocation} onCheckout={(o) => onCheckout(a.id, o)} autoFocus={takesFocus} />}
          {form === 'status' && <StatusForm asset={a} statusLabels={statusLabels} onSave={(statusId) => onStatus(a.id, statusId)} autoFocus={takesFocus} />}
        </div>
      )}
      <div className="grid">
        {facts.map(([k, v, mono]) => (
          <div className="cell" key={k}>
            <div className="k">{k}</div>
            <span className={mono ? 'mono' : undefined}>{v || '—'}</span>
          </div>
        ))}
      </div>
      <AssetCodes baseUrl={baseUrl} asset={a} />
      {/* Every field Snipe-IT sent, custom fields included; related records link to their page. */}
      <details className="all-fields">
        <summary className="section">All fields ({a.fields.length})</summary>
        <FieldGrid fields={a.fields} onOpenRecord={onOpenRecord} onOpenAsset={onOpenAsset} />
      </details>
      <div className="section">History</div>
      <table className="history">
        <thead>
          <tr>
            <th>When</th>
            <th>Action</th>
            <th>Operator</th>
            <th>Detail</th>
          </tr>
        </thead>
        <tbody>
          {a.history.map((h, i) => (
            <tr key={i}>
              <td className="dim">{h.when}</td>
              <td>{h.action}</td>
              <td>{h.operator}</td>
              <td>
                {h.detail}
                {h.note && <>{h.detail && ' '}<span className="note">{h.note}</span></>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {a.historyError ? (
        <p className="message error" role="alert">History unavailable: {a.historyError}</p>
      ) : (
        a.history.length === 0 && <p className="empty">No History</p>
      )}
    </div>
  )
}


const pieceName: Record<DashboardPiece, string> = {
  assets: 'Assets by Status Label', categories: 'Assets by Category', locations: 'Assets by Location', audits: 'Upcoming audits',
  licenses: 'Licenses', accessories: 'Accessories', consumables: 'Consumables', components: 'Components', users: 'Users',
  overdue: 'Overdue', expiring: 'Warranty expiring',
}
// Segment names for the kinds counted by quantity: used side, available side.
const splitNames = {
  licenses: ['In use', 'Free'], accessories: ['Checked out', 'Available'], consumables: ['Used', 'Remaining'],
  components: ['In use', 'Available'], users: ['Holding', 'Holding nothing'],
} as const
// Customize's groups, in screen order; a piece moves only within its own.
const GROUPS = ['Charts', 'Inventory Chart', 'Tables'] as const
type Group = (typeof GROUPS)[number]
const pieceGroup: Record<DashboardPiece, Group> = {
  assets: 'Charts', categories: 'Charts', locations: 'Charts', audits: 'Charts',
  licenses: 'Inventory Chart', accessories: 'Inventory Chart', consumables: 'Inventory Chart', components: 'Inventory Chart', users: 'Inventory Chart',
  overdue: 'Tables', expiring: 'Tables',
}
const chartColumn: Record<ChartPiece, string> = { assets: 'Status Label', categories: 'Category', locations: 'Location' }

// Stored per computer: which pieces show, in what order (by group).
type Layout = { piece: DashboardPiece; show: boolean }[]
const LAYOUT_KEY = 'dashboardLayout'
/** The layout from what's stored (or null). The assets piece was the Inventory Chart's Assets bar and is now the Status Label
 * chart, so hiding one hid the other. */
export function layoutFrom(saved: string | null): Layout {
  let stored: Layout = []
  try {
    stored = (JSON.parse(saved ?? '[]') as Layout)
      .filter((p, i, list) => DASHBOARD_PIECES.includes(p?.piece) && list.findIndex((q) => q.piece === p.piece) === i)
      .map(({ piece, show }) => ({ piece, show: show !== false }))
  } catch {}
  // A piece missing from the stored layout (e.g. new in this version) shows, right after the piece before it by default.
  for (const [i, piece] of DASHBOARD_PIECES.entries())
    if (!stored.some((p) => p.piece === piece)) stored.splice(stored.findIndex((p) => p.piece === DASHBOARD_PIECES[i - 1]) + 1, 0, { piece, show: true })
  return stored.sort((a, b) => GROUPS.indexOf(pieceGroup[a.piece]) - GROUPS.indexOf(pieceGroup[b.piece]))
}

type Segment = { name: string; count: number; color: string }

function BarRow({ name, entry }: { name: string; entry: Segment[] | Failed }) {
  if (!Array.isArray(entry))
    return (
      <div className="bar-row">
        <span className="bar-name">{name}</span>
        <span className="bar-error" role="alert">{entry.error}</span>
        <span className="bar-total dim">—</span>
      </div>
    )
  const total = entry.reduce((n, s) => n + s.count, 0)
  return (
    <div className="bar-row">
      <span className="bar-name">{name}</span>
      <div className="bar">
        {entry.filter((s) => s.count).map((s) => <span key={s.name} style={{ flexGrow: s.count, background: s.color }} title={`${s.name} ${s.count}`} />)}
      </div>
      <span className="bar-total">{total.toLocaleString()}</span>
      <div className="bar-key">
        {entry.map((s) => <span key={s.name}><i style={{ background: s.color }} />{s.name} <b>{s.count.toLocaleString()}</b></span>)}
      </div>
    </div>
  )
}

const healthName: Record<HealthLine['warning'], string> = {
  unreachable: 'Snipe-IT unreachable', key: 'API key problem', tooOld: 'Snipe-IT too old', auditLate: ASSET_VIEWS.auditLate.name, auditDue: ASSET_VIEWS.auditDue.name,
}
// red: fix it now; amber: keep an eye on it.
const healthTone: Record<HealthLine['warning'], 'red' | 'amber'> = { unreachable: 'red', key: 'red', tooOld: 'red', auditLate: 'red', auditDue: 'amber' }

// The Health warnings: pinned above the dashboard, outside Customize. One line each, the most urgent first; "All clear" when none.
function HealthStrip({ health, onRetry, onSettings, onAssetView }: {
  health: { lines: HealthLine[]; at: string } | Failed | null
  onRetry: () => void
  onSettings: () => void
  onAssetView: (v: AssetView) => void
}) {
  if (!health) return <section className="health" aria-label="Health warnings" aria-live="polite"><p className="health-line checking">Checking…</p></section>
  if ('error' in health)
    return <section className="health" aria-label="Health warnings" aria-live="polite"><p className="health-line c-red">Couldn't check: {health.error}</p></section>
  const line = (l: HealthLine) => {
    if ('error' in l) return <><b>{l.warning === 'tooOld' ? 'Snipe-IT version' : healthName[l.warning]}</b> <span>Couldn't check: {l.error}</span></>
    if ('message' in l)
      return <>
        <b>{healthName[l.warning]}</b> <span>{l.message}</span>
        <span className="health-actions">
          {l.warning === 'unreachable' && <button onClick={onRetry}>Retry</button>}
          <button onClick={onSettings}>Settings</button>
        </span>
      </>
    if ('version' in l) return <><b>{healthName.tooOld}</b> <span>It runs {l.version}; this app needs v{MIN_SNIPEIT.join('.')} or later.</span></>
    return <button className="link" onClick={() => onAssetView(l.warning)}><b>{l.count.toLocaleString()}</b> {l.count === 1 ? 'Asset is' : 'Assets are'} {healthName[l.warning]}</button>
  }
  return (
    <section className="health" aria-label="Health warnings" aria-live="polite">
      {health.lines.length
        ? health.lines.map((l) => <p key={l.warning} className={`health-line c-${healthTone[l.warning]}`}>{line(l)}</p>)
        : <p className="health-line c-green">All clear <span className="dim">Checked {health.at}</span></p>}
    </section>
  )
}

// Loads when opened, on Refresh, and when a piece is shown; no background polling. Hidden pieces aren't fetched.
function DashboardView({ onPick, onDrill, onAuditDay, onAssetView, onSettings }: {
  onPick: (id: number) => void
  onDrill: (d: Drill) => void
  onAuditDay: (d: AuditDay) => void
  onAssetView: (v: AssetView) => void
  onSettings: () => void
}) {
  const [layout, setLayout] = useState(() => layoutFrom(localStorage.getItem(LAYOUT_KEY)))
  const [customizing, setCustomizing] = useState(false)
  const [data, setData] = useState<Dashboard>({})
  const [loadedAt, setLoadedAt] = useState('')
  const [loading, setLoading] = useState(false)
  const latest = useRef(0)
  // The last Health check, kept whole: the Upcoming audits timeline shows its audit totals rather than fetching its own.
  const [health, setHealth] = useState<(Health & { lines: HealthLine[]; at: string }) | Failed | null>(null)
  const latestHealth = useRef(0)
  const shown = layout.filter((p) => p.show).map((p) => p.piece)

  // On open and Refresh only, not when Customize shows a piece; the last result stays up while a new one loads.
  function check() {
    const mine = ++latestHealth.current
    window.snipeIt.health().then(
      (h) => mine === latestHealth.current && setHealth({ ...h, lines: healthLines(h), at: new Date().toLocaleTimeString() }),
      (e: Error) => mine === latestHealth.current && setHealth({ error: e.message }))
  }
  useEffect(check, [])

  function load() {
    const mine = ++latest.current
    setLoading(true)
    // Each piece loads on its own, so a slow or failing one doesn't hold back the rest; the Asset pieces share one fetch.
    const shared = shown.filter((p) => ASSET_PIECES.includes(p))
    const groups = [...(shared.length ? [shared] : []), ...shown.filter((p) => !ASSET_PIECES.includes(p)).map((p) => [p])]
    const merge = (d: Dashboard) => mine === latest.current && setData((data) => ({ ...data, ...d }))
    // Per-piece failures come back as entries; the catch only sees what reached no piece at all.
    // "Loaded" means something arrived: a total failure leaves the last load time alone.
    let loaded = false
    Promise.all(groups.map((group) => window.snipeIt.dashboard(group).then((d) => (loaded = true, merge(d)), (e: Error) => merge(Object.fromEntries(group.map((p) => [p, { error: e.message }]))))))
      .finally(() => mine === latest.current && (setLoading(false), loaded && setLoadedAt(new Date().toLocaleTimeString())))
  }
  // Reordering doesn't refetch; showing or hiding does.
  useEffect(load, [[...shown].sort().join()])
  useEffect(() => localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout)), [layout])

  // Moves a piece within its group only; the layout is kept in group order, so its neighbours in the group are beside it.
  const move = (piece: DashboardPiece, by: -1 | 1) => setLayout((layout) => {
    const i = layout.findIndex((p) => p.piece === piece)
    if (pieceGroup[layout[i + by]?.piece] !== pieceGroup[piece]) return layout
    const next = [...layout]
    ;[next[i], next[i + by]] = [next[i + by], next[i]]
    return next
  })
  const toggle = (piece: DashboardPiece) => setLayout((layout) => layout.map((p) => (p.piece === piece ? { ...p, show: !p.show } : p)))

  function segments(piece: DashboardPiece): Segment[] | Failed | undefined {
    const entry = data[piece]
    if (!entry || 'error' in entry) return entry
    const { used, available } = entry as { used: number; available: number }
    const [usedName, freeName] = splitNames[piece as keyof typeof splitNames]
    return [{ name: usedName, count: used, color: 'var(--series-1)' }, { name: freeName, count: available, color: 'var(--series-1-track)' }]
  }
  function audits() {
    const entry = data.audits
    const days = entry && !('error' in entry) ? entry : []
    const checked = health && !('error' in health) ? health : undefined
    const timeline = (
      <Timeline days={days} late={checked?.auditLate} due={checked?.auditDue} dueThrough={checked?.dueThrough ?? null}
        onDay={onAuditDay} onView={onAssetView} />
    )
    return (
      <ChartCard key="audits" title={pieceName.audits} column="Next audit" wide rows={entry && !('error' in entry) ? auditRows(entry) : entry}
        onDrill={onDrill} onRow={(r) => onAuditDay(days.find((d) => d.day === r.key)!)} empty={timeline}>
        {() => timeline}
      </ChartCard>
    )
  }
  function chart(piece: ChartPiece) {
    const entry = data[piece]
    const rows = entry && !('error' in entry) ? chartRows(piece, entry as Tally[]) : entry
    return (
      <ChartCard key={piece} title={pieceName[piece]} column={chartColumn[piece]} dots={piece === 'assets'} rows={rows} onDrill={onDrill}>
        {(rows) => (piece === 'assets' ? <Donut rows={rows} onDrill={onDrill} /> : <Bars rows={rows} onDrill={onDrill} />)}
      </ChartCard>
    )
  }

  const tag = (a: AssetSummary) => (
    <td>
      <button className="link mono" onClick={() => onPick(a.id)}>{a.assetTag}</button>
    </td>
  )
  function table(piece: DashboardPiece) {
    const entry = data[piece]
    if (!entry) return null
    if ('error' in entry)
      return (
        <div key={piece}>
          <div className="section">{pieceName[piece]}</div>
          <p className="message error" role="alert">{entry.error}</p>
        </div>
      )
    if (piece === 'overdue') {
      const rows = entry as NonNullable<Exclude<Dashboard['overdue'], Failed>>
      return (
        <div key={piece}>
          <div className="section">Overdue ({rows.length})</div>
          <table className="history">
            <thead>
              <tr><th>Asset Tag</th><th>Name</th><th>Assignee</th><th>Expected Checkin</th><th className="num">How late</th></tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id}>
                  {tag(a)}
                  <td>{a.name || '—'}</td>
                  <td>{a.assignee?.name}</td>
                  <td>{a.expectedCheckin}</td>
                  <td className="late num">{lateness(a.overdue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 && <p className="empty">Nothing Overdue</p>}
        </div>
      )
    }
    const rows = entry as NonNullable<Exclude<Dashboard['expiring'], Failed>>
    return (
      <div key={piece}>
        <div className="section">Warranty expiring in 90 days ({rows.length})</div>
        <table className="history">
          <thead>
            <tr><th>Asset Tag</th><th>Name</th><th>Status</th><th className="num">Days left</th></tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.id}>
                {tag(a)}
                <td>{a.name || '—'}</td>
                <td>{a.status}</td>
                <td className="num">{a.daysLeft}d</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <p className="empty">No warranties expiring</p>}
      </div>
    )
  }

  const showing = (group: Group) => layout.filter((p) => p.show && pieceGroup[p.piece] === group).map((p) => p.piece)
  const bars = showing('Inventory Chart').flatMap((piece) => {
    const entry = segments(piece)
    return entry ? [<BarRow key={piece} name={pieceName[piece]} entry={entry} />] : []
  })
  return (
    <>
      <header className="head">
        <h1>Dashboard</h1>
        <span className="dim">{loading ? 'Loading…' : loadedAt && `Loaded ${loadedAt}`}</span>
        <div className="actions">
          <button className={`quiet${customizing ? ' on' : ''}`} onClick={() => setCustomizing((c) => !c)} aria-expanded={customizing}>Customize</button>
          <button onClick={() => (load(), check())} disabled={loading}>Refresh</button>
        </div>
      </header>
      <HealthStrip health={health} onRetry={() => (load(), check())} onSettings={onSettings} onAssetView={onAssetView} />
      {customizing && (
        <div className="customize">
          {GROUPS.map((group) => (
            <ol key={group} aria-label={group}>
              <li className="k">{group}</li>
              {layout.filter((p) => pieceGroup[p.piece] === group).map((p, i, list) => (
                <li key={p.piece}>
                  <label>
                    <input type="checkbox" checked={p.show} onChange={() => toggle(p.piece)} />
                    {pieceName[p.piece]}
                  </label>
                  <button onClick={() => move(p.piece, -1)} disabled={i === 0} aria-label={`Move ${pieceName[p.piece]} up`}>↑</button>
                  <button onClick={() => move(p.piece, 1)} disabled={i === list.length - 1} aria-label={`Move ${pieceName[p.piece]} down`}>↓</button>
                </li>
              ))}
            </ol>
          ))}
        </div>
      )}
      {showing('Charts').length > 0 && <div className="charts">{showing('Charts').map((piece) => (piece === 'audits' ? audits() : chart(piece as ChartPiece)))}</div>}
      {bars.length > 0 && (
        <section className="card inventory" aria-label="Inventory Chart">
          <header><h2>Inventory Chart</h2></header>
          <div className="chart">{bars}</div>
        </section>
      )}
      {showing('Tables').map((piece) => table(piece))}
    </>
  )
}
