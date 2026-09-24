import { useEffect, useRef, useState } from 'react'
import { toSummary, type Assignee, type AssetSummary, type AssetWithHistory } from '../../main/snipeit'

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
  const [matches, setMatches] = useState<AssetSummary[]>([])
  const [recent, setRecent] = useState<AssetSummary[]>([])
  // One place for what the rail says: an info line, or an error (shown the same way for every failure).
  const [message, setMessage] = useState<{ text: string; error?: boolean }>({ text: '' })
  const search = useRef<HTMLInputElement>(null)
  // Bumped by every lookup or open; a result that returns after a newer one started is discarded.
  const latest = useRef(0)

  useEffect(() => search.current?.focus(), [])

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
    setMessage({ text: '' })
    setRecent((r) => [toSummary(full), ...r.filter((x) => x.id !== full.id)].slice(0, RECENT_MAX))
  }

  const pick = (id: number) => run((isStale) => open(id, isStale))

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
        {message.text && (
          <p className={message.error ? 'message error' : 'message'} role={message.error ? 'alert' : undefined}>
            {message.text}
          </p>
        )}
        <div className="list">
          {matches.length > 0 && <AssetList label={`Matches (${matches.length})`} assets={matches} selected={asset?.id} onPick={pick} />}
          {recent.length > 0 && <AssetList label="Recent scans" assets={recent} selected={asset?.id} onPick={pick} />}
        </div>
      </aside>
      <main className="sheet">{asset ? <AssetSheet asset={asset} /> : <p className="empty">Scan an Asset Tag</p>}</main>
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

function AssetSheet({ asset: a }: { asset: AssetWithHistory }) {
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
        {/* Checkout and Checkin buttons go here (tickets 05, 06). */}
        <div className="actions" />
      </header>
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
