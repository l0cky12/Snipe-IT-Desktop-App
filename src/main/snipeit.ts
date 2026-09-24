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

export type CheckinOptions = { statusId?: number; note?: string }

/** A User or Location to check an Asset out to. detail tells namesakes apart (a User's username). */
export type CheckoutTarget = { id: number; name: string; detail: string }

/** Checkout targets are Users and Locations only; Asset-to-Asset isn't supported. expectedCheckin is "YYYY-MM-DD". */
export type CheckoutOptions = { targetType: 'user' | 'location'; targetId: number; expectedCheckin?: string; note?: string }

/** What the rail shows for a match or a recent scan. */
export type AssetSummary = Pick<Asset, 'id' | 'assetTag' | 'name' | 'status' | 'statusMeta' | 'assignee'>

/** An exact Asset Tag hit carries the full Asset; a text search carries summaries. */
export type LookupResult = { exact: true; assets: [Asset] } | { exact: false; assets: AssetSummary[] }

/** Overdue Assets most late first, Expiring Warranties soonest first (expired ones left out), and Asset counts by status, most first. */
export type Dashboard = {
  overdue: (AssetSummary & { overdueDays: number })[]
  expiring: (AssetSummary & { daysLeft: number })[]
  counts: { status: string; statusMeta: string; count: number }[]
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
  action_type: string
  created_at: { datetime: string } | null
  // Snipe-IT v8 renamed `admin` to `created_by`.
  created_by?: Named
  admin?: Named
  target: Named
  note: string | null
}

const EXPIRING_DAYS = 90
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

// `today` is injectable so the date rules can be tested with a fixed date.
export function createSnipeIt(config: Config, fetch: typeof globalThis.fetch, today = () => new Date()) {
  const api = `${config.baseUrl.replace(/\/+$/, '')}/api/v1`

  // Resolves to the JSON body, or { status: 'error', messages } when Snipe-IT reports an error or 404.
  // Pass `post` to POST it as JSON instead of GETting.
  // Every other failure throws an Error whose message the Operator can act on. All SnipeIt functions go through here.
  async function request<T>(path: string, post?: object): Promise<T | SnipeItError> {
    let res: Response
    try {
      res = await fetch(api + path, {
        headers: { Authorization: `Bearer ${config.apiKey}`, Accept: 'application/json', ...(post && { 'Content-Type': 'application/json' }) },
        ...(post && { method: 'POST', body: JSON.stringify(post) }),
      })
    } catch {
      throw new Error(`Can't reach Snipe-IT at ${config.baseUrl}. Check your network connection and the "baseUrl" in config.json.`)
    }
    if (res.status === 401)
      throw new Error('Snipe-IT rejected your API key. Check the "apiKey" in config.json, or generate a new personal API key in Snipe-IT.')
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
      throw new Error(`${config.baseUrl} did not answer like Snipe-IT. Check the "baseUrl" in config.json.`)
    return body as T | SnipeItError
  }

  const isError = (body: unknown): body is SnipeItError => (body as SnipeItError)?.status === 'error'

  // id arrives from the screen over IPC; check it before it becomes part of a URL.
  const checkId = (id: number, what = 'Asset') => {
    if (!Number.isInteger(id)) throw new Error(`Invalid ${what} id: ${id}`)
  }

  // ponytail: first 20 matches; the Operator types more of the name to narrow it.
  async function searchTargets(kind: 'users' | 'locations', text: string): Promise<CheckoutTarget[]> {
    const q = text.trim()
    if (!q) return []
    const body = await request<{ rows: { id: number; name: string; username?: string }[] }>(`/${kind}?search=${encodeURIComponent(q)}&limit=20`)
    if (isError(body)) throw new Error(reason(body.messages))
    return body.rows.map((r) => ({ id: r.id, name: r.name, detail: r.username ?? '' }))
  }

  // Re-reads the Asset so Checkout/Checkin rules and the default status come from Snipe-IT, not from a possibly stale screen.
  async function current(id: number): Promise<RawAsset> {
    checkId(id)
    const body = await request<RawAsset>(`/hardware/${id}`)
    if (isError(body)) throw new Error(reason(body.messages))
    return body
  }

  return {
    async lookup(query: string): Promise<LookupResult> {
      const tag = query.trim()
      if (!tag) return { exact: false, assets: [] }
      const body = await request<RawAsset>(`/hardware/bytag/${encodeURIComponent(tag)}`)
      // Snipe-IT answers an unknown Asset Tag with a 404 or a 200-with-error, depending on version.
      if (!isError(body)) return { exact: true, assets: [toAsset(body, today())] }
      // Snipe-IT's search covers name, Asset Tag, and Serial (and more).
      const found = await request<{ rows: RawAsset[] }>(`/hardware?search=${encodeURIComponent(tag)}&limit=${SEARCH_LIMIT}`)
      if (isError(found)) throw new Error(reason(found.messages))
      return { exact: false, assets: found.rows.map((r) => toSummary(toAsset(r, today()))) }
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
    async checkin(id: number, { statusId, note }: CheckinOptions): Promise<void> {
      const body = await current(id)
      if (!body.assigned_to) throw new Error(`${body.asset_tag} is not checked out, so there is nothing to check in.`)
      const result = await request(`/hardware/${id}/checkin`, {
        status_id: statusId ?? body.status_label?.id,
        ...(note?.trim() && { note: note.trim() }),
      })
      if (isError(result)) throw new Error(reason(result.messages))
    },

    // ponytail: pages through every Asset and computes in the app; fine for a fleet under ~5k Assets (~10 requests).
    async dashboard(): Promise<Dashboard> {
      const now = today()
      const assets: Asset[] = []
      // Until `total` Assets are in (a server may cap pages below PAGE_LIMIT); an empty page ends it early.
      // Sorted by id so an Asset added mid-load doesn't shift later pages.
      for (let total = Infinity; assets.length < total; ) {
        const page = await request<{ total: number; rows: RawAsset[] }>(`/hardware?limit=${PAGE_LIMIT}&offset=${assets.length}&sort=id&order=asc`)
        if (isError(page)) throw new Error(reason(page.messages))
        if (!page.rows.length) break
        total = page.total
        assets.push(...page.rows.map((r) => toAsset(r, now)))
      }
      const counts = new Map<string, Dashboard['counts'][number]>()
      for (const a of assets) {
        const c = counts.get(a.status)
        if (c) c.count++
        else counts.set(a.status, { status: a.status, statusMeta: a.statusMeta, count: 1 })
      }
      return {
        overdue: assets.flatMap((a) => (a.overdueDays === null ? [] : [{ ...toSummary(a), overdueDays: a.overdueDays }]))
          .sort((a, b) => b.overdueDays - a.overdueDays),
        expiring: assets.flatMap((a) => (a.warranty && !a.warranty.expired ? [{ ...toSummary(a), daysLeft: a.warranty.daysLeft }] : []))
          .sort((a, b) => a.daysLeft - b.daysLeft),
        counts: [...counts.values()].sort((a, b) => b.count - a.count),
      }
    },
  }
}
