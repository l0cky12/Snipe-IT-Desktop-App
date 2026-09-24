import { useEffect, useRef, useState } from 'react'
import type { Asset } from '../../main/snipeit'

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
  const [asset, setAsset] = useState<Asset | null>(null)
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

function AssetSheet({ asset: a }: { asset: Asset }) {
  const facts: [string, string, boolean?][] = [
    ['Assignee', a.assignee?.name ?? 'Unassigned'],
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
      </header>
      <div className="grid">
        {facts.map(([k, v, mono]) => (
          <div className="cell" key={k}>
            <div className="k">{k}</div>
            <span className={mono ? 'mono' : undefined}>{v || '—'}</span>
          </div>
        ))}
      </div>
    </>
  )
}
