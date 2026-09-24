import { useEffect, useRef, useState } from 'react'
import { toSummary, type Assignee, type AssetSummary, type AssetWithHistory, type CheckinOptions, type CheckoutOptions, type CheckoutTarget, type Dashboard, type StatusLabel } from '../../main/snipeit'

const configError = new URLSearchParams(location.search).get('configError')

const statusColor: Record<string, string> = {
  deployed: 'blue',
  deployable: 'green',
  pending: 'amber',
  archived: 'grey',
  undeployable: 'red',
}

const StatusChip = ({ asset }: { asset: AssetSummary }) => (
  <span className={`chip c-${statusColor[asset.statusMeta] ?? 'grey'}`}>{asset.status}</span>
)

// Session only: recent scans live in memory and are never written to disk.
const RECENT_MAX = 20

export function App() {
  const [query, setQuery] = useState('')
  const [asset, setAsset] = useState<AssetWithHistory | null>(null)
  const [showDashboard, setShowDashboard] = useState(false)
  const [matches, setMatches] = useState<AssetSummary[]>([])
  const [recent, setRecent] = useState<AssetSummary[]>([])
  const [statusLabels, setStatusLabels] = useState<StatusLabel[]>([])
  // Bumped on every open so the sheet (and its Checkin form inputs) starts fresh.
  const [opened, setOpened] = useState(0)
  // One place for what the rail says: an info line, or an error (shown the same way for every failure).
  const [message, setMessage] = useState<{ text: string; error?: boolean }>({ text: '' })
  const search = useRef<HTMLInputElement>(null)
  // Bumped by every lookup or open; a result that returns after a newer one started is discarded.
  const latest = useRef(0)

  useEffect(() => search.current?.focus(), [])
  // ponytail: if the status list can't load, the dropdown offers only the Asset's current status; Checkin still works.
  useEffect(() => {
    if (!configError) window.snipeIt.statusLabels().then(setStatusLabels, () => {})
  }, [])

  // Runs one lookup/open; `work` gets an isStale() check to call after each await.
  async function run(work: (isStale: () => boolean) => Promise<void>) {
    const mine = ++latest.current
    const isStale = () => mine !== latest.current
    try {
      await work(isStale)
    } catch (err) {
      // The current Asset and rail stay as they were; only the message changes.
      if (!isStale()) setMessage({ text: (err as Error).message, error: true })
    } finally {
      search.current?.focus()
    }
  }

  async function open(id: number, isStale: () => boolean) {
    const full = await window.snipeIt.getAsset(id)
    if (isStale()) return
    setAsset(full)
    setShowDashboard(false)
    setOpened((n) => n + 1)
    setMessage({ text: '' })
    setRecent((r) => [toSummary(full), ...r.filter((x) => x.id !== full.id)].slice(0, RECENT_MAX))
  }

  const pick = (id: number) => run((isStale) => open(id, isStale))

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
        setMatches(result.assets)
        return setMessage({ text: result.assets.length ? '' : `No Asset matches "${q}"` })
      }
      // Only an exact Asset Tag hit clears the box; a text search keeps the query to refine.
      setMatches([])
      // Leave the box alone if the next scan has already started typing into it.
      setQuery((current) => (current.trim() === q ? '' : current))
      await open(result.assets[0].id, isStale)
    })
  }

  const selected = showDashboard ? undefined : asset?.id

  if (configError)
    return (
      <div className="fatal">
        <h1>Can't start: config.json problem</h1>
        <p>{configError}</p>
        <p className="dim">Fix config.json in the app folder, then restart the app.</p>
      </div>
    )

  return (
    <div className="layout">
      <aside className="rail">
        <form onSubmit={onSubmit}>
          <input
            ref={search}
            className="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Scan / search…"
            aria-label="Scan or type an Asset Tag"
          />
        </form>
        {/* Bumping `latest` discards an open still loading, so it can't pull the Operator off the dashboard. */}
        <button className={`nav${showDashboard ? ' sel' : ''}`} onClick={() => (latest.current++, setShowDashboard(true))}>
          Dashboard
        </button>
        {message.text && (
          <p className={message.error ? 'message error' : 'message'} role={message.error ? 'alert' : undefined}>
            {message.text}
          </p>
        )}
        <div className="list">
          {matches.length > 0 && <AssetList label={`Matches (${matches.length})`} assets={matches} selected={selected} onPick={pick} />}
          {recent.length > 0 && <AssetList label="Recent scans" assets={recent} selected={selected} onPick={pick} />}
        </div>
      </aside>
      <main className="sheet">{showDashboard ? <DashboardView onPick={pick} /> : asset ? <AssetSheet key={opened} asset={asset} statusLabels={statusLabels} onCheckin={checkin} onCheckout={checkout} /> : <p className="empty">Scan an Asset Tag</p>}</main>
    </div>
  )
}

function AssetList(props: { label: string; assets: AssetSummary[]; selected?: number; onPick: (id: number) => void }) {
  return (
    <>
      <div className="section">{props.label}</div>
      {props.assets.map((a) => (
        <button key={a.id} className={`row${a.id === props.selected ? ' sel' : ''}`} onClick={() => props.onPick(a.id)}>
          <span className="mono t">{a.assetTag}</span>
          <StatusChip asset={a} />
          <span className="n">
            {a.name || '—'} · {a.assignee?.name ?? 'Unassigned'}
          </span>
        </button>
      ))}
    </>
  )
}

