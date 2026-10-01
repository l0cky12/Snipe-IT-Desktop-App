import { useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { Activity, Boxes, Briefcase, Building2, Cable, Cpu, Droplet, Factory, FileSpreadsheet, KeyRound, Laptop, LayoutGrid, ListChecks, MapPin, Package, ScanBarcode, Search, Settings as SettingsIcon, ShieldCheck, Tag, Tags, Truck, Users, type LucideIcon } from 'lucide-react'
import { ASSET_PIECES, DASHBOARD_PIECES, toSummary, type Asset, type AssetSegment, type Assignee, type AssetMatch, type AssetSummary, type AssetWithHistory, type CheckinOptions, type CheckoutOptions, type CheckoutTarget, type Dashboard, type DashboardPiece, type EditKind, type Failed, type ListKind, type Matches, type OtherKind, type RecordKind, type SearchKind, type StatusLabel } from '../../main/snipeit'
import type { Settings } from '../../main/config'
import { SettingsPage } from './SettingsPage'
import { ListView, drillTo, listName, type Drill } from './ListView'
import { BatchView, eachInTurn, type BatchAction, type BatchItem, type Outcome } from './BatchView'
import { ReportsView } from './ReportsView'
import { FieldGrid, RecordView } from './RecordView'
import { DeleteButton, RecordForm } from './RecordForm'
import { GroupsView, type CanManage } from './AccessView'
import { AssetCodes } from './AssetCodes'

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

// Why an action is off when Snipe-IT says the Operator's key may not do it.
export const NOT_ALLOWED = "Your Snipe-IT account isn't allowed to do this"
// Why an Asset's Checkin / Checkout button is disabled (its title), or undefined when it may go ahead.
export const checkinReason = (a: Pick<Asset, 'can' | 'assignee'>) => (!a.can.checkin ? NOT_ALLOWED : a.assignee ? undefined : 'Not checked out')
export const checkoutReason = (a: Pick<Asset, 'can' | 'assignee' | 'checkoutAllowed' | 'status'>) =>
  !a.can.checkout ? NOT_ALLOWED : a.checkoutAllowed ? undefined : a.assignee ? 'Already checked out' : `"${a.status}" can't be checked out`

// Whether a keydown opens the Scan/Search panel and moves to its box: Ctrl+K from anywhere, or a typed character
// outside a field (a barcode scanner types like a keyboard), so a scan made while the panel is closed is not lost.
export const opensPanel = (e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey'>, inField: boolean) =>
  !e.altKey && !e.metaKey && (e.ctrlKey ? e.key.toLowerCase() === 'k' : !inField && e.key.length === 1 && e.key !== ' ')

// Stored per computer, like the Dashboard layout: whether the Scan/Search panel is open.
const PANEL_KEY = 'scanPanelOpen'

// Session only: recent scans live in memory and are never written to disk.
const RECENT_MAX = 20
// The Lists in the left strip; every List (these and the rest) is on the All records page.
const LISTS: ListKind[] = ['assets', 'users', 'locations', 'models', 'activity']
const listIcon: Record<ListKind, LucideIcon> = {
  assets: Laptop, users: Users, locations: MapPin, models: Package, activity: Activity, licenses: KeyRound, accessories: Cable, consumables: Droplet,
  components: Cpu, categories: Tags, manufacturers: Factory, suppliers: Truck, departments: Briefcase, companies: Building2, statuslabels: Tag,
}
const kindName: Record<SearchKind, string> = { users: 'Users', locations: 'Locations', models: 'Asset Models', licenses: 'Licenses', accessories: 'Accessories', consumables: 'Consumables', components: 'Components' }
// The kinds a match opens (the Assets List filtered to it); the stocked kinds are only listed.
const opens = (kind: SearchKind): kind is OtherKind => kind === 'users' || kind === 'locations' || kind === 'models'

// What the main area shows besides an Asset: the dashboard, the batch, a report, the All records page, a List, or one record's fields.
// n is bumped on every visit so a List or record starts fresh.
type View = { page: 'dashboard' } | { page: 'batch' } | { page: 'reports' } | { page: 'records' } | { page: 'groups' } | { page: ListKind; drill?: Drill; n: number } | { page: 'record'; kind: RecordKind; id: number; n: number }
  | { page: 'edit'; kind: EditKind; id: number | null; n: number }

export function App() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [settingsError, setSettingsError] = useState('')
  const [locations, setLocations] = useState<StatusLabel[]>([])
  const [query, setQuery] = useState('')
  const [asset, setAsset] = useState<AssetWithHistory | null>(null)
  const [view, setView] = useState<View | null>(null)
  // Search Matches, or the Assets of a clicked Inventory Chart segment; both list the same way.
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
  const [statusLabels, setStatusLabels] = useState<StatusLabel[]>([])
  // Whether the Operator's own account may manage permissions: null until Snipe-IT says, or why it couldn't be asked.
  const [canManage, setCanManage] = useState<CanManage>(null)
  // Bumped on every open so the sheet (and its Checkin form inputs) starts fresh.
  const [opened, setOpened] = useState(0)
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

  useEffect(() => search.current?.focus(), [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const inField = e.target instanceof Element && !!e.target.closest('input:not([type=checkbox], [type=radio]), textarea, select, [contenteditable]')
      if (!opensPanel(e, inField)) return
      // Ctrl+K is the app's; a scanned character goes on to the box once it has focus.
      if (e.ctrlKey) e.preventDefault()
      openPanel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
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
    }
    return () => { stale = true }
  }, [settings])

  function saved(value: Settings) {
    cancel(); setSettings(value); setAsset(null); setRecent([]); batchEpoch.current++; batchBusy.current = false; setBatch([]); setBatchRun({ busy: false, last: null }); setMatches({ label: '', assets: [] }); setOthers([]); setView(null); setQuery(''); setMessage({ text: '' }); setStatusLabels([]); setLocations([]); setCanManage(null)
  }

  // Runs one lookup/open; `work` gets an isStale() check to call after each await.
  async function run(work: (isStale: () => boolean) => Promise<void>) {
    const mine = ++latest.current
    const isStale = () => mine !== latest.current
    setBusy(mine)
    try {
      await work(isStale)
    } catch (err) {
      // The current Asset and rail stay as they were; only the message changes.
      if (!isStale()) setMessage({ text: (err as Error).message, error: true })
    } finally {
      setBusy((b) => (b === mine ? 0 : b))
      search.current?.focus()
    }
  }

  async function open(id: number, isStale: () => boolean) {
    const full = await window.snipeIt.getAsset(id)
    if (isStale()) return
    setShowSettings(false)
    setAsset(full)
    setView(null)
    setOpened((n) => n + 1)
    setMessage({ text: '' })
    setRecent((r) => [toSummary(full), ...r.filter((x) => x.id !== full.id)].slice(0, RECENT_MAX))
  }

  const pick = (id: number) => run((isStale) => open(id, isStale))
  // While the batch is open, a scanned or picked Asset joins it instead of opening.
  const batching = !showSettings && view?.page === 'batch'
  function addToBatch(a: AssetSummary) {
    // Membership is read from the render-time batch for the message; the updater re-checks so a stale closure can never add a duplicate.
    const known = batch.some((b) => b.id === a.id)
    setBatch((b) => (b.some((x) => x.id === a.id) ? b : [...b, a]))
    setMessage({ text: known ? `${a.assetTag} is already in the batch` : `Added ${a.assetTag} to the batch` })
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

  const selected = view ? undefined : asset?.id
  // The dashboard stays in the main area, so the Operator can click through several segments in turn; the segment's Assets list in the panel, so it opens.
  const showSegment = (s: AssetSegment) => (setPanelOpen(true), setMatches({ label: `${s.status || 'No status'} (${s.count})`, assets: s.assets }), setOthers([]), setMessage({ text: '' }))
  const go = (page: ListKind, drill?: Drill) => (setShowSettings(false), setView({ page, drill, n: cancel() }))
  const openRecord = (kind: RecordKind, id: number) => (setShowSettings(false), setView({ page: 'record', kind, id, n: cancel() }))
  // A new record (id null) or an edit; saved, it opens, so the Operator sees what Snipe-IT kept.
  const editRecord = (kind: EditKind, id: number | null) => (setShowSettings(false), setView({ page: 'edit', kind, id, n: cancel() }))
  const shown = (kind: EditKind, id: number) => (kind === 'assets' ? pick(id) : openRecord(kind, id))
  function deleted(kind: EditKind, id: number, name: string) {
    if (kind === 'assets') {
      setRecent((r) => r.filter((a) => a.id !== id))
      setMatches((m) => ({ ...m, assets: m.assets.filter((a) => a.id !== id) }))
    }
    go(kind)
    setMessage({ text: `Deleted ${name}` })
  }
  const page = !showSettings && view?.page
  // The All records button stands for every page not in the strip.
  const elsewhere = page === 'records' || page === 'record' || page === 'edit' || page === 'groups' || (!!page && page in listName && !LISTS.includes(page as ListKind))

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
        <nav className="strip" aria-label="Pages">
          <span className="logo" aria-hidden="true">S</span>
          <button title={panelOpen ? 'Close Scan/Search' : 'Scan/Search (Ctrl+K)'} aria-label="Scan/Search panel" aria-expanded={panelOpen} aria-controls={panelOpen ? 'scan-panel' : undefined} className="nav panel-nav"
            onClick={() => (panelOpen ? setPanelOpen(false) : openPanel())}>
            <Search size={20} />
          </button>
          <button title="Dashboard" aria-label="Dashboard" disabled={!settings?.hasToken} className={`nav${page === 'dashboard' ? ' sel' : ''}`} onClick={() => (cancel(), setShowSettings(false), setView({ page: 'dashboard' }))}>
            <LayoutGrid size={20} />
          </button>
          {LISTS.map((k) => {
            const Icon = listIcon[k]
            return <button key={k} title={listName[k]} aria-label={listName[k]} disabled={!settings?.hasToken} className={`nav${page === k ? ' sel' : ''}`} onClick={() => go(k)}><Icon size={20} /></button>
          })}
          <button title={`Batch (${batch.length})`} aria-label={`Batch, ${batch.length} ${batch.length === 1 ? 'Asset' : 'Assets'}`} disabled={!settings?.hasToken} className={`nav${page === 'batch' ? ' sel' : ''}`} onClick={() => (cancel(), setShowSettings(false), setView({ page: 'batch' }))}>
            <ListChecks size={20} />
            {batch.length > 0 && <span className="badge">{batch.length}</span>}
          </button>
          <button title="Reports" aria-label="Reports" disabled={!settings?.hasToken} className={`nav${page === 'reports' ? ' sel' : ''}`} onClick={() => (cancel(), setShowSettings(false), setView({ page: 'reports' }))}>
            <FileSpreadsheet size={20} />
          </button>
          <button title="All records" aria-label="All records" disabled={!settings?.hasToken} className={`nav${elsewhere ? ' sel' : ''}`} onClick={() => (cancel(), setShowSettings(false), setView({ page: 'records' }))}>
            <Boxes size={20} />
          </button>
          <button title="Settings" aria-label="Settings" className={`nav settings-nav${showSettings ? ' sel' : ''}`} onClick={() => { cancel(); setShowSettings(true) }}><SettingsIcon size={20} /></button>
        </nav>
        {panelOpen && <div className="panel" id="scan-panel">
          <form onSubmit={onSubmit}>
            <ScanBarcode size={16} />
            <input
              disabled={!settings?.hasToken || showSettings}
              ref={search}
              className="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Scan / search…"
              aria-label="Scan an Asset Tag, or search everything"
            />
          </form>
          {railMessage}
          <div className="list">
            {matches.assets.length > 0 && <AssetList label={matches.label} assets={matches.assets} selected={selected} onPick={choose} />}
            {others.map((m) => 'error' in m
              ? <p key={m.kind} className="message">{kindName[m.kind]}: {m.error}</p>
              : m.rows.length > 0 && (
                <div key={m.kind}>
                  <div className="section">{kindName[m.kind]} ({m.rows.length})</div>
                  {m.rows.map((t) => {
                    const text = <>
                      <span className="t">{t.name}</span>
                      {t.detail && <span className="n mono">{t.detail}</span>}
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
      <main className="sheet">{!panelOpen && <div className="sheet-status">{railMessage}</div>}{showSettings ? settings ? <SettingsPage settings={settings} onSaved={saved} /> : <p className="message error" role="alert">{settingsError || 'Loading settings…'}</p> : view?.page === 'dashboard' ? <DashboardView onPick={pick} onSegment={showSegment} /> : view?.page === 'reports' ? <ReportsView /> : view?.page === 'batch' ? <BatchView batch={batch} busy={batchRun.busy} last={batchRun.last} onRun={runBatch} onRemove={(ids) => setBatch((b) => b.filter((a) => !ids.includes(a.id)))} onClear={() => (setBatch([]), setBatchRun({ busy: false, last: null }))} statusLabels={statusLabels} locations={locations} defaultLocation={settings?.defaultLocation ?? null} onOpenAsset={pick} />
        : view?.page === 'records' ? <RecordsIndex onGo={go} onGroups={() => (cancel(), setView({ page: 'groups' }))} />
        : view?.page === 'groups' ? <GroupsView canManage={canManage} />
        : view?.page === 'record' ? <RecordView key={view.n} kind={view.kind} id={view.id} onOpenRecord={openRecord} onOpenAsset={pick} onDrill={go} onEdit={editRecord} onDeleted={deleted} canManage={canManage} />
        : view?.page === 'edit' ? <RecordForm key={view.n} kind={view.kind} id={view.id} onSaved={(id) => shown(view.kind, id)} onCancel={() => (view.id === null ? go(view.kind) : shown(view.kind, view.id))} />
        : view ? <ListView key={view.n} kind={view.page} drill={view.drill} statusLabels={statusLabels} locations={locations} defaultLocation={settings?.defaultLocation ?? null} onOpenAsset={pick} onOpenRecord={openRecord} batch={batch} onBatch={addToBatch} onNew={(k) => editRecord(k, null)} />
        : asset ? <AssetSheet baseUrl={settings?.baseUrl ?? ''} defaultLocation={settings?.defaultLocation ?? null} locations={locations} key={opened} asset={asset} statusLabels={statusLabels} onCheckin={checkin} onCheckout={checkout} onOpenRecord={openRecord} onOpenAsset={pick}
            onEdit={() => editRecord('assets', asset.id)} onDeleted={() => deleted('assets', asset.id, asset.assetTag)} /> : <p className="empty">Scan an Asset Tag</p>}</main>
    </div>
  )
}

// Every List, the ones in the strip and the rest.
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

export function CheckinForm(props: { defaultLocation: StatusLabel | null; locations: StatusLabel[]; asset: Asset; statusLabels: StatusLabel[]; onCheckin: (id: number, o: CheckinOptions) => Promise<void> }) {
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
        <option value="">Keep current Location</option>
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

export function CheckoutForm(props: { defaultLocation: StatusLabel | null; onCheckout: (o: CheckoutOptions) => Promise<void> }) {
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
          autoFocus
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

function AssetSheet({ asset: a, baseUrl, statusLabels, onCheckin, onCheckout, defaultLocation, locations, onOpenRecord, onOpenAsset, onEdit, onDeleted }: {
  baseUrl: string
  onEdit: () => void
  onDeleted: () => void
  onOpenRecord: (kind: RecordKind, id: number) => void
  onOpenAsset: (id: number) => void
  defaultLocation: StatusLabel | null
  locations: StatusLabel[]
  asset: AssetWithHistory
  statusLabels: StatusLabel[]
  onCheckin: (id: number, o: CheckinOptions) => Promise<void>
  onCheckout: (id: number, o: CheckoutOptions) => Promise<void>
}) {
  const [checkingOut, setCheckingOut] = useState(false)
  const facts: [string, string, boolean?][] = [
    ['Assignee', a.assignee?.name ?? 'Unassigned'],
    ['Type', a.assignee ? kind[a.assignee.type] : ''],
    ['Expected checkin', a.expectedCheckin ?? '', true],
    ['Location', a.location],
    ['Category', a.category],
    ['Serial', a.serial, true],
    ['Purchased', a.purchaseDate ?? '', true],
    ['Warranty ends', a.warrantyEnd ?? '', true],
  ]
  return (
    <>
      <header className="head">
        <span className="tag">{a.assetTag}</span>
        <h1>
          {a.name || 'Unnamed Asset'}
          <span className="sub">{a.model}</span>
        </h1>
        <StatusChip asset={a} />
        {a.overdueDays !== null && <span className="chip c-red">Overdue {a.overdueDays}d</span>}
        {a.warranty &&
          (a.warranty.expired ? (
            <span className="chip c-grey">Warranty expired</span>
          ) : (
            <span className="chip c-amber">Warranty {a.warranty.daysLeft}d left</span>
          ))}
        <div className="actions">
          <button
            disabled={!a.checkoutAllowed || !a.can.checkout}
            onClick={() => setCheckingOut((o) => !o)}
            title={checkoutReason(a)}
          >
            {checkingOut ? 'Cancel' : 'Checkout…'}
          </button>
          <button className="quiet" onClick={onEdit} disabled={!a.can.update} title={a.can.update ? undefined : NOT_ALLOWED}>Edit</button>
          <DeleteButton kind="assets" id={a.id} name={a.assetTag} onDeleted={onDeleted} allowed={a.can.delete} />
        </div>
        <CheckinForm defaultLocation={defaultLocation} locations={locations} asset={a} statusLabels={statusLabels} onCheckin={onCheckin} />
      </header>
      {checkingOut && a.checkoutAllowed && a.can.checkout && <CheckoutForm defaultLocation={defaultLocation} onCheckout={(o) => onCheckout(a.id, o)} />}
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
    </>
  )
}


const pieceName: Record<DashboardPiece, string> = {
  assets: 'Assets', licenses: 'Licenses', accessories: 'Accessories', consumables: 'Consumables', components: 'Components', users: 'Users',
  overdue: 'Overdue', expiring: 'Warranty expiring',
}
// Segment names for the kinds counted by quantity: used side, available side.
const splitNames = {
  licenses: ['In use', 'Free'], accessories: ['Checked out', 'Available'], consumables: ['Used', 'Remaining'],
  components: ['In use', 'Available'], users: ['Holding', 'Holding nothing'],
} as const
const isBar = (p: DashboardPiece) => p !== 'overdue' && p !== 'expiring'

// Stored per computer: which pieces show, in what order (bars first, then tables).
type Layout = { piece: DashboardPiece; show: boolean }[]
const LAYOUT_KEY = 'dashboardLayout'
function readLayout(): Layout {
  let stored: Layout = []
  try {
    stored = (JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? '[]') as Layout)
      .filter((p, i, list) => DASHBOARD_PIECES.includes(p?.piece) && list.findIndex((q) => q.piece === p.piece) === i)
      .map(({ piece, show }) => ({ piece, show: show !== false }))
  } catch {}
  // A piece missing from the stored layout (e.g. new in this version) shows, right after the piece before it by default.
  for (const [i, piece] of DASHBOARD_PIECES.entries())
    if (!stored.some((p) => p.piece === piece)) stored.splice(stored.findIndex((p) => p.piece === DASHBOARD_PIECES[i - 1]) + 1, 0, { piece, show: true })
  return [...stored.filter((p) => isBar(p.piece)), ...stored.filter((p) => !isBar(p.piece))]
}

type Segment = { name: string; count: number; color: string; onClick?: () => void }

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
        {entry.filter((s) => s.count).map((s) =>
          s.onClick
            // Mouse only; the labelled button in the key underneath is the keyboard's way in, so Tab stops once per segment.
            ? <button key={s.name} style={{ flexGrow: s.count, background: s.color }} onClick={s.onClick} title={`${s.name} ${s.count}`} tabIndex={-1} aria-hidden />
            : <span key={s.name} style={{ flexGrow: s.count, background: s.color }} title={`${s.name} ${s.count}`} />)}
      </div>
      <span className="bar-total">{total.toLocaleString()}</span>
      <div className="bar-key">
        {entry.map((s) => {
          const text = <><i style={{ background: s.color }} />{s.name} <b>{s.count.toLocaleString()}</b></>
          return s.onClick ? <button key={s.name} onClick={s.onClick}>{text}</button> : <span key={s.name}>{text}</span>
        })}
      </div>
    </div>
  )
}

// Loads when opened, on Refresh, and when a piece is shown; no background polling. Hidden pieces aren't fetched.
function DashboardView({ onPick, onSegment }: { onPick: (id: number) => void; onSegment: (s: AssetSegment) => void }) {
  const [layout, setLayout] = useState(readLayout)
  const [customizing, setCustomizing] = useState(false)
  const [data, setData] = useState<Dashboard>({})
  const [loadedAt, setLoadedAt] = useState('')
  const [loading, setLoading] = useState(false)
  const latest = useRef(0)
  const shown = layout.filter((p) => p.show).map((p) => p.piece)

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

  // Moves a piece within its group (bars or tables) only.
  const move = (piece: DashboardPiece, by: -1 | 1) => setLayout((layout) => {
    const group = layout.filter((p) => isBar(p.piece) === isBar(piece))
    const i = group.findIndex((p) => p.piece === piece)
    if (!group[i + by]) return layout
    ;[group[i], group[i + by]] = [group[i + by], group[i]]
    return isBar(piece) ? [...group, ...layout.filter((p) => !isBar(p.piece))] : [...layout.filter((p) => isBar(p.piece)), ...group]
  })
  const toggle = (piece: DashboardPiece) => setLayout((layout) => layout.map((p) => (p.piece === piece ? { ...p, show: !p.show } : p)))

  function segments(piece: DashboardPiece): Segment[] | Failed | undefined {
    const entry = data[piece]
    if (!entry || 'error' in entry) return entry
    if (piece === 'assets')
      return (entry as AssetSegment[]).map((s) => ({
        name: s.status || 'No status', count: s.count,
        // Snipe-IT's label color as-is; a label without one gets the app's usual color for its kind of status.
        color: s.color ?? `var(--${statusColor[s.statusMeta] ?? 'grey'})`, onClick: () => onSegment(s),
      }))
    const { used, available } = entry as { used: number; available: number }
    const [usedName, freeName] = splitNames[piece as keyof typeof splitNames]
    return [{ name: usedName, count: used, color: 'var(--bar-used)' }, { name: freeName, count: available, color: 'var(--bar-free)' }]
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
              <tr><th>Asset Tag</th><th>Name</th><th>Assignee</th><th>Days late</th></tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id}>
                  {tag(a)}
                  <td>{a.name || '—'}</td>
                  <td>{a.assignee?.name}</td>
                  <td className="late">{a.overdueDays}d</td>
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
            <tr><th>Asset Tag</th><th>Name</th><th>Status</th><th>Days left</th></tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.id}>
                {tag(a)}
                <td>{a.name || '—'}</td>
                <td>{a.status}</td>
                <td>{a.daysLeft}d</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <p className="empty">No warranties expiring</p>}
      </div>
    )
  }

  const bars = layout.filter((p) => p.show && isBar(p.piece)).flatMap(({ piece }) => {
    const entry = segments(piece)
    return entry ? [<BarRow key={piece} name={pieceName[piece]} entry={entry} />] : []
  })
  return (
    <>
      <header className="head">
        <h1>Dashboard</h1>
        <span className="dim mono">{loading ? 'Loading…' : loadedAt && `Loaded ${loadedAt}`}</span>
        <div className="actions">
          <button className={`quiet${customizing ? ' on' : ''}`} onClick={() => setCustomizing((c) => !c)} aria-expanded={customizing}>Customize</button>
          <button onClick={load} disabled={loading}>Refresh</button>
        </div>
      </header>
      {customizing && (
        <div className="customize">
          {(['Chart', 'Tables'] as const).map((group) => (
            <ol key={group} aria-label={group}>
              <li className="k">{group}</li>
              {layout.filter((p) => isBar(p.piece) === (group === 'Chart')).map((p, i, list) => (
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
      {bars.length > 0 && (
        <>
          <div className="section">Inventory Chart</div>
          <div className="chart">{bars}</div>
        </>
      )}
      {layout.filter((p) => p.show && !isBar(p.piece)).map(({ piece }) => table(piece))}
    </>
  )
}
