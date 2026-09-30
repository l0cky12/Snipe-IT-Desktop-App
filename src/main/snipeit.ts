export type Config = { baseUrl: string; apiKey: string }

export type Assignee = { type: 'user' | 'location' | 'asset'; id: number; name: string }

export type Asset = {
  id: number
  assetTag: string
  name: string
  model: string
  status: string
  /** Snipe-IT's status label id; the Checkin status dropdown defaults to it */
  statusId: number | null
  /** Snipe-IT's status_meta: deployed, deployable, pending, archived, undeployable */
  statusMeta: string
  assignee: Assignee | null
  /** Checkout allowed: no Assignee and a deployable status */
  checkoutAllowed: boolean
  location: string
  category: string
  serial: string
  purchaseDate: string | null
  warrantyEnd: string | null
  expectedCheckin: string | null
  /** Days past the Expected Checkin, or null when not Overdue */
  overdueDays: number | null
  /** Expiring (ends within 90 days) or expired; null when neither, or when Snipe-IT has no warranty date */
  warranty: { expired: false; daysLeft: number } | { expired: true } | null
}

export type HistoryEntry = { when: string; action: string; operator: string; detail: string; note: string }

/** historyError is set when History couldn't be loaded (e.g. the key lacks permission); the Asset still shows. */
export type AssetWithHistory = Asset & { history: HistoryEntry[]; historyError?: string }

export type StatusLabel = { id: number; name: string }

export type CheckinOptions = { statusId?: number; locationId?: number; note?: string }

/** A User or Location to check an Asset out to. detail tells namesakes apart (a User's username). */
export type CheckoutTarget = { id: number; name: string; detail: string }

/** Checkout targets are Users and Locations only; Asset-to-Asset isn't supported. expectedCheckin is "YYYY-MM-DD". */
export type CheckoutOptions = { targetType: 'user' | 'location'; targetId: number; expectedCheckin?: string; note?: string }

/** What the rail shows for a match or a recent scan. */
export type AssetSummary = Pick<Asset, 'id' | 'assetTag' | 'name' | 'status' | 'statusMeta' | 'assignee'>

/** The kinds that open the Assets List filtered to them. */
export type OtherKind = 'users' | 'locations' | 'models'
/** The kinds Lookup searches besides Assets. */
export type SearchKind = OtherKind | 'licenses' | 'accessories' | 'consumables' | 'components'
/** matched names the field the text was found in, or is '' when Snipe-IT matched on a field the app doesn't check. */
export type Match = CheckoutTarget & { matched: string }
/** Lookup's matches of one other kind, or why that kind couldn't be searched (e.g. the key can't read Users). */
export type Matches = { kind: SearchKind; rows: Match[] } | { kind: SearchKind; error: string }

/** An exact Asset Tag hit carries the full Asset; a text search carries Asset summaries and the other kinds' matches. */
export type LookupResult = { exact: true; assets: [Asset] } | { exact: false; assets: (AssetSummary & { matched: string })[]; others: Matches[] }

export type UserRow = { id: number; name: string; username: string; email: string; department: string; location: string; assets: number }
export type LocationRow = { id: number; name: string; parent: string; city: string; assets: number; checkedOut: number; users: number }
/** available is null when Snipe-IT doesn't say. */
export type ModelRow = { id: number; name: string; modelNumber: string; manufacturer: string; category: string; assets: number; available: number | null }
/** One Activity Report entry; item is what was acted on (an Asset, a License…). */
export type ActivityRow = HistoryEntry & { id: number; item: { type: string; id: number; name: string } | null }
export type ListRows = { assets: Asset; users: UserRow; locations: LocationRow; models: ModelRow; activity: ActivityRow }
export type ListKind = keyof ListRows
/** sort is a row field (see LIST_SORTS); filters are Snipe-IT filter name → value, '' meaning none. offset counts rows. */
export type ListQuery = { search?: string; filters?: Record<string, string>; sort?: string; order?: 'asc' | 'desc'; offset?: number }
export type ListPage<K extends ListKind> = { total: number; rows: ListRows[K][] }

/** The eight dashboard pieces: six Inventory Chart bars, then the two tables. */
export const DASHBOARD_PIECES = ['assets', 'licenses', 'accessories', 'consumables', 'components', 'users', 'overdue', 'expiring'] as const
export type DashboardPiece = (typeof DASHBOARD_PIECES)[number]
/** The pieces built from the one Asset list; the screen groups them so they share a fetch. */
export const ASSET_PIECES: readonly DashboardPiece[] = ['assets', 'overdue', 'expiring']

