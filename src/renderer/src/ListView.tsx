import { useEffect, useState, type ReactNode } from 'react'
import { ACTIVITY_ACTIONS, LIST_PAGE, LIST_SORTS, type Asset, type CheckinOptions, type CheckoutOptions, type ListKind, type ListPage, type ListRows, type OtherKind, type StatusLabel } from '../../main/snipeit'
import { CheckinForm, CheckoutForm, StatusChip, statusChoices } from './App'

export const listName: Record<ListKind, string> = { assets: 'Assets', users: 'Users', locations: 'Locations', models: 'Asset Models', activity: 'Activity Report' }

// A List's columns: the first is always shown and opens the row; the rest the Operator can hide. hidden = hidden until shown.
type Column<K extends ListKind> = { key: keyof ListRows[K] & string; label: string; hidden?: true; cell?: (row: ListRows[K]) => ReactNode }
// The same columns without their List's row type, for code that works on whichever List is open.
type AnyColumn = { key: string; label: string; hidden?: true; cell?: (row: never) => ReactNode }
const COLUMNS: { [K in ListKind]: Column<K>[] } = {
  assets: [
    { key: 'assetTag', label: 'Asset Tag' },
    { key: 'name', label: 'Name' },
    { key: 'status', label: 'Status', cell: (a) => <StatusChip asset={a} /> },
    { key: 'model', label: 'Asset Model' },
    { key: 'category', label: 'Category' },
    { key: 'location', label: 'Location' },
    { key: 'assignee', label: 'Assignee', cell: (a) => a.assignee?.name },
    { key: 'serial', label: 'Serial', hidden: true },
    { key: 'expectedCheckin', label: 'Expected checkin', hidden: true },
    { key: 'purchaseDate', label: 'Purchased', hidden: true },
    { key: 'warrantyEnd', label: 'Warranty ends', hidden: true },
  ],
  users: [
    { key: 'name', label: 'Name' },
    { key: 'username', label: 'Username' },
    { key: 'email', label: 'Email', hidden: true },
    { key: 'department', label: 'Department' },
    { key: 'location', label: 'Location' },
    { key: 'assets', label: 'Assets' },
  ],
  locations: [
    { key: 'name', label: 'Name' },
    { key: 'parent', label: 'Parent' },
    { key: 'city', label: 'City', hidden: true },
    { key: 'assets', label: 'Assets' },
    { key: 'checkedOut', label: 'Checked out' },
    { key: 'users', label: 'Users' },
  ],
  models: [
    { key: 'name', label: 'Name' },
    { key: 'modelNumber', label: 'Model No.' },
    { key: 'manufacturer', label: 'Manufacturer' },
    { key: 'category', label: 'Category' },
    { key: 'assets', label: 'Assets' },
    { key: 'available', label: 'Available' },
  ],
  activity: [
    { key: 'when', label: 'When' },
    { key: 'action', label: 'Action' },
    { key: 'operator', label: 'Operator' },
    { key: 'item', label: 'Item', cell: (r) => r.item?.name },
    { key: 'detail', label: 'Detail' },
    { key: 'note', label: 'Note', cell: (r) => r.note && <span className="note">{r.note}</span> },
  ],
}

// Stored per computer and per List: which columns show.
const columnsKey = (kind: ListKind) => `columns:${kind}`
function readColumns(kind: ListKind): string[] {
  const all: AnyColumn[] = COLUMNS[kind]
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(columnsKey(kind)) ?? 'null')
    if (Array.isArray(stored)) return all.filter((c, i) => i === 0 || stored.includes(c.key)).map((c) => c.key)
  } catch {}
  return all.filter((c) => !c.hidden).map((c) => c.key)
}

type Option = { value: string; label: string }
type Filter = { key: string; label: string; options: Option[] }
type Names = Partial<Record<'models' | 'categories' | 'departments', StatusLabel[]>>
const toOptions = (list: StatusLabel[] = []): Option[] => list.map((l) => ({ value: String(l.id), label: l.name }))
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const namesNeeded: Record<ListKind, (keyof Names)[]> = { assets: ['models', 'categories'], users: ['departments'], locations: [], models: ['categories'], activity: [] }

