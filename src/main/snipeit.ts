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

/** Lookup's matches of one other kind, or why that kind couldn't be searched (e.g. the key can't read Users). */
export type Matches = { kind: 'users' | 'locations' | 'models'; rows: CheckoutTarget[] } | { kind: 'users' | 'locations' | 'models'; error: string }

/** An exact Asset Tag hit carries the full Asset; a text search carries Asset summaries and the other kinds' matches. */
export type LookupResult = { exact: true; assets: [Asset] } | { exact: false; assets: AssetSummary[]; others: Matches[] }

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

// Snipe-IT action_type and item_type values the Activity Report can be filtered by.
export const ACTIVITY_ACTIONS = ['checkout', 'checkin from', 'update', 'create', 'delete', 'audit'] as const
export const ACTIVITY_ITEMS = ['asset', 'accessory', 'license', 'consumable', 'component'] as const

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
    path: '/reports/activity', filters: { action_type: ACTIVITY_ACTIONS, item_type: ACTIVITY_ITEMS },
    row: (r: RawActivity) => ({ id: r.id, ...toHistoryEntry(r), item: r.item ? { type: r.item.type, id: r.item.id, name: r.item.name } : null }),
  },
}

// `today` is injectable so the date rules can be tested with a fixed date.
export function createSnipeIt(config: Config, fetch: typeof globalThis.fetch, today = () => new Date()) {
  const api = `${config.baseUrl.replace(/\/+$/, '')}/api/v1`

  // Resolves to the JSON body, or { status: 'error', messages } when Snipe-IT reports an error or 404.
  // Pass `post` to send it as JSON with `method` (POST unless told otherwise) instead of GETting.
  // Every other failure throws an Error whose message the Operator can act on. All SnipeIt functions go through here.
  async function request<T>(path: string, post?: object, method = 'POST'): Promise<T | SnipeItError> {
    let res: Response
    try {
      res = await fetch(api + path, {
        signal: AbortSignal.timeout(15000),
        redirect: 'error',
        headers: { Authorization: `Bearer ${config.apiKey}`, Accept: 'application/json', ...(post && { 'Content-Type': 'application/json' }) },
        ...(post && { method, body: JSON.stringify(post) }),
      })
    } catch {
      throw new Error(`Can't reach Snipe-IT at ${config.baseUrl}. Check your network connection and server URL in Settings.`)
    }
    if (res.status === 401)
      throw new Error('Snipe-IT rejected your API key. Check the API token in Settings, or generate a new personal API key in Snipe-IT.')
    if (res.status === 404) return { status: 'error', messages: 'Not found' }
    let body: unknown
    try {
      body = JSON.parse(await res.text(), (_k, v) => (typeof v === 'string' ? decodeHtml(v) : v))
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
  // Until `total` rows are in (a server may cap pages below PAGE_LIMIT); an empty page ends it early.
  // Sorted by id so a row added mid-load doesn't shift later pages.
  async function allRows<T>(path: string): Promise<T[]> {
    const rows: T[] = []
    for (let total = Infinity; rows.length < total; ) {
      const page = await request<{ total: number; rows: T[] }>(`${path}${path.includes('?') ? '&' : '?'}limit=${PAGE_LIMIT}&offset=${rows.length}&sort=id&order=asc`)
      if (isError(page)) throw new Error(reason(page.messages))
      if (!page.rows.length) break
      total = page.total
      rows.push(...page.rows)
    }
    return rows
  }

  // id arrives from the screen over IPC; check it before it becomes part of a URL.
  const checkId = (id: number, what = 'Asset') => {
    if (!Number.isInteger(id)) throw new Error(`Invalid ${what} id: ${id}`)
  }

  // ponytail: first 20 matches; the Operator types more of the name to narrow it.
  // detail tells namesakes apart: a User's username, an Asset Model's model number.
  async function searchTargets(kind: 'users' | 'locations' | 'models', text: string): Promise<CheckoutTarget[]> {
    const q = text.trim()
    if (!q) return []
    const body = await request<{ rows: { id: number; name: string; username?: string; model_number?: string | null }[] }>(`/${kind}?search=${encodeURIComponent(q)}&limit=20`)
    if (isError(body)) throw new Error(reason(body.messages))
    return body.rows.map((r) => ({ id: r.id, name: r.name, detail: r.username ?? r.model_number ?? '' }))
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
      const rows: StatusLabel[] = []
      for (let total = Infinity; rows.length < total;) {
        const page = await request<{ total: number; rows: StatusLabel[] }>(`/locations?limit=${PAGE_LIMIT}&offset=${rows.length}&sort=id&order=asc`)
        if (isError(page)) throw new Error(reason(page.messages))
        if (!page.rows.length) break
        total = page.total
        rows.push(...page.rows.map(({ id, name }) => ({ id, name })))
      }
      return rows
    },
    async lookup(query: string): Promise<LookupResult> {
      const tag = query.trim()
      if (!tag) return { exact: false, assets: [], others: [] }
      const body = await request<RawAsset>(`/hardware/bytag/${encodeURIComponent(tag)}`)
      // Snipe-IT answers an unknown Asset Tag with a 404 or a 200-with-error, depending on version.
      if (!isError(body)) return { exact: true, assets: [toAsset(body, today())] }
      // Snipe-IT's search covers name, Asset Tag, and Serial (and more). The other kinds are searched alongside;
      // one the key can't read says so without hiding the rest.
      const [found, ...others] = await Promise.all([
        request<{ rows: RawAsset[] }>(`/hardware?search=${encodeURIComponent(tag)}&limit=${SEARCH_LIMIT}`),
        ...(['users', 'locations', 'models'] as const).map((kind) =>
          searchTargets(kind, tag).then((rows): Matches => ({ kind, rows }), (e: Error): Matches => ({ kind, error: e.message }))),
      ])
      if (isError(found)) throw new Error(reason(found.messages))
      return { exact: false, assets: found.rows.map((r) => toSummary(toAsset(r, today()))), others }
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
      const spec = LISTS[kind]
      const params = new URLSearchParams({ limit: String(LIST_PAGE), offset: String(Number.isSafeInteger(offset) && offset > 0 ? offset : 0) })
      if (search?.trim()) params.set('search', search.trim())
      for (const [key, value] of Object.entries(filters)) {
        if (value === '') continue
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
      const assets = wants('assets', 'overdue', 'expiring') ? allRows<RawAsset>('/hardware').then((rows) => rows.map((r) => toAsset(r, now))) : undefined
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