/** One Asset status segment of the Inventory Chart. color is Snipe-IT's status label color, or null when it has none. */
export type AssetSegment = { status: string; statusMeta: string; color: string | null; count: number; assets: AssetSummary[] }
/** Why a dashboard piece couldn't load: Snipe-IT's reason, or the app's connection message. */
export type Failed = { error: string }
/** A kind counted by quantity: the used side (In use, Checked out, Used, Holding) and the available side. */
export type Split = { used: number; available: number }

/**
 * One entry per requested piece: its data, or { error } with the reason it couldn't load.
 * Asset segments most first, Overdue Assets most late first, Expiring Warranties soonest first (expired ones left out).
 */
export type Dashboard = {
  [K in DashboardPiece]?: Failed | {
    assets: AssetSegment[]
    licenses: Split; accessories: Split; consumables: Split; components: Split; users: Split
    overdue: (AssetSummary & { overdueDays: number })[]
    expiring: (AssetSummary & { daysLeft: number })[]
  }[K]
}

export type SnipeIt = ReturnType<typeof createSnipeIt>

type SnipeItError = { status: 'error'; messages: unknown }
type Named = { id: number; name: string } | null
type RawAsset = {
  id: number
  asset_tag: string
  name: string | null
  serial: string | null
  model: Named
  status_label: { id: number; name: string; status_meta: string } | null
  category: Named
  location: Named
  assigned_to: { id: number; name: string; type: Assignee['type'] } | null
  purchase_date: { date: string } | null
  warranty_expires: { date: string } | null
  expected_checkin: { date: string } | null
}
type RawActivity = {
  id: number
  item?: { id: number; name: string; type: string } | null
  action_type: string
  created_at: { datetime: string } | null
  // Snipe-IT v8 renamed `admin` to `created_by`.
  created_by?: Named
  admin?: Named
  target: Named
  note: string | null
}

const EXPIRING_DAYS = 90
// Rows per List page.
export const LIST_PAGE = 50
// Kinds counted by quantity: their list, and the fields for the whole quantity and the available part. Used is the rest.
const QUANTITIES = {
  licenses: ['/licenses', 'seats', 'free_seats_count'],
  accessories: ['/accessories', 'qty', 'remaining_qty'],
  consumables: ['/consumables', 'qty', 'remaining'],
  components: ['/components', 'qty', 'remaining'],
} as const
// ponytail: first 50 text-search matches only; a rail longer than that isn't scannable anyway.
const SEARCH_LIMIT = 50
// The usual server maximum per page; a server that caps lower still gets paged through.
const PAGE_LIMIT = 500
// How long one request may take. A full page of PAGE_LIMIT rows can take a busy Snipe-IT well past the usual budget.
const TIMEOUT = 15000
const PAGE_TIMEOUT = 60000
// Pages of one list asked for at once. ponytail: caps one list only; the Dashboard still pages several lists concurrently,
// so a load can have more than this many requests open. A shared semaphore in createSnipeIt would cap them all.
const PAGE_BATCH = 4

// Whole days from today to a Snipe-IT date ("YYYY-MM-DD"); negative when the date is past.
function daysFrom(today: Date, date: string): number {
  const [y, m, d] = date.split('-').map(Number)
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())) / 864e5)
}

// Snipe-IT HTML-escapes text fields; decode every string in a response before reshaping it.
const entities: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
const decodeHtml = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e: string) =>
    e[0] !== '#' ? entities[e.toLowerCase()]
    : String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1))))

// Snipe-IT's messages are a string, or field → messages for validation errors; flatten to one line.
const reason = (messages: unknown): string =>
  messages == null ? ''
  : typeof messages === 'object' ? Object.values(messages).flat().map(reason).join(' ')
  : String(messages)