function filtersFor(kind: ListKind, names: Names, statusLabels: StatusLabel[], locations: StatusLabel[]): Filter[] {
  switch (kind) {
    case 'assets': return [
      { key: 'status', label: 'Checked out or available', options: [{ value: 'Deployed', label: 'Checked out' }, { value: 'RTD', label: 'Available' }] },
      { key: 'status_id', label: 'Any status', options: toOptions(statusLabels) },
      { key: 'location_id', label: 'Any Location', options: toOptions(locations) },
      { key: 'model_id', label: 'Any Asset Model', options: toOptions(names.models) },
      { key: 'category_id', label: 'Any category', options: toOptions(names.categories) },
    ]
    case 'users': return [
      { key: 'location_id', label: 'Any Location', options: toOptions(locations) },
      { key: 'department_id', label: 'Any department', options: toOptions(names.departments) },
    ]
    case 'models': return [{ key: 'category_id', label: 'Any category', options: toOptions(names.categories) }]
    case 'activity': return [
      { key: 'action_type', label: 'Any action', options: ACTIVITY_ACTIONS.map((a) => ({ value: a, label: a === 'checkin from' ? 'Checkin' : capital(a) })) },
    ]
    default: return []
  }
}

/** What opening a row does: an Asset opens its sheet; a User, Location or Asset Model opens the Assets List filtered to it. */
export type Drill = { filters: Record<string, string>; label?: string }
export const drillTo = (kind: OtherKind, { id, name }: { id: number; name: string }): Drill =>
  kind === 'users' ? { filters: { user_id: String(id) }, label: `Checked out to ${name}` } : { filters: { [kind === 'locations' ? 'location_id' : 'model_id']: String(id) } }

type Quick = { id: number; action: 'checkin' | 'checkout' | 'status' }

