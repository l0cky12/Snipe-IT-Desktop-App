import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ACTIVITY_ACTIONS, actionLabel, LIST_PAGE, LIST_SORTS, toSummary, type Asset, type AssetSummary, type CheckinOptions, type CheckoutOptions, type ListKind, type ListPage, type ListRows, type OtherKind, type RecordKind, type EditKind, type StatusLabel } from '../../main/snipeit'
import { editable } from './RecordView'
import { CheckinForm, CheckoutForm, NOT_ALLOWED, StatusChip, checkinReason, checkoutReason, statusChoices } from './App'

export const listName: Record<ListKind, string> = {
  assets: 'Assets', users: 'Users', locations: 'Locations', models: 'Asset Models', activity: 'Activity Report',
  licenses: 'Licenses', accessories: 'Accessories', consumables: 'Consumables', components: 'Components', categories: 'Categories',
  manufacturers: 'Manufacturers', suppliers: 'Suppliers', departments: 'Departments', companies: 'Companies', statuslabels: 'Status Labels',
}
// The stocked kinds share their columns: what it is, where it is, and how many are left
// (Available for Accessories and Components, Remaining for Consumables, as CONTEXT.md names them).
const stockColumns = <K extends 'accessories' | 'consumables' | 'components'>(left: string): Column<K>[] => [
  { key: 'name', label: 'Name' },
  { key: 'category', label: 'Category' },
  { key: 'manufacturer', label: 'Manufacturer', hidden: true },
  { key: 'location', label: 'Location' },
  { key: 'qty', label: 'Quantity' },
  { key: 'remaining', label: left },
]

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
  licenses: [
    { key: 'name', label: 'Name' },
    { key: 'manufacturer', label: 'Manufacturer' },
    { key: 'category', label: 'Category', hidden: true },
    { key: 'seats', label: 'Seats' },
    { key: 'free', label: 'Free' },
    { key: 'expires', label: 'Expires' },
  ],
  accessories: stockColumns('Available'),
  consumables: stockColumns('Remaining'),
  components: stockColumns('Available'),
  categories: [{ key: 'name', label: 'Name' }, { key: 'type', label: 'Type', cell: (r) => capital(r.type) }, { key: 'items', label: 'Items' }],
  manufacturers: [{ key: 'name', label: 'Name' }, { key: 'assets', label: 'Assets' }],
  suppliers: [
    { key: 'name', label: 'Name' },
    { key: 'contact', label: 'Contact' },
    { key: 'phone', label: 'Phone', hidden: true },
    { key: 'email', label: 'Email', hidden: true },
    { key: 'assets', label: 'Assets' },
  ],
  departments: [
    { key: 'name', label: 'Name' },
    { key: 'company', label: 'Company', hidden: true },
    { key: 'manager', label: 'Manager' },
    { key: 'location', label: 'Location' },
    { key: 'users', label: 'Users' },
  ],
  companies: [{ key: 'name', label: 'Name' }, { key: 'assets', label: 'Assets' }, { key: 'users', label: 'Users' }],
  statuslabels: [{ key: 'name', label: 'Name' }, { key: 'type', label: 'Type', cell: (r) => capital(r.type) }, { key: 'assets', label: 'Assets' }],
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
const namesNeeded: Partial<Record<ListKind, (keyof Names)[]>> = { assets: ['models', 'categories'], users: ['departments'], models: ['categories'] }

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
      { key: 'action_type', label: 'Any action', options: ACTIVITY_ACTIONS.map((a) => ({ value: a, label: actionLabel(a) })) },
    ]
    default: return []
  }
}

/** A List opened already filtered to one record, e.g. a Location's Assets; label names a filter that has no filter box. */
export type Drill = { filters: Record<string, string>; label?: string }
// "Categories" → "Category", "Status Labels" → "Status Label".
export const singular = (kind: ListKind) => listName[kind].replace(/ies$/, 'y').replace(/s$/, '')
/** What a Drill from one record is called: a User's Assets are "Checked out to" them, anything else "Kind: name". */
export const drillLabel = (kind: RecordKind, name: string) => (kind === 'users' ? `Checked out to ${name}` : `${singular(kind)}: ${name}`)
export const drillTo = (kind: OtherKind, { id, name }: { id: number; name: string }): Drill =>
  kind === 'users' ? { filters: { user_id: String(id) }, label: drillLabel(kind, name) } : { filters: { [kind === 'locations' ? 'location_id' : 'model_id']: String(id) } }