// Snipe-IT says a row matched a search, not on which field. Lookup checks these, in order, for the text;
// a field holding an object (a Location, an Asset Model…) is checked by its name. An Asset's custom fields come after.
const MATCH_FIELDS: Record<SearchKind | 'assets', [label: string, field: string][]> = {
  assets: [['Asset Tag', 'asset_tag'], ['Name', 'name'], ['Serial', 'serial'], ['Asset Model', 'model'], ['Model No.', 'model_number'], ['Assignee', 'assigned_to'],
    ['Location', 'location'], ['Status', 'status_label'], ['Category', 'category'], ['Manufacturer', 'manufacturer'], ['Supplier', 'supplier'], ['Order number', 'order_number'], ['Notes', 'notes']],
  users: [['Name', 'name'], ['Username', 'username'], ['Email', 'email'], ['Employee No.', 'employee_num'], ['Job title', 'jobtitle'], ['Department', 'department'], ['Location', 'location'], ['Notes', 'notes']],
  locations: [['Name', 'name'], ['Address', 'address'], ['City', 'city'], ['State', 'state'], ['Zip', 'zip'], ['Parent', 'parent'], ['Notes', 'notes']],
  models: [['Name', 'name'], ['Model No.', 'model_number'], ['Manufacturer', 'manufacturer'], ['Category', 'category'], ['Notes', 'notes']],
  licenses: [['Name', 'name'], ['Product key', 'product_key'], ['Licensed to', 'license_name'], ['Licensed to email', 'license_email'], ['Manufacturer', 'manufacturer'], ['Category', 'category'], ['Order number', 'order_number'], ['Notes', 'notes']],
  accessories: [['Name', 'name'], ['Model No.', 'model_number'], ['Manufacturer', 'manufacturer'], ['Category', 'category'], ['Order number', 'order_number'], ['Notes', 'notes']],
  consumables: [['Name', 'name'], ['Item No.', 'item_no'], ['Model No.', 'model_number'], ['Manufacturer', 'manufacturer'], ['Category', 'category'], ['Order number', 'order_number'], ['Notes', 'notes']],
  components: [['Name', 'name'], ['Serial', 'serial'], ['Manufacturer', 'manufacturer'], ['Category', 'category'], ['Order number', 'order_number'], ['Notes', 'notes']],
}

function matchedField(kind: SearchKind | 'assets', raw: Record<string, unknown>, text: string): string {
  const q = text.toLowerCase()
  const holds = (v: unknown) => {
    const value = v && typeof v === 'object' ? (v as { name?: unknown }).name : v
    // Notes arrive as inline HTML rendered from Markdown; match the text, not the markup.
    return (typeof value === 'string' || typeof value === 'number') && String(value).replace(/<[^>]*>/g, '').toLowerCase().includes(q)
  }
  const named = MATCH_FIELDS[kind]
  const label = (key: string) => named.find(([, f]) => f === key)?.[0] ?? key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, ' ')
  // Snipe-IT sends custom fields as label → { value }, or [] when the Asset has none.
  const custom = kind === 'assets' && raw.custom_fields && typeof raw.custom_fields === 'object'
    ? Object.entries(raw.custom_fields as Record<string, { value?: unknown } | null>).map(([label, f]): [string, unknown] => [label, f?.value])
    : []
  // Last, everything else Snipe-IT sent (and the text inside its objects, not their ids): it may have matched on a field the list doesn't name.
  const rest = Object.entries(raw).filter(([k]) => k !== 'custom_fields' && k !== 'id').flatMap(([k, v]): [string, unknown][] =>
    v && typeof v === 'object' ? Object.values(v).filter((x) => typeof x === 'string').map((x): [string, unknown] => [label(k), x]) : [[label(k), v]])
  return [...named.map(([l, field]): [string, unknown] => [l, raw[field]]), ...custom, ...rest].find(([, v]) => holds(v))?.[0] ?? ''
}

// ponytail: matches Snipe-IT's English action_type values; other actions show as-is, capitalized.
const actions: Record<string, { label: string; prep: string }> = {
  checkout: { label: 'Checkout', prep: 'to ' },
  'checkin from': { label: 'Checkin', prep: 'from ' },
}

function toHistoryEntry(raw: RawActivity): HistoryEntry {
  const known = actions[raw.action_type]
  const target = raw.target?.name
  return {
    when: raw.created_at?.datetime.slice(0, 16) ?? '',
    action: known?.label ?? raw.action_type.charAt(0).toUpperCase() + raw.action_type.slice(1),
    operator: (raw.created_by ?? raw.admin)?.name ?? '',
    detail: target ? (known?.prep ?? '') + target : '',
    // Snipe-IT renders notes from Markdown into inline HTML; show the plain text.
    note: raw.note?.replace(/<[^>]*>/g, '') ?? '',
  }
}

export const toSummary = ({ id, assetTag, name, status, statusMeta, assignee }: Asset): AssetSummary =>
  ({ id, assetTag, name, status, statusMeta, assignee })

