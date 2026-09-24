import { useEffect, useRef, useState } from 'react'
import type { Assignee, AssetWithHistory } from '../../main/snipeit'

const configError = new URLSearchParams(location.search).get('configError')

const statusColor: Record<string, string> = {
  deployed: 'blue',
  deployable: 'green',
  pending: 'amber',
  archived: 'grey',
  undeployable: 'red',
}

export function App() {
  const [query, setQuery] = useState('')
  const [asset, setAsset] = useState<AssetWithHistory | null>(null)
  const [message, setMessage] = useState('')
  const search = useRef<HTMLInputElement>(null)

  useEffect(() => search.current?.focus(), [])

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    try {
      const result = await window.snipeIt.lookup(query)
      if (!result.exact) return setMessage(`No Asset has the Asset Tag "${query.trim()}"`)
      setAsset(await window.snipeIt.getAsset(result.assets[0].id))
      setMessage('')
      setQuery('')
    } catch (err) {
      // ponytail: raw error text; ticket 04 adds proper error messages
      setMessage((err as Error).message)
    } finally {
      search.current?.focus()
    }
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
        {message && <p className="message">{message}</p>}
      </aside>
      <main className="sheet">{asset ? <AssetSheet asset={asset} /> : <p className="empty">Scan an Asset Tag</p>}</main>
    </div>
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
        <span className={`chip c-${statusColor[a.statusMeta] ?? 'grey'}`}>{a.status}</span>
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
        <p className="message history-error">History unavailable: {a.historyError}</p>
      ) : (
        a.history.length === 0 && <p className="empty">No History</p>
      )}
    </>
  )
}