// Loads when opened and whenever the search, a filter, the sort, or the page changes; no background polling.
export function ListView({ kind, drill, statusLabels, locations, defaultLocation, onOpenAsset, onDrill }: {
  kind: ListKind
  drill?: Drill
  statusLabels: StatusLabel[]
  locations: StatusLabel[]
  defaultLocation: StatusLabel | null
  onOpenAsset: (id: number) => void
  onDrill: (drill: Drill) => void
}) {
  const [text, setText] = useState('')
  const [search, setSearch] = useState('')
  const [filters, setFilters] = useState<Record<string, string>>(drill?.filters ?? {})
  const [sort, setSort] = useState<{ key: string; order: 'asc' | 'desc' } | null>(null)
  const [offset, setOffset] = useState(0)
  const [page, setPage] = useState<ListPage<ListKind> | null>(null)
  const [loading, setLoading] = useState(false)
  const [reloads, setReloads] = useState(0)
  const [names, setNames] = useState<Names>({})
  const [shown, setShown] = useState(() => readColumns(kind))
  const [customizing, setCustomizing] = useState(false)
  const [quick, setQuick] = useState<Quick | null>(null)
  const [message, setMessage] = useState<{ text: string; error?: boolean }>({ text: '' })

  // Search after a short pause in typing, from the first page.
  useEffect(() => {
    if (text === search) return
    const timer = setTimeout(() => (setSearch(text), setOffset(0)), 300)
    return () => clearTimeout(timer)
  }, [text])
  useEffect(() => {
    let stale = false
    setLoading(true)
    window.snipeIt.list(kind, { search, filters, sort: sort?.key, order: sort?.order, offset }).then(
      (p) => {
        if (stale) return
        // A Quick Action can shrink the List under the current page; step back to the last page that has rows.
        if (offset > 0 && offset >= p.total) return setOffset(Math.max(0, Math.ceil(p.total / LIST_PAGE) - 1) * LIST_PAGE)
        setPage(p)
        setMessage((m) => (m.error ? { text: '' } : m))
      },
      (e: Error) => !stale && (setPage(null), setMessage({ text: e.message, error: true })),
    ).finally(() => !stale && setLoading(false))
    return () => { stale = true }
  }, [kind, search, filters, sort, offset, reloads])
  // A filter whose names don't load just has fewer choices.
  useEffect(() => {
    let stale = false
    for (const n of namesNeeded[kind]) window.snipeIt.names(n).then((v) => !stale && setNames((names) => ({ ...names, [n]: v })), () => {})
    return () => { stale = true }
  }, [kind])
  useEffect(() => localStorage.setItem(columnsKey(kind), JSON.stringify(shown)), [kind, shown])

  const all: AnyColumn[] = COLUMNS[kind]
  const columns = all.filter((c) => shown.includes(c.key))
  const sortable: Record<string, string> = LIST_SORTS[kind]
  const setFilter = (key: string, value: string) => (setFilters((f) => ({ ...f, [key]: value })), setOffset(0))
  const toggleSort = (key: string) => (setSort((s) => (s?.key === key && s.order === 'asc' ? { key, order: 'desc' } : { key, order: 'asc' })), setOffset(0))

  // A rejected Quick Action keeps its form open with the typed inputs; Snipe-IT's reason shows above the List.
  const act = async (done: string, work: Promise<void>) => {
    try {
      await work
      setQuick(null)
      setMessage({ text: done })
      setReloads((n) => n + 1)
    } catch (e) {
      setMessage({ text: (e as Error).message, error: true })
    }
  }
  const checkin = (a: Asset) => (id: number, o: CheckinOptions) => act(`Checked in ${a.assetTag}`, window.snipeIt.checkin(id, o))
  const checkout = (a: Asset) => (id: number, o: CheckoutOptions) => act(`Checked out ${a.assetTag}`, window.snipeIt.checkout(id, o))

  function open(row: ListRows[ListKind]): (() => void) | undefined {
    if (kind === 'assets') return () => onOpenAsset(row.id)
    if (kind !== 'activity') return () => onDrill(drillTo(kind, row as ListRows[OtherKind]))
    const item = (row as ListRows['activity']).item
    return item?.type === 'asset' ? () => onOpenAsset(item.id) : undefined
  }

  function cell(c: AnyColumn, row: ListRows[ListKind], first: boolean) {
    const value = c.cell ? c.cell(row as never) : (row as Record<string, unknown>)[c.key] as ReactNode
    const shownValue = value === '' || value == null ? '—' : value
    // The row's way in: the first column, or for the Activity Report the Asset it names.
    const go = (first && kind !== 'activity') || (kind === 'activity' && c.key === 'item') ? open(row) : undefined
    return <td key={c.key}>{go ? <button className={`link${first ? ' mono' : ''}`} onClick={go}>{shownValue}</button> : shownValue}</td>
  }

  const rows = page?.rows ?? []
  const total = page?.total ?? 0
  const filterBar = filtersFor(kind, names, statusLabels, locations)
  return (
    <>
      <header className="head">
        <h1>{listName[kind]}</h1>
        <span className="dim mono">{loading ? 'Loading…' : page && `${total.toLocaleString()} total`}</span>
        <div className="actions">
          <button className={`quiet${customizing ? ' on' : ''}`} onClick={() => setCustomizing((c) => !c)} aria-expanded={customizing}>Columns</button>
          <button onClick={() => setReloads((n) => n + 1)} disabled={loading}>Refresh</button>
        </div>
      </header>
      {customizing && (
        <div className="customize">
          <ol aria-label="Columns">
            <li className="k">Columns</li>
            {all.slice(1).map((c) => (
              <li key={c.key}>
                <label>
                  <input type="checkbox" checked={shown.includes(c.key)} onChange={() => setShown((s) => (s.includes(c.key) ? s.filter((k) => k !== c.key) : [...s, c.key]))} />
                  {c.label}
                </label>
              </li>
            ))}
          </ol>
        </div>
      )}
      <div className="filters actions">
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder={`Search ${listName[kind]}…`} aria-label={`Search ${listName[kind]}`} />
        {filterBar.map((f) => (
          <select key={f.key} value={filters[f.key] ?? ''} onChange={(e) => setFilter(f.key, e.target.value)} aria-label={f.label.replace(/^Any /, 'Filter by ')}>
            <option value="">{f.label}</option>
            {/* A drilled-into value shows even before its names load. */}
            {filters[f.key] && !f.options.some((o) => o.value === filters[f.key]) && <option value={filters[f.key]}>…</option>}
            {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        ))}
        {filters.user_id && (
          <button className="quiet" onClick={() => setFilter('user_id', '')} aria-label={`Remove filter: ${drill?.label ?? 'User'}`}>
            {drill?.label ?? 'Checked out to a User'} ×
          </button>
        )}
      </div>
      {message.text && <p className={message.error ? 'message error' : 'message list-message'} role={message.error ? 'alert' : 'status'}>{message.text}</p>}
      <table className="history list-table">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} aria-sort={sort?.key === c.key ? (sort.order === 'asc' ? 'ascending' : 'descending') : undefined}>
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
            const q = kind === 'assets' && quick?.id === row.id ? quick : null
            const toggle = (action: Quick['action']) => (setQuick(q?.action === action ? null : { id: row.id, action }), setMessage({ text: '' }))
            return [
              <tr key={row.id} className={q ? 'sel' : undefined}>
                {columns.map((c, i) => cell(c, row, i === 0))}
                {kind === 'assets' && (
                  <td className="quick">
                    <button disabled={!a.assignee} onClick={() => toggle('checkin')} className={q?.action === 'checkin' ? 'on' : undefined} title={a.assignee ? undefined : 'Not checked out'}>Checkin</button>
                    <button disabled={!a.checkoutAllowed} onClick={() => toggle('checkout')} className={q?.action === 'checkout' ? 'on' : undefined}
                      title={a.checkoutAllowed ? undefined : a.assignee ? 'Already checked out' : `"${a.status}" can't be checked out`}>Checkout</button>
                    <button onClick={() => toggle('status')} className={q?.action === 'status' ? 'on' : undefined}>Status</button>
                  </td>
                )}
              </tr>,
              q && (
                <tr key={`${row.id}-quick`} className="quick-form">
                  <td colSpan={columns.length + 1}>
                    {q.action === 'checkin' && <CheckinForm asset={a} statusLabels={statusLabels} locations={locations} defaultLocation={defaultLocation} onCheckin={checkin(a)} />}
                    {q.action === 'checkout' && <CheckoutForm asset={a} defaultLocation={defaultLocation} onCheckout={checkout(a)} />}
                    {q.action === 'status' && <StatusForm asset={a} statusLabels={statusLabels} onSave={(statusId) => act(`Changed ${a.assetTag}'s status`, window.snipeIt.updateStatus(a.id, statusId))} />}
                  </td>
                </tr>
              ),
            ]
          })}
        </tbody>
      </table>
      {page && rows.length === 0 && <p className="empty">Nothing matches</p>}
      {total > LIST_PAGE && (
        <div className="pager actions">
          <span className="dim mono">{(offset + 1).toLocaleString()}–{Math.min(offset + LIST_PAGE, total).toLocaleString()} of {total.toLocaleString()}</span>
          <button className="quiet" disabled={offset === 0 || loading} onClick={() => setOffset((o) => Math.max(0, o - LIST_PAGE))}>Previous</button>
          <button className="quiet" disabled={offset + LIST_PAGE >= total || loading} onClick={() => setOffset((o) => o + LIST_PAGE)}>Next</button>
        </div>
      )}
    </>
  )
}

function StatusForm({ asset: a, statusLabels, onSave }: { asset: Asset; statusLabels: StatusLabel[]; onSave: (statusId: number) => Promise<void> }) {
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
      <select autoFocus value={statusId ?? ''} onChange={(e) => setStatusId(Number(e.target.value))} aria-label={`New status for ${a.assetTag}`}>
        {statusId === null && <option value="" disabled>Choose a status</option>}
        {labels.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
      </select>
      <button disabled={busy || statusId === null || statusId === a.statusId}>{busy ? 'Saving…' : 'Save status'}</button>
    </form>
  )
}