const kind: Record<Assignee['type'], string> = { user: 'User', location: 'Location', asset: 'Asset' }

function CheckinForm(props: { asset: AssetWithHistory; statusLabels: StatusLabel[]; onCheckin: (id: number, o: CheckinOptions) => Promise<void> }) {
  const a = props.asset
  const [statusId, setStatusId] = useState(a.statusId)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const off = !a.assignee || busy
  // The current status is always offered, even if the status list didn't load.
  const labels = props.statusLabels.some((l) => l.id === a.statusId) || a.statusId === null
    ? props.statusLabels
    : [{ id: a.statusId, name: a.status }, ...props.statusLabels]

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    await props.onCheckin(a.id, { statusId: statusId ?? undefined, note })
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
      <input value={note} onChange={(e) => setNote(e.target.value)} disabled={off} placeholder="Note (optional)" aria-label="Checkin note" />
      <button disabled={off} title={a.assignee ? undefined : 'Not checked out'}>
        {busy ? 'Checking in…' : 'Checkin'}
      </button>
    </form>
  )
}

function CheckoutForm(props: { asset: AssetWithHistory; onCheckout: (id: number, o: CheckoutOptions) => Promise<void> }) {
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
    await props.onCheckout(props.asset.id, { targetType, targetId: target.id, expectedCheckin: expectedCheckin || undefined, note })
    setBusy(false)
  }

  return (
    <form className="checkout" onSubmit={onSubmit}>
      <div className="actions">
        <select
          value={targetType}
          // Drop the other kind's results so a User id is never sent as a Location (or vice versa).
          onChange={(e) => (setTargetType(e.target.value as CheckoutOptions['targetType']), setTarget(null), setFound([]))}
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

function AssetSheet({ asset: a, statusLabels, onCheckin, onCheckout }: {
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
        <span className="mono dim">{a.assetTag}</span>
        <h1>
          {a.name} <span className="dim">— {a.model}</span>
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
            disabled={!a.checkoutAllowed}
            onClick={() => setCheckingOut((o) => !o)}
            title={a.checkoutAllowed ? undefined : a.assignee ? 'Already checked out' : `"${a.status}" can't be checked out`}
          >
            {checkingOut ? 'Cancel' : 'Checkout…'}
          </button>
        </div>
        <CheckinForm asset={a} statusLabels={statusLabels} onCheckin={onCheckin} />
      </header>
      {checkingOut && a.checkoutAllowed && <CheckoutForm asset={a} onCheckout={onCheckout} />}
      <div className="grid">
        {facts.map(([k, v, mono]) => (
          <div className="cell" key={k}>
            <div className="k">{k}</div>
            <span className={mono ? 'mono' : undefined}>{v || '—'}</span>
          </div>
        ))}
      </div>
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
                {h.note && <span className="note">{h.detail && ' · '}{h.note}</span>}
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

// Loads when opened and on Refresh; no background polling.
function DashboardView({ onPick }: { onPick: (id: number) => void }) {
  const [data, setData] = useState<Dashboard | null>(null)
  const [loadedAt, setLoadedAt] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  function load() {
    setLoading(true)
    window.snipeIt.dashboard()
      .then((d) => (setData(d), setLoadedAt(new Date().toLocaleTimeString()), setError('')), (e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }
  useEffect(load, [])

  const tag = (a: AssetSummary) => (
    <td>
      <button className="link mono" onClick={() => onPick(a.id)}>{a.assetTag}</button>
    </td>
  )
  return (
    <>
      <header className="head">
        <h1>Dashboard</h1>
        <span className="dim mono">{loading ? 'Loading…' : loadedAt && `Loaded ${loadedAt}`}</span>
        <div className="actions">
          <button onClick={load} disabled={loading}>Refresh</button>
        </div>
      </header>
      {error && <p className="message error" role="alert">{error}</p>}
      {data && (
        <>
          <div className="section">Assets by status</div>
          <div className="counts">
            {data.counts.map((c) => (
              <span key={c.status} className={`chip c-${statusColor[c.statusMeta] ?? 'grey'}`}>{c.status || 'No status'} {c.count}</span>
            ))}
          </div>
          <div className="section">Overdue ({data.overdue.length})</div>
          <table className="history">
            <thead>
              <tr><th>Asset Tag</th><th>Name</th><th>Assignee</th><th>Days late</th></tr>
            </thead>
            <tbody>
              {data.overdue.map((a) => (
                <tr key={a.id}>
                  {tag(a)}
                  <td>{a.name || '—'}</td>
                  <td>{a.assignee?.name}</td>
                  <td className="late">{a.overdueDays}d</td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.overdue.length === 0 && <p className="empty">Nothing Overdue</p>}
          <div className="section">Warranty expiring in 90 days ({data.expiring.length})</div>
          <table className="history">
            <thead>
              <tr><th>Asset Tag</th><th>Name</th><th>Status</th><th>Days left</th></tr>
            </thead>
            <tbody>
              {data.expiring.map((a) => (
                <tr key={a.id}>
                  {tag(a)}
                  <td>{a.name || '—'}</td>
                  <td>{a.status}</td>
                  <td>{a.daysLeft}d</td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.expiring.length === 0 && <p className="empty">No warranties expiring</p>}
        </>
      )}
    </>
  )
}