function toAsset(raw: RawAsset, today: Date): Asset {
  const expectedCheckin = raw.expected_checkin?.date ?? null
  const warrantyEnd = raw.warranty_expires?.date ?? null
  const overdue = expectedCheckin && raw.assigned_to ? -daysFrom(today, expectedCheckin) : 0
  const warrantyLeft = warrantyEnd === null ? null : daysFrom(today, warrantyEnd)
  return {
    id: raw.id,
    assetTag: raw.asset_tag,
    name: raw.name ?? '',
    model: raw.model?.name ?? '',
    status: raw.status_label?.name ?? '',
    statusId: raw.status_label?.id ?? null,
    statusMeta: raw.status_label?.status_meta ?? '',
    assignee: raw.assigned_to && { type: raw.assigned_to.type, id: raw.assigned_to.id, name: raw.assigned_to.name },
    checkoutAllowed: !raw.assigned_to && raw.status_label?.status_meta === 'deployable',
    location: raw.location?.name ?? '',
    category: raw.category?.name ?? '',
    serial: raw.serial ?? '',
    purchaseDate: raw.purchase_date?.date ?? null,
    warrantyEnd,
    expectedCheckin,
    overdueDays: overdue > 0 ? overdue : null,
    warranty:
      warrantyLeft === null || warrantyLeft > EXPIRING_DAYS ? null
      : warrantyLeft < 0 ? { expired: true }
      : { expired: false, daysLeft: warrantyLeft },
  }
}

type RawUser = { id: number; name: string; username: string | null; email: string | null; department: Named; location: Named; assets_count: number | null }
type RawLocation = { id: number; name: string; parent: Named; city: string | null; assets_count: number | null; assigned_assets_count: number | null; users_count: number | null }
type RawModel = { id: number; name: string; model_number: string | null; manufacturer: Named; category: Named; assets_count: number | null; remaining?: number | null }

// Which row fields each List can sort by, and Snipe-IT's name for that sort. The screen offers only these.
export const LIST_SORTS = {
  assets: { assetTag: 'asset_tag', name: 'name', status: 'status', model: 'model', category: 'category', location: 'location', assignee: 'assigned_to', serial: 'serial', expectedCheckin: 'expected_checkin', purchaseDate: 'purchase_date' },
  users: { name: 'last_name', username: 'username', email: 'email', department: 'department', location: 'location', assets: 'assets_count' },
  locations: { name: 'name', parent: 'parent', city: 'city', assets: 'assets_count', checkedOut: 'assigned_assets_count', users: 'users_count' },
  models: { name: 'name', modelNumber: 'model_number', manufacturer: 'manufacturer', category: 'category', assets: 'assets_count', available: 'remaining' },
  activity: { when: 'created_at', action: 'action_type', operator: 'created_by' },
} satisfies { [K in ListKind]: Partial<Record<keyof ListRows[K], string>> }

// Snipe-IT action_type values the Activity Report can be filtered by.
// Not item_type: Snipe-IT only applies it together with one item_id.
export const ACTIVITY_ACTIONS = ['checkout', 'checkin from', 'update', 'create', 'delete', 'audit'] as const

// Each List's Snipe-IT path, the filters it accepts ('id' = a positive whole number), and its row shape.
// user_id isn't Snipe-IT's; it stands for "checked out to this User" (assigned_to + assigned_type).
const LISTS: { [K in ListKind]: { path: string; filters: Record<string, 'id' | readonly string[]>; row: (raw: never, today: Date) => ListRows[K] } } = {
  assets: { path: '/hardware', filters: { status_id: 'id', location_id: 'id', model_id: 'id', category_id: 'id', user_id: 'id', status: ['Deployed', 'RTD'] }, row: toAsset },
  users: {
    path: '/users', filters: { location_id: 'id', department_id: 'id' },
    row: (r: RawUser) => ({ id: r.id, name: r.name, username: r.username ?? '', email: r.email ?? '', department: r.department?.name ?? '', location: r.location?.name ?? '', assets: r.assets_count ?? 0 }),
  },
  locations: {
    path: '/locations', filters: {},
    row: (r: RawLocation) => ({ id: r.id, name: r.name, parent: r.parent?.name ?? '', city: r.city ?? '', assets: r.assets_count ?? 0, checkedOut: r.assigned_assets_count ?? 0, users: r.users_count ?? 0 }),
  },
  models: {
    path: '/models', filters: { category_id: 'id' },
    row: (r: RawModel) => ({ id: r.id, name: r.name, modelNumber: r.model_number ?? '', manufacturer: r.manufacturer?.name ?? '', category: r.category?.name ?? '', assets: r.assets_count ?? 0, available: typeof r.remaining === 'number' ? r.remaining : null }),
  },
  activity: {
    path: '/reports/activity', filters: { action_type: ACTIVITY_ACTIONS },
    row: (r: RawActivity) => ({ id: r.id, ...toHistoryEntry(r), item: r.item ? { type: r.item.type, id: r.item.id, name: r.item.name } : null }),
  },
}