type Quick = { id: number; action: 'checkin' | 'checkout' | 'status' }

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

// Loads when opened and whenever the search, a filter, the sort, or the page changes; no background polling.
// Opening a row: an Asset opens its sheet, any other record its page of fields.
export function ListView({ kind, drill, statusLabels, locations, defaultLocation, onOpenAsset, onOpenRecord, batch, onBatch, onNew }: {
  onNew: (kind: EditKind) => void
  kind: ListKind
  batch: AssetSummary[]
  onBatch: (a: AssetSummary[]) => void
  drill?: Drill
  statusLabels: StatusLabel[]
  locations: StatusLabel[]
  defaultLocation: StatusLabel | null
  onOpenAsset: (id: number) => void
  onOpenRecord: (kind: RecordKind, id: number) => void
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
  // The Selection lives with this List; leaving it (or opening another) starts the next one empty.
  const [selection, setSelection] = useState<Selection<ListRows[ListKind]>>(new Map())
  // "Select all N matching": asking to confirm, or fetching; a newer query or Clear makes a fetch still going stale.
  const [selectingAll, setSelectingAll] = useState<'asking' | 'fetching' | null>(null)
  const selectEpoch = useRef(0)
  // One page of this List as searched, filtered and sorted now; "select all" pages it in id order instead.
  const fetchPage = (offset: number, order = sort) => window.snipeIt.list(kind, { search, filters, sort: order?.key, order: order?.order, offset })

  // Search after a short pause in typing, from the first page.
  useEffect(() => {
    if (text === search) return
    const timer = setTimeout(() => (setSearch(text), setOffset(0)), 300)
    return () => clearTimeout(timer)
  }, [text])
  // A "select all" still fetching stops when what matches changes; turning the page or a refresh doesn't change that.
  useEffect(() => () => { selectEpoch.current++; setSelectingAll(null) }, [kind, search, filters, sort])
  useEffect(() => {
    let stale = false
    setLoading(true)
    fetchPage(offset).then(
      (p) => {
        if (stale) return
        // A Quick Action can shrink the List under the current page; step back to the last page that has rows.
        if (offset > 0 && offset >= p.total) return setOffset(Math.max(0, Math.ceil(p.total / LIST_PAGE) - 1) * LIST_PAGE)
        setPage(p)
        setSelection((s) => refreshed(s, p.rows))
        setMessage((m) => (m.error ? { text: '' } : m))
      },
      (e: Error) => !stale && (setPage(null), setMessage({ text: e.message, error: true })),
    ).finally(() => !stale && setLoading(false))
    return () => { stale = true }
  }, [kind, search, filters, sort, offset, reloads])
  // A filter whose names don't load just has fewer choices.
  useEffect(() => {
    let stale = false
    for (const n of namesNeeded[kind] ?? []) window.snipeIt.names(n).then((v) => !stale && setNames((names) => ({ ...names, [n]: v })), () => {})
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
  const checkout = (a: Asset) => (o: CheckoutOptions) => act(`Checked out ${a.assetTag}`, window.snipeIt.checkout(a.id, o))

  function open(row: ListRows[ListKind]): (() => void) | undefined {
    if (kind === 'assets') return () => onOpenAsset(row.id)
    if (kind !== 'activity') return () => onOpenRecord(kind, row.id)
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
  const filterBar = filtersFor(kind, names, statusLabels, locations)
  return (
    <>
      <header className="head">
        <h1>{listName[kind]}</h1>
        <span className="dim mono">{loading ? 'Loading…' : page && `${total.toLocaleString()} total`}</span>
        <div className="actions">
          <button className={`quiet${customizing ? ' on' : ''}`} onClick={() => setCustomizing((c) => !c)} aria-expanded={customizing}>Columns</button>
          {editable(kind) && <button className="quiet" onClick={() => onNew(kind)}>New {singular(kind)}</button>}
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
        {filterBar.map((f) => <FilterBox key={f.key} filter={f} value={filters[f.key] ?? ''} onPick={(v) => setFilter(f.key, v)} />)}
        {/* A drilled-into filter with no box of its own (e.g. a User's, a Manufacturer's) shows as a chip that removes it. */}
        {Object.keys(drill?.filters ?? {}).filter((k) => filters[k] && !filterBar.some((f) => f.key === k)).map((k) => (
          <button key={k} className="quiet" onClick={() => setFilter(k, '')} aria-label={`Remove filter: ${drill?.label ?? k}`}>
            {drill?.label ?? 'Filtered'} ×
          </button>
        ))}
      </div>
      {message.text && <p className={message.error ? 'message error' : 'message list-message'} role={message.error ? 'alert' : 'status'}>{message.text}</p>}
      {selectable && (selection.size > 0 || selectingAll) && (
        <div className="selection actions" role="region" aria-label="Selection">
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
            <button className="quiet" disabled={selectingAll === 'fetching'} onClick={() => (confirmSelectAll(total) ? setSelectingAll('asking') : selectAll())}>
              {selectingAll === 'fetching' ? 'Selecting…' : `Select all ${total.toLocaleString()} matching`}
            </button>
          )}
          {kind === 'assets' && <button className="quiet" onClick={() => onBatch([...selection.values()].map((a) => toSummary(a as Asset)))}>Add to Batch</button>}
          <button className="quiet" onClick={clear}>Clear</button>
        </div>
      )}
      <table className="history list-table">
        <thead>
          <tr>
            {selectable && (
              <th className="tick">
                <input type="checkbox" checked={ticks === 'all'} ref={(el) => { if (el) el.indeterminate = ticks === 'some' }} disabled={!rows.length}
                  onChange={() => setSelection((s) => tick(s, rows))} aria-label="Select this page" />
              </th>
            )}
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
            const inBatch = batch.some((b) => b.id === a.id)
            return [
              <tr key={row.id} className={q ? 'sel' : selection.has(row.id) ? 'ticked' : undefined}>
                {selectable && (
                  <td className="tick">
                    <input type="checkbox" checked={selection.has(row.id)} onChange={() => setSelection((s) => tick(s, [row]))}
                      aria-label={`Select ${kind === 'assets' ? a.assetTag : (row as { name?: string }).name ?? `#${row.id}`}`} />
                  </td>
                )}
                {columns.map((c, i) => cell(c, row, i === 0))}
                {kind === 'assets' && (
                  <td className="quick">
                    <button disabled={!a.assignee || !a.can.checkin} onClick={() => toggle('checkin')} className={q?.action === 'checkin' ? 'on' : undefined}
                      title={checkinReason(a)}>Checkin</button>
                    <button disabled={!a.checkoutAllowed || !a.can.checkout} onClick={() => toggle('checkout')} className={q?.action === 'checkout' ? 'on' : undefined}
                      title={checkoutReason(a)}>Checkout</button>
                    <button disabled={!a.can.update} onClick={() => toggle('status')} className={q?.action === 'status' ? 'on' : undefined} title={a.can.update ? undefined : NOT_ALLOWED}>Status</button>
                    <button disabled={inBatch} onClick={() => onBatch([toSummary(a)])}>{inBatch ? 'In batch' : 'Batch'}</button>
                  </td>
                )}
              </tr>,
              q && (
                <tr key={`${row.id}-quick`} className="quick-form">
                  <td colSpan={columns.length + 1 + (selectable ? 1 : 0)}>
                    {q.action === 'checkin' && <CheckinForm asset={a} statusLabels={statusLabels} locations={locations} defaultLocation={defaultLocation} onCheckin={checkin(a)} />}
                    {q.action === 'checkout' && <CheckoutForm defaultLocation={defaultLocation} onCheckout={checkout(a)} />}
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