// `today` is injectable so the date rules can be tested with a fixed date.
export function createSnipeIt(config: Config, fetch: typeof globalThis.fetch, today = () => new Date()) {
  const api = `${config.baseUrl.replace(/\/+$/, '')}/api/v1`

  // Resolves to the JSON body, or { status: 'error', messages } when Snipe-IT reports an error or 404.
  // Pass `post` to send it as JSON with `method` (POST unless told otherwise) instead of GETting.
  // Every other failure throws an Error whose message the Operator can act on. All SnipeIt functions go through here.
  async function request<T>(path: string, post?: object, method = 'POST', timeout = TIMEOUT): Promise<T | SnipeItError> {
    // A server that is reachable but slow isn't a network problem; don't send the Operator to check one.
    const failed = (e: unknown) => (e as Error).name === 'TimeoutError'
      ? new Error(`Snipe-IT at ${config.baseUrl} took longer than ${timeout / 1000} seconds to answer. It may be busy; try again.`)
      : new Error(`Can't reach Snipe-IT at ${config.baseUrl}. Check your network connection and server URL in Settings.`)
    let res: Response, text: string
    try {
      res = await fetch(api + path, {
        signal: AbortSignal.timeout(timeout),
        redirect: 'error',
        headers: { Authorization: `Bearer ${config.apiKey}`, Accept: 'application/json', ...(post && { 'Content-Type': 'application/json' }) },
        ...(post && { method, body: JSON.stringify(post) }),
      })
    } catch (e) {
      throw failed(e)
    }
    if (res.status === 401)
      throw new Error('Snipe-IT rejected your API key. Check the API token in Settings, or generate a new personal API key in Snipe-IT.')
    if (res.status === 404) return { status: 'error', messages: 'Not found' }
    // The timeout covers the body too: a slow server can stall after the headers.
    try {
      text = await res.text()
    } catch (e) {
      throw failed(e)
    }
    let body: unknown
    try {
      body = JSON.parse(text, (_k, v) => (typeof v === 'string' ? decodeHtml(v) : v))
    } catch {
      body = undefined
    }
    if (!res.ok) {
      const failure = body as { messages?: unknown; message?: unknown } | undefined
      const snipeItReason = reason(failure?.messages ?? failure?.message)
      throw new Error(`Snipe-IT returned HTTP ${res.status}${snipeItReason ? `: ${snipeItReason}` : ''}`)
    }
    if (body === undefined)
      throw new Error(`${config.baseUrl} did not answer like Snipe-IT. Check the server URL in Settings.`)
    return body as T | SnipeItError
  }

  const isError = (body: unknown): body is SnipeItError => (body as SnipeItError)?.status === 'error'

  // ponytail: pages through a whole list and counts in the app; fine under ~5k rows (~10 requests). Users may be the largest list.
  // Past that, ask Snipe-IT for counts instead (e.g. limit=1 and read `total` per status or filter).
  // The first page gives the total and the page size (a server may cap pages below PAGE_LIMIT); the rest are fetched
  // PAGE_BATCH at a time rather than one after another. Sorted by id so a row added mid-load doesn't shift later pages;
  // `total` is read once, so rows added during the load wait for the next refresh.
  async function allRows<T>(path: string): Promise<T[]> {
    const page = async (offset: number) => {
      const body = await request<{ total: number; rows: T[] }>(`${path}${path.includes('?') ? '&' : '?'}limit=${PAGE_LIMIT}&offset=${offset}&sort=id&order=asc`, undefined, undefined, PAGE_TIMEOUT)
      if (isError(body)) throw new Error(reason(body.messages))
      return body
    }
    const first = await page(0)
    const rows = [...first.rows]
    const offsets: number[] = []
    for (let offset = first.rows.length; first.rows.length && offset < first.total; offset += first.rows.length) offsets.push(offset)
    for (let i = 0; i < offsets.length; i += PAGE_BATCH)
      for (const p of await Promise.all(offsets.slice(i, i + PAGE_BATCH).map(page))) rows.push(...p.rows)
    return rows
  }

  // id arrives from the screen over IPC; check it before it becomes part of a URL.
  const checkId = (id: number, what = 'Asset') => {
    if (!Number.isInteger(id)) throw new Error(`Invalid ${what} id: ${id}`)
  }

  // ponytail: first 20 matches; the Operator types more of the name to narrow it.
  // detail tells namesakes apart: a User's username, an Asset Model's model number.
  async function searchTargets(kind: SearchKind, text: string): Promise<Match[]> {
    const q = text.trim()
    if (!q) return []
    const body = await request<{ rows: { id: number; name: string; username?: string; model_number?: string | null }[] }>(`/${kind}?search=${encodeURIComponent(q)}&limit=20`)
    if (isError(body)) throw new Error(reason(body.messages))
    return body.rows.map((r) => ({ id: r.id, name: r.name, detail: r.username ?? r.model_number ?? '', matched: matchedField(kind, r, q) }))
  }

  // Re-reads the Asset so Checkout/Checkin rules and the default status come from Snipe-IT, not from a possibly stale screen.
  async function current(id: number): Promise<RawAsset> {
    checkId(id)
    const body = await request<RawAsset>(`/hardware/${id}`)
    if (isError(body)) throw new Error(reason(body.messages))
    return body
  }

  return {
    async testConnection(): Promise<{ version: string }> {
      const user = await request<{ id: number }>('/users/me')
      if (isError(user)) throw new Error(reason(user.messages))
      if (!Number.isInteger(user?.id)) throw new Error('Server did not return a valid Snipe-IT user.')
      // Older servers or restricted tokens may not expose version information.
      const version = await request<{ version: string }>('/version').catch(() => null)
      return { version: version && !isError(version) && typeof version.version === 'string' ? version.version : 'Unavailable' }
    },
    async locations(): Promise<StatusLabel[]> {
      return (await allRows<StatusLabel>('/locations')).map(({ id, name }) => ({ id, name }))
    },
    async lookup(query: string): Promise<LookupResult> {
      const tag = query.trim()
      if (!tag) return { exact: false, assets: [], others: [] }
      const body = await request<RawAsset>(`/hardware/bytag/${encodeURIComponent(tag)}`)
      // Snipe-IT answers an unknown Asset Tag with a 404 or a 200-with-error, depending on version.
      if (!isError(body)) return { exact: true, assets: [toAsset(body, today())] }
      // Snipe-IT's search covers an Asset's fields, related names (Asset Model, Assignee, Location…), notes and
      // unencrypted custom fields. The other kinds are searched alongside; one the key can't read says so without hiding the rest.
      const [found, ...others] = await Promise.all([
        request<{ rows: RawAsset[] }>(`/hardware?search=${encodeURIComponent(tag)}&limit=${SEARCH_LIMIT}`),
        ...(['users', 'locations', 'models', 'licenses', 'accessories', 'consumables', 'components'] as const).map((kind) =>
          searchTargets(kind, tag).then((rows): Matches => ({ kind, rows }), (e: Error): Matches => ({ kind, error: e.message }))),
      ])
      if (isError(found)) throw new Error(reason(found.messages))
      return { exact: false, assets: found.rows.map((r) => ({ ...toSummary(toAsset(r, today())), matched: matchedField('assets', r, tag) })), others }
    },

    async getAsset(id: number): Promise<AssetWithHistory> {
      checkId(id)
      // ponytail: one page of 500 History entries; page through if an Asset ever has more.
      // History may need a permission the Operator's key lacks; that must not hide the Asset itself.
      const [body, historyRows] = await Promise.all([
        request<RawAsset>(`/hardware/${id}`),
        request<{ rows: RawActivity[] }>(`/reports/activity?item_type=asset&item_id=${id}&order=desc&limit=500`).then(
          (log) => (isError(log) ? reason(log.messages) : log.rows),
          (e: Error) => e.message,
        ),
      ])
      if (isError(body)) throw new Error(reason(body.messages))
      const asset = toAsset(body, today())
      if (typeof historyRows === 'string') return { ...asset, history: [], historyError: historyRows }
      // Sort here too: newest first is a promise of this interface, not of every Snipe-IT version.
      const rows = [...historyRows].sort((a, b) =>
        (b.created_at?.datetime ?? '').localeCompare(a.created_at?.datetime ?? '') || b.id - a.id)
      return { ...asset, history: rows.map(toHistoryEntry) }
    },

    async statusLabels(): Promise<StatusLabel[]> {
      // ponytail: first 500 status labels; a school has a handful.
      const body = await request<{ rows: StatusLabel[] }>('/statuslabels?limit=500')
      if (isError(body)) throw new Error(reason(body.messages))
      return body.rows.map(({ id, name }) => ({ id, name }))
    },

    // One page of a List. Filters and sort arrive from the screen over IPC, so only known ones reach the URL.
    async list<K extends ListKind>(kind: K, { search, filters = {}, sort, order, offset = 0 }: ListQuery = {}): Promise<ListPage<K>> {
      if (!Object.hasOwn(LISTS, kind)) throw new Error(`Unknown list: ${kind}`)
      if ((search !== undefined && typeof search !== 'string') || typeof filters !== 'object' || filters === null) throw new Error('Invalid search or filters')
      const spec = LISTS[kind]
      const params = new URLSearchParams({ limit: String(LIST_PAGE), offset: String(Number.isSafeInteger(offset) && offset > 0 ? offset : 0) })
      if (search?.trim()) params.set('search', search.trim())
      for (const [key, value] of Object.entries(filters)) {
        if (value === '' || value === undefined) continue
        if (typeof value !== 'string') throw new Error(`Invalid filter: ${key}`)
        const allowed = Object.hasOwn(spec.filters, key) ? spec.filters[key] : undefined
        if (!allowed || !(allowed === 'id' ? /^[1-9]\d*$/.test(value) : allowed.includes(value))) throw new Error(`Invalid filter: ${key}`)
        if (key === 'user_id') params.set('assigned_to', value), params.set('assigned_type', 'App\\Models\\User')
        else params.set(key, value)
      }
      const sorts: Record<string, string> = LIST_SORTS[kind]
      if (sort && Object.hasOwn(sorts, sort)) params.set('sort', sorts[sort]), params.set('order', order === 'asc' ? 'asc' : 'desc')
      const page = await request<{ total: number; rows: unknown[] }>(`${spec.path}?${params}`)
      if (isError(page)) throw new Error(reason(page.messages))
      const now = today()
      return { total: page.total, rows: page.rows.map((r) => spec.row(r as never, now)) as ListRows[K][] }
    },

    // Names for filter dropdowns. ponytail: every row, via allRows; fine at a school's few hundred models.
    async names(kind: 'models' | 'categories' | 'departments'): Promise<StatusLabel[]> {
      const paths = { models: '/models', categories: '/categories?category_type=asset', departments: '/departments' }
      if (!Object.hasOwn(paths, kind)) throw new Error(`Unknown list: ${kind}`)
      return (await allRows<StatusLabel>(paths[kind])).map(({ id, name }) => ({ id, name }))
    },

    // A Quick Action; Snipe-IT decides whether the status fits (e.g. a checked-out Asset needs a deployable one).
    async updateStatus(id: number, statusId: number): Promise<void> {
      checkId(id)
      checkId(statusId, 'status')
      const result = await request(`/hardware/${id}`, { status_id: statusId }, 'PATCH')
      if (isError(result)) throw new Error(reason(result.messages))
    },

    searchUsers: (text: string) => searchTargets('users', text),
    searchLocations: (text: string) => searchTargets('locations', text),

    // Checkout allowed: no Assignee and a deployable status. Snipe-IT requires a status, so the current one is sent.
    async checkout(id: number, { targetType, targetId, expectedCheckin, note }: CheckoutOptions): Promise<void> {
      if (targetType !== 'user' && targetType !== 'location') throw new Error('An Asset can only be checked out to a User or a Location.')
      checkId(targetId, targetType === 'user' ? 'User' : 'Location')
      const body = await current(id)
      if (body.assigned_to) throw new Error(`${body.asset_tag} is already checked out to ${body.assigned_to.name}. Check it in first.`)
      if (body.status_label?.status_meta !== 'deployable')
        throw new Error(`${body.asset_tag} is "${body.status_label?.name ?? 'no status'}", which can't be checked out.`)
      const result = await request(`/hardware/${id}/checkout`, {
        status_id: body.status_label.id,
        checkout_to_type: targetType,
        [`assigned_${targetType}`]: targetId,
        ...(expectedCheckin && { expected_checkin: expectedCheckin }),
        ...(note?.trim() && { note: note.trim() }),
      })
      if (isError(result)) throw new Error(reason(result.messages))
    },

    // Checkin allowed: the Asset has an Assignee. Snipe-IT requires a status, so the current one is kept unless another is chosen.
    async checkin(id: number, { statusId, locationId, note }: CheckinOptions): Promise<void> {
      if (locationId !== undefined) checkId(locationId, 'Location')
      const body = await current(id)
      if (!body.assigned_to) throw new Error(`${body.asset_tag} is not checked out, so there is nothing to check in.`)
      const result = await request(`/hardware/${id}/checkin`, {
        status_id: statusId ?? body.status_label?.id,
        ...(locationId !== undefined && { location_id: locationId }),
        ...(note?.trim() && { note: note.trim() }),
      })
      if (isError(result)) throw new Error(reason(result.messages))
    },

    // Fetches only what the requested pieces need; one piece failing (e.g. a permission error) leaves the others.
    // ponytail: each Asset segment carries its Assets' summaries over IPC (the whole fleet); fine at the same ~5k ceiling.
    async dashboard(requested: DashboardPiece[]): Promise<Dashboard> {
      // The list arrives from the screen over IPC; keep only pieces this module knows.
      const pieces = DASHBOARD_PIECES.filter((p) => Array.isArray(requested) && requested.includes(p))
      const now = today()
      const wants = (...p: DashboardPiece[]) => p.some((x) => pieces.includes(x))
      // Overdue and Warranty expiring come from the Asset list too, so it's fetched once for all three.
      const assets = wants(...ASSET_PIECES) ? allRows<RawAsset>('/hardware').then((rows) => rows.map((r) => toAsset(r, now))) : undefined
      // The plain list leaves Archived Assets out unless Snipe-IT's "show archived in list" is on, so the bar asks for them too.
      // Only the bar: Overdue and Warranty expiring stay as they were. If they can't load, the bar shows without them.
      const archived = wants('assets') ? allRows<RawAsset>('/hardware?status=Archived').then((rows) => rows.map((r) => toAsset(r, now)), () => []) : undefined
      // Without status labels the segments just have no color.
      const colors = wants('assets')
        ? allRows<{ id: number; color: string | null }>('/statuslabels').then((rows) => new Map<number | null, string>(rows.flatMap((l) => (l.color ? [[l.id, l.color]] : []))), () => new Map())
        : undefined
      const entry = async <T>(piece: DashboardPiece, work: () => Promise<T>): Promise<[DashboardPiece, T | Failed] | []> =>
        !pieces.includes(piece) ? [] : [piece, await work().catch((e: Error) => ({ error: e.message }))]
      const entries = await Promise.all([
        entry('assets', async () => {
          const [list, shelved, color] = await Promise.all([assets!, archived!, colors!])
          const listed = new Set(list.map((a) => a.id))
          const segments = new Map<string, AssetSegment>()
          for (const a of [...list, ...shelved.filter((a) => !listed.has(a.id))]) {
            const s = segments.get(a.status)
            if (s) s.count++, s.assets.push(toSummary(a))
            else segments.set(a.status, { status: a.status, statusMeta: a.statusMeta, color: color.get(a.statusId) ?? null, count: 1, assets: [toSummary(a)] })
          }
          return [...segments.values()].sort((a, b) => b.count - a.count)
        }),
        entry('overdue', async () => (await assets!)
          .flatMap((a) => (a.overdueDays === null ? [] : [{ ...toSummary(a), overdueDays: a.overdueDays }]))
          .sort((a, b) => b.overdueDays - a.overdueDays)),
        entry('expiring', async () => (await assets!)
          .flatMap((a) => (a.warranty && !a.warranty.expired ? [{ ...toSummary(a), daysLeft: a.warranty.daysLeft }] : []))
          .sort((a, b) => a.daysLeft - b.daysLeft)),
        ...Object.entries(QUANTITIES).map(([piece, [path, whole, free]]) =>
          entry(piece as DashboardPiece, async () => (await allRows<Record<string, number | null>>(path)).reduce<Split>((sum, r) => {
            // An older Snipe-IT may not send a field; say so rather than show a wrong number.
            // A quantity of 0 arrives as null (Accessories, Components), so null counts as 0.
            const [all, left] = [whole, free].map((field) => {
              if (r[field] !== null && typeof r[field] !== 'number') throw new Error(`Snipe-IT didn't send "${field}" for ${path.slice(1)}; it may be too old for this chart.`)
              return r[field] ?? 0
            })
            return { used: sum.used + all - left, available: sum.available + left }
          }, { used: 0, available: 0 }))),
        // Holding: at least one Asset, License seat or Accessory checked out. Consumables never come back, so they don't count.
        entry('users', async () => {
          const users = await allRows<{ assets_count: number; licenses_count: number; accessories_count: number }>('/users')
          const used = users.filter((u) => u.assets_count + u.licenses_count + u.accessories_count > 0).length
          return { used, available: users.length - used }
        }),
      ])
      return Object.fromEntries(entries.filter((e) => e.length))
    },
  }
}
