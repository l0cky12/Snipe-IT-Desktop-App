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

/** historyError is set when History couldn't be loaded (e.g. the key lacks permission); the Asset still shows. fields: every field Snipe-IT sent. */
export type AssetWithHistory = Asset & { history: HistoryEntry[]; historyError?: string; fields: Field[] }

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
/** An Asset found by a text search, with the field it matched (as on Match). */
export type AssetMatch = AssetSummary & { matched: string }
/** Everything Lookup searches. */
type Searchable = SearchKind | 'assets'
/** Lookup's matches of one other kind, or why that kind couldn't be searched (e.g. the key can't read Users). */
export type Matches = { kind: SearchKind; rows: Match[] } | { kind: SearchKind; error: string }

/** An exact Asset Tag hit carries the full Asset; a text search carries Asset summaries and the other kinds' matches. */
export type LookupResult = { exact: true; assets: [Asset] } | { exact: false; assets: AssetMatch[]; others: Matches[] }

export type UserRow = { id: number; name: string; username: string; email: string; department: string; location: string; assets: number }
export type LocationRow = { id: number; name: string; parent: string; city: string; assets: number; checkedOut: number; users: number }
/** available is null when Snipe-IT doesn't say. */
export type ModelRow = { id: number; name: string; modelNumber: string; manufacturer: string; category: string; assets: number; available: number | null }
/** One Activity Report entry; item is what was acted on (an Asset, a License…). */
export type ActivityRow = HistoryEntry & { id: number; item: { type: string; id: number; name: string } | null }
export type LicenseRow = { id: number; name: string; manufacturer: string; category: string; seats: number; free: number; expires: string }
/** Accessories, Consumables and Components: stocked by quantity. */
export type StockRow = { id: number; name: string; category: string; manufacturer: string; location: string; qty: number; remaining: number }
export type CategoryRow = { id: number; name: string; type: string; items: number }
export type ManufacturerRow = { id: number; name: string; assets: number }
export type SupplierRow = { id: number; name: string; contact: string; phone: string; email: string; assets: number }
export type DepartmentRow = { id: number; name: string; company: string; manager: string; location: string; users: number }
export type CompanyRow = { id: number; name: string; assets: number; users: number }
export type StatusLabelRow = { id: number; name: string; type: string; assets: number }
export type ListRows = {
  assets: Asset; users: UserRow; locations: LocationRow; models: ModelRow; activity: ActivityRow
  licenses: LicenseRow; accessories: StockRow; consumables: StockRow; components: StockRow
  categories: CategoryRow; manufacturers: ManufacturerRow; suppliers: SupplierRow; departments: DepartmentRow; companies: CompanyRow; statuslabels: StatusLabelRow
}
export type ListKind = keyof ListRows
/** The kinds with one record per row, which open to show all their fields. */
export type RecordKind = Exclude<ListKind, 'activity'>
/** One field of a record as the Operator reads it; link is the related record it names, when the app can open it. */
export type Field = { label: string; value: string; link?: { kind: RecordKind; id: number } }
/** categoryType: what a Category holds (asset, license, accessory, consumable, component), so it links to the right List. */
export type RecordDetail = { kind: RecordKind; id: number; name: string; fields: Field[]; categoryType?: string }
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

/** The Reports: the Activity Report over a date range, and the Overdue and Warranty expiring lists in full. */
export const REPORTS = ['activity', 'overdue', 'expiring'] as const
export type ReportKind = (typeof REPORTS)[number]
/** Kinds of thing the Activity Report can be narrowed to (Snipe-IT's item types). */
export const ACTIVITY_ITEM_TYPES = ['asset', 'license', 'accessory', 'consumable', 'component', 'user'] as const
/** Glossary name for each Record type, for the Activity Report's filter and column. */
export const itemTypeName: Record<(typeof ACTIVITY_ITEM_TYPES)[number], string> = { asset: 'Assets', license: 'Licenses', accessory: 'Accessories', consumable: 'Consumables', component: 'Components', user: 'Users' }
/** from/to are "YYYY-MM-DD", both included; what they bound depends on the report (when it happened, Expected Checkin, warranty end). */
export type ReportQuery = { from?: string; to?: string; itemType?: string; actionType?: string }
/** A report as a table of text, ready to show or export. capped: more rows matched than a report holds. */
export type Report = { columns: string[]; rows: string[][]; capped: boolean }

/** The kinds the app can create, edit and delete. */
export const EDIT_KINDS = ['assets', 'users', 'locations', 'licenses', 'accessories', 'consumables', 'components'] as const
export type EditKind = (typeof EDIT_KINDS)[number]
/** Where a choice's options come from (see names()). */
export type NamesKind = 'models' | 'categories' | 'departments' | 'statuslabels' | 'locations' | 'suppliers' | 'companies' | 'manufacturers'
  | 'categories:license' | 'categories:accessory' | 'categories:consumable' | 'categories:component'
/**
 * One input of a record's form. key is Snipe-IT's field name (a custom field's is its db column, _snipeit_…).
 * A choice's options come from `choices` (a List's names) or `options` (a custom field's fixed values); 'choices' is a
 * custom checkbox field, any of its options, kept as Snipe-IT keeps them ("A, B"). from: where an
 * edited record keeps the value, when not under key (an id sits in its object: model_id in model.id). newOnly: creating only.
 */
export type FormField = {
  key: string; label: string; type: 'text' | 'textarea' | 'number' | 'date' | 'email' | 'password' | 'choice' | 'choices'
  required?: boolean; choices?: NamesKind; options?: string[]; from?: string; newOnly?: boolean
}
/** A record's form and its current values ('' for none); a new record's values are all ''. */
export type RecordForm = { fields: FormField[]; values: Record<string, string> }
/** Saved (with the record's id), or Snipe-IT's reasons: per field where it gave them, and a line for the rest. */
export type SaveResult = { ok: true; id: number } | { ok: false; message: string; errors: Record<string, string> }

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
// ponytail: a report holds this many rows at most (it says so when it's cut short); a school year of activity is far below it.
const REPORT_MAX = 10000

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
const MATCH_FIELDS: Record<Searchable, [label: string, field: string][]> = {
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

function matchedField(kind: Searchable, raw: Record<string, unknown>, text: string): string {
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
  // Last, the other text Snipe-IT sent (inside its objects too, not their ids): it may have matched on a field the list doesn't name.
  // Ids, dates, counts, quantities and the like are skipped: Snipe-IT doesn't search them, so a hit there would be noise ('Found in Qty').
  const noise = /^(id|custom_fields|image|available_actions|.*_at|.*_date|.*_count(er)?|.*qty|remaining|min_amt)$/
  const rest = Object.entries(raw).filter(([k]) => !noise.test(k)).flatMap(([k, v]): [string, unknown][] =>
    v && typeof v === 'object' ? Object.values(v).filter((x) => typeof x === 'string').map((x): [string, unknown] => [label(k), x]) : typeof v === 'string' ? [[label(k), v]] : [])
  return [...named.map(([l, field]): [string, unknown] => [l, raw[field]]), ...custom, ...rest].find(([, v]) => holds(v))?.[0] ?? ''
}

// ponytail: matches Snipe-IT's English action_type values; other actions show as-is, capitalized.
const actions: Record<string, { label: string; prep: string }> = {
  checkout: { label: 'Checkout', prep: 'to ' },
  'checkin from': { label: 'Checkin', prep: 'from ' },
}
/** Glossary label for a Snipe-IT action_type. */
export const actionLabel = (a: string) => actions[a]?.label ?? a.charAt(0).toUpperCase() + a.slice(1)

// Snipe-IT renders notes from Markdown into inline HTML; show the plain text.
const plainText = (s: string) => s.replace(/<[^>]*>/g, '')

function toHistoryEntry(raw: RawActivity): HistoryEntry {
  const known = actions[raw.action_type]
  const target = raw.target?.name
  return {
    when: raw.created_at?.datetime.slice(0, 16) ?? '',
    action: actionLabel(raw.action_type),
    operator: (raw.created_by ?? raw.admin)?.name ?? '',
    detail: target ? (known?.prep ?? '') + target : '',
    note: raw.note ? plainText(raw.note) : '',
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

// A row of a kind the app reads only a few fields of.
type RawRow = { id: number; name: string; [field: string]: unknown }
const nameOf = (v: unknown) => (v && typeof v === 'object' && typeof (v as Named)?.name === 'string' ? (v as { name: string }).name : '')
const text = (v: unknown) => (typeof v === 'string' ? v : '')
// Snipe-IT sends a quantity of 0 as null for some kinds.
const count = (v: unknown) => (typeof v === 'number' ? v : Number(v) || 0)
const stockRow = (r: RawRow, remaining: unknown): StockRow =>
  ({ id: r.id, name: r.name, category: nameOf(r.category), manufacturer: nameOf(r.manufacturer), location: nameOf(r.location), qty: count(r.qty), remaining: count(remaining) })
// Which kind of record a related field names, so its detail can link to it.
const RELATED_KINDS: Record<string, RecordKind> = {
  location: 'locations', rtd_location: 'locations', parent: 'locations', children: 'locations', department: 'departments', company: 'companies', manufacturer: 'manufacturers',
  category: 'categories', supplier: 'suppliers', model: 'models', status_label: 'statuslabels', manager: 'users',
}
// Snipe-IT's field names in the app's words, where they differ (see CONTEXT.md); others read as Snipe-IT names them.
const FIELD_LABELS: Record<string, string> = {
  asset_tag: 'Asset Tag', model: 'Asset Model', model_number: 'Model No.', status_label: 'Status', assigned_to: 'Assignee', rtd_location: 'Default Location',
  expected_checkin: 'Expected Checkin', last_checkin: 'Last Checkin', last_checkout: 'Last Checkout', assets_count: 'Assets', users_count: 'Users',
}
// Shown elsewhere (id, custom fields), not readable (images, the permissions map), or not about the record (what the key may do).
const HIDDEN_FIELDS = new Set(['id', 'name', 'custom_fields', 'available_actions', 'user_can_checkout', 'image', 'avatar', 'permissions'])

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
  licenses: { name: 'name', manufacturer: 'manufacturer', seats: 'seats', expires: 'expiration_date' },
  accessories: { name: 'name', category: 'category', manufacturer: 'manufacturer', location: 'location', qty: 'qty' },
  consumables: { name: 'name', category: 'category', manufacturer: 'manufacturer', location: 'location', qty: 'qty' },
  components: { name: 'name', category: 'category', location: 'location', qty: 'qty' },
  categories: { name: 'name', type: 'category_type' },
  manufacturers: { name: 'name', assets: 'assets_count' },
  suppliers: { name: 'name', assets: 'assets_count' },
  departments: { name: 'name', users: 'users_count' },
  companies: { name: 'name', assets: 'assets_count', users: 'users_count' },
  statuslabels: { name: 'name', type: 'type', assets: 'assets_count' },
} satisfies { [K in ListKind]: Partial<Record<keyof ListRows[K], string>> }

// Snipe-IT action_type values the Activity Report can be filtered by.
// Not item_type: Snipe-IT only applies it together with one item_id.
export const ACTIVITY_ACTIONS = ['checkout', 'checkin from', 'update', 'create', 'delete', 'audit'] as const
const ACTIVITY_COLUMNS = ['When', 'Action', 'Operator', 'Record type', 'Item', 'Detail', 'Note']

// Each List's Snipe-IT path, the filters it accepts ('id' = a positive whole number), and its row shape.
// user_id isn't Snipe-IT's; it stands for "checked out to this User" (assigned_to + assigned_type).
const LISTS: { [K in ListKind]: { path: string; filters: Record<string, 'id' | readonly string[]>; row: (raw: never, today: Date) => ListRows[K] } } = {
  assets: { path: '/hardware', filters: { status_id: 'id', location_id: 'id', model_id: 'id', category_id: 'id', user_id: 'id', manufacturer_id: 'id', supplier_id: 'id', company_id: 'id', status: ['Deployed', 'RTD'] }, row: toAsset },
  users: {
    path: '/users', filters: { location_id: 'id', department_id: 'id', company_id: 'id' },
    row: (r: RawUser) => ({ id: r.id, name: r.name, username: r.username ?? '', email: r.email ?? '', department: nameOf(r.department), location: nameOf(r.location), assets: r.assets_count ?? 0 }),
  },
  locations: {
    path: '/locations', filters: {},
    row: (r: RawLocation) => ({ id: r.id, name: r.name, parent: nameOf(r.parent), city: r.city ?? '', assets: r.assets_count ?? 0, checkedOut: r.assigned_assets_count ?? 0, users: r.users_count ?? 0 }),
  },
  models: {
    path: '/models', filters: { category_id: 'id' },
    row: (r: RawModel) => ({ id: r.id, name: r.name, modelNumber: r.model_number ?? '', manufacturer: nameOf(r.manufacturer), category: nameOf(r.category), assets: r.assets_count ?? 0, available: typeof r.remaining === 'number' ? r.remaining : null }),
  },
  activity: {
    path: '/reports/activity', filters: { action_type: ACTIVITY_ACTIONS },
    row: (r: RawActivity) => ({ id: r.id, ...toHistoryEntry(r), item: r.item ? { type: r.item.type, id: r.item.id, name: r.item.name } : null }),
  },
  licenses: {
    path: '/licenses', filters: { category_id: 'id' },
    row: (r: RawRow) => ({ id: r.id, name: r.name, manufacturer: nameOf(r.manufacturer), category: nameOf(r.category), seats: count(r.seats), free: count(r.free_seats_count), expires: (r.expiration_date as { date?: string } | null)?.date ?? '' }),
  },
  accessories: { path: '/accessories', filters: { category_id: 'id' }, row: (r: RawRow) => stockRow(r, r.remaining_qty ?? r.remaining) },
  consumables: { path: '/consumables', filters: { category_id: 'id' }, row: (r: RawRow) => stockRow(r, r.remaining) },
  components: { path: '/components', filters: { category_id: 'id' }, row: (r: RawRow) => stockRow(r, r.remaining) },
  // Older Snipe-ITs send no item_count, only a count per kind (assets_count, accessories_count…); the Category's type says which one is its.
  categories: { path: '/categories', filters: {}, row: (r: RawRow) => ({ id: r.id, name: r.name, type: text(r.category_type), items: count(r.item_count ?? r[`${text(r.category_type).replace(/y$/, 'ie')}s_count`]) }) },
  manufacturers: { path: '/manufacturers', filters: {}, row: (r: RawRow) => ({ id: r.id, name: r.name, assets: count(r.assets_count) }) },
  suppliers: {
    path: '/suppliers', filters: {},
    row: (r: RawRow) => ({ id: r.id, name: r.name, contact: text(r.contact), phone: text(r.phone), email: text(r.email), assets: count(r.assets_count) }),
  },
  departments: {
    path: '/departments', filters: {},
    row: (r: RawRow) => ({ id: r.id, name: r.name, company: nameOf(r.company), manager: nameOf(r.manager), location: nameOf(r.location), users: count(r.users_count) }),
  },
  companies: { path: '/companies', filters: {}, row: (r: RawRow) => ({ id: r.id, name: r.name, assets: count(r.assets_count), users: count(r.users_count) }) },
  statuslabels: { path: '/statuslabels', filters: {}, row: (r: RawRow) => ({ id: r.id, name: r.name, type: text(r.type), assets: count(r.assets_count) }) },
}

const txt = (key: string, label: string, extra: Partial<FormField> = {}): FormField => ({ key, label, type: 'text', ...extra })
const pick = (key: string, label: string, choices: NamesKind, extra: Partial<FormField> = {}): FormField => ({ key, label, type: 'choice', choices, ...extra })
// minFrom: where Snipe-IT sends the minimum back (an Accessory's as min_qty, though it's saved as min_amt).
const stockForm = (category: NamesKind, own: FormField[], minFrom?: string): FormField[] => [
  txt('name', 'Name', { required: true }), { key: 'qty', label: 'Quantity', type: 'number', required: true }, pick('category_id', 'Category', category, { required: true }),
  ...own, pick('manufacturer_id', 'Manufacturer', 'manufacturers'), pick('location_id', 'Location', 'locations'), { key: 'min_amt', label: 'Minimum quantity', type: 'number', ...(minFrom && { from: minFrom }) },
  txt('order_number', 'Order number'), { key: 'purchase_date', label: 'Purchase date', type: 'date' }, { key: 'notes', label: 'Notes', type: 'textarea' },
]
// What each kind's form asks for, in Snipe-IT's field names; required as Snipe-IT requires. An Asset's custom fields come from its Asset Model.
export const FORMS: Record<EditKind, FormField[]> = {
  assets: [
    txt('asset_tag', 'Asset Tag', { required: true }), pick('model_id', 'Asset Model', 'models', { required: true }), pick('status_id', 'Status', 'statuslabels', { required: true, from: 'status_label' }),
    txt('name', 'Name'), txt('serial', 'Serial'), pick('rtd_location_id', 'Default Location', 'locations', { from: 'rtd_location' }), pick('supplier_id', 'Supplier', 'suppliers'),
    pick('company_id', 'Company', 'companies'), txt('order_number', 'Order number'), { key: 'purchase_date', label: 'Purchase date', type: 'date' },
    { key: 'purchase_cost', label: 'Purchase cost', type: 'number' }, { key: 'warranty_months', label: 'Warranty (months)', type: 'number' }, { key: 'notes', label: 'Notes', type: 'textarea' },
  ],
  users: [
    txt('first_name', 'First name', { required: true }), txt('last_name', 'Last name'), txt('username', 'Username', { required: true }),
    { key: 'password', label: 'Password', type: 'password', required: true, newOnly: true }, { key: 'password_confirmation', label: 'Password again', type: 'password', required: true, newOnly: true },
    { key: 'email', label: 'Email', type: 'email' }, txt('employee_num', 'Employee No.'), txt('jobtitle', 'Job title'), txt('phone', 'Phone'),
    pick('department_id', 'Department', 'departments'), pick('location_id', 'Location', 'locations'), pick('company_id', 'Company', 'companies'), { key: 'notes', label: 'Notes', type: 'textarea' },
  ],
  locations: [
    txt('name', 'Name', { required: true }), pick('parent_id', 'Parent', 'locations', { from: 'parent' }), txt('address', 'Address'), txt('address2', 'Address line 2'),
    txt('city', 'City'), txt('state', 'State'), txt('zip', 'Zip'), txt('country', 'Country'),
  ],
  licenses: [
    txt('name', 'Name', { required: true }), { key: 'seats', label: 'Seats', type: 'number', required: true }, pick('category_id', 'Category', 'categories:license', { required: true }),
    txt('serial', 'Product key', { from: 'product_key' }), txt('license_name', 'Licensed to'), { key: 'license_email', label: 'Licensed to email', type: 'email' },
    pick('manufacturer_id', 'Manufacturer', 'manufacturers'), { key: 'expiration_date', label: 'Expires', type: 'date' }, txt('order_number', 'Order number'),
    { key: 'purchase_date', label: 'Purchase date', type: 'date' }, { key: 'notes', label: 'Notes', type: 'textarea' },
  ],
  accessories: stockForm('categories:accessory', [txt('model_number', 'Model No.')], 'min_qty'),
  consumables: stockForm('categories:consumable', [txt('item_no', 'Item No.'), txt('model_number', 'Model No.')]),
  components: stockForm('categories:component', [txt('serial', 'Serial')]),
}

// Snipe-IT keeps notes as Markdown but sends them rendered to inline HTML; this turns what it renders back into
// Markdown, so editing a note keeps its links and emphasis. ponytail: the inline subset Snipe-IT renders, not all of HTML.
export const markdownOf = (html: string) => html
  .replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>\s*<p>/gi, '\n\n')
  .replace(/<a [^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, '[$2]($1)')
  .replace(/<(strong|b)>(.*?)<\/\1>/gi, '**$2**').replace(/<(em|i)>(.*?)<\/\1>/gi, '*$2*').replace(/<code>(.*?)<\/code>/gi, '`$1`')
  .replace(/<[^>]*>/g, '')

// A form value from a record as Snipe-IT sends it: an id from its object, a date's day, a number or text as it is.
function formValue(raw: RawRow, f: FormField): string {
  const v = raw[f.from ?? (f.type === 'choice' ? f.key.replace(/_id$/, '') : f.key)]
  if (v === null || v === undefined) return ''
  if (typeof v === 'object') return String((v as { id?: unknown; date?: unknown }).id ?? (v as { date?: unknown }).date ?? '')
  // Snipe-IT formats costs with thousands separators ("1,200.50") and a warranty as "36 months"; only the number is kept.
  // Only a note is Markdown Snipe-IT rendered; a Name or Serial is kept as it is (request() already decoded its entities).
  if (f.type === 'number') return String(v).replace(/[^\d.-]/g, '')
  return f.type === 'textarea' ? markdownOf(String(v)) : String(v)
}

// Every field of a record as the Operator reads it, in Snipe-IT's order, then an Asset's custom fields.
// A related record (a Location, a Manager…) links to it; dates show as Snipe-IT formats them; Markdown notes as plain text.
function fieldsOf(raw: RawRow): Field[] {
  const fields: Field[] = []
  for (const [key, v] of Object.entries(raw)) {
    if (HIDDEN_FIELDS.has(key) || v === null || v === '') continue
    const label = FIELD_LABELS[key] ?? key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, ' ')
    const field = (x: unknown): Field | null => {
      if (typeof x !== 'object' || x === null) return x === null || x === '' ? null : { label, value: typeof x === 'boolean' ? (x ? 'Yes' : 'No') : plainText(String(x)) }
      const o = x as { id?: unknown; name?: unknown; formatted?: unknown; date?: unknown; datetime?: unknown; type?: unknown }
      // A date: as Snipe-IT formats it, or as sent.
      const when = [o.formatted, o.date, o.datetime].find((d) => typeof d === 'string')
      if (when) return { label, value: when as string }
      // Something else structured (an amount and its currency…): its plain values, so no field goes missing.
      if (typeof o.name !== 'string') {
        const plain = Object.entries(o).filter(([, p]) => p !== null && p !== '' && typeof p !== 'object').map(([k, p]) => `${k}: ${p}`)
        return plain.length ? { label, value: plain.join(', ') } : null
      }
      // An Asset's Assignee says what kind it is.
      const kind = key === 'assigned_to' ? ({ user: 'users', location: 'locations', asset: 'assets' } as const)[o.type as Assignee['type']] : RELATED_KINDS[key]
      return { label, value: o.name, ...(kind && typeof o.id === 'number' && { link: { kind, id: o.id } }) }
    }
    // A list of records (a Location's children, a User's groups { total, rows }…) gives each its own field; a list of plain values reads as one.
    const list = Array.isArray(v) ? v : Array.isArray((v as { rows?: unknown }).rows) ? (v as { rows: unknown[] }).rows : null
    if (list) {
      if (list.every((x) => typeof x !== 'object')) fields.push(...(list.length ? [{ label, value: list.join(', ') }] : []))
      else fields.push(...list.map(field).filter((f): f is Field => f !== null))
    } else {
      const f = field(v)
      if (f) fields.push(f)
    }
  }
  // Snipe-IT sends custom fields as label → { value }, or [] when there are none.
  for (const [label, f] of Object.entries((raw.custom_fields ?? {}) as Record<string, { value?: unknown } | null>))
    if (f?.value != null && f.value !== '') fields.push({ label, value: String(f.value) })
  return fields
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
    // Some Snipe-IT versions answer a form they refuse with 422 and field → messages, like the usual 200-with-error.
    if (res.status === 422 && body && typeof body === 'object' && ('messages' in body || 'errors' in body))
      return { status: 'error', messages: (body as { messages?: unknown; errors?: unknown }).messages ?? (body as { errors?: unknown }).errors }
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
  // kind arrives from the screen over IPC; only a kind the app edits reaches the URL.
  const checkKind = (kind: EditKind) => {
    if (!EDIT_KINDS.includes(kind)) throw new Error(`Unknown record: ${kind}`)
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

  // The custom fields an Asset Model's Assets have (its fieldset's), as form fields; none when it has no fieldset.
  async function customFields(modelId: number): Promise<FormField[]> {
    checkId(modelId, 'Asset Model')
    const model = await request<{ fieldset?: Named }>(`/models/${modelId}`)
    if (isError(model)) throw new Error(reason(model.messages))
    if (!model.fieldset?.id) return []
    const set = await request<{ rows: { name: string; db_column_name: string; type: string; format: string; required: number | boolean; field_values_array: string[] | null }[] }>(`/fieldsets/${model.fieldset.id}/fields`)
    if (isError(set)) throw new Error(reason(set.messages))
    return set.rows.map((c) => ({
      key: c.db_column_name, label: c.name, required: !!c.required,
      ...(c.field_values_array?.length ? { type: c.type === 'checkbox' ? 'choices' as const : 'choice' as const, options: c.field_values_array }
        : { type: c.type === 'textarea' ? 'textarea' as const : c.format === 'DATE' ? 'date' as const : c.format === 'NUMERIC' ? 'number' as const : 'text' as const }),
    }))
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
      const asset = { ...toAsset(body, today()), fields: fieldsOf(body as unknown as RawRow) }
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

    // A report's rows. Snipe-IT can't filter its log by date, or by kind without one item, so the Activity Report pages
    // newest first, keeps what's in range, and stops once it's past `from`. Overdue and Warranty expiring use the dashboard's rules.
    async report(kind: ReportKind, { from, to, itemType, actionType }: ReportQuery = {}): Promise<Report> {
      // The query arrives from the screen over IPC.
      if (!REPORTS.includes(kind)) throw new Error(`Unknown report: ${kind}`)
      for (const date of [from, to]) if (date !== undefined && date !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(String(date))) throw new Error('Dates must be YYYY-MM-DD')
      if (itemType && !(ACTIVITY_ITEM_TYPES as readonly string[]).includes(itemType)) throw new Error(`Unknown record type: ${itemType}`)
      if (actionType && !(ACTIVITY_ACTIONS as readonly string[]).includes(actionType)) throw new Error(`Unknown action: ${actionType}`)
      const inRange = (day: string) => (!from || day >= from) && (!to || day <= to)
      if (kind === 'activity') {
        const rows: string[][] = []
        // Each page starts where the last one's rows ended: a server may cap pages below PAGE_LIMIT.
        for (let offset = 0; ; ) {
          const params = new URLSearchParams({ limit: String(PAGE_LIMIT), offset: String(offset), sort: 'created_at', order: 'desc', ...(actionType && { action_type: actionType }) })
          const page = await request<{ total: number; rows: RawActivity[] }>(`/reports/activity?${params}`)
          if (isError(page)) throw new Error(reason(page.messages))
          for (const r of page.rows) {
            const day = r.created_at?.datetime.slice(0, 10) ?? ''
            // An entry without a date can't be placed in the range, and mustn't end the report either.
            if (from && day && day < from) return { columns: ACTIVITY_COLUMNS, rows, capped: false }
            if (!inRange(day) || (itemType && r.item?.type !== itemType)) continue
            // Full, and one more matches: it's cut short.
            if (rows.length === REPORT_MAX) return { columns: ACTIVITY_COLUMNS, rows, capped: true }
            const e = toHistoryEntry(r)
            rows.push([e.when, e.action, e.operator, itemTypeName[r.item?.type as keyof typeof itemTypeName] ?? r.item?.type ?? '', r.item?.name ?? '', e.detail, e.note])
          }
          offset += page.rows.length
          if (!page.rows.length || offset >= page.total) return { columns: ACTIVITY_COLUMNS, rows, capped: false }
        }
      }
      const now = today()
      const assets = (await allRows<RawAsset>('/hardware')).map((r) => toAsset(r, now))
      if (kind === 'overdue')
        return {
          columns: ['Asset Tag', 'Name', 'Assignee', 'Expected Checkin', 'Days late'],
          rows: assets.filter((a) => a.overdueDays !== null && inRange(a.expectedCheckin!)).sort((a, b) => b.overdueDays! - a.overdueDays!)
            .map((a) => [a.assetTag, a.name, a.assignee?.name ?? '', a.expectedCheckin!, String(a.overdueDays)]),
          capped: false,
        }
      return {
        columns: ['Asset Tag', 'Name', 'Status', 'Warranty ends', 'Days left'],
        rows: assets.flatMap((a) => (a.warranty && !a.warranty.expired && inRange(a.warrantyEnd!) ? [{ a, left: a.warranty.daysLeft }] : [])).sort((x, y) => x.left - y.left)
          .map(({ a, left }) => [a.assetTag, a.name, a.status, a.warrantyEnd!, String(left)]),
        capped: false,
      }
    },

    // One record of any kind but Assets (whose sheet is getAsset), with every field Snipe-IT sends.
    async record(kind: RecordKind, id: number): Promise<RecordDetail> {
      // kind arrives from the screen over IPC; only a known record kind reaches the URL.
      if (!Object.hasOwn(LISTS, kind) || (kind as ListKind) === 'activity' || kind === 'assets') throw new Error(`Unknown record: ${kind}`)
      checkId(id, 'record')
      const body = await request<RawRow>(`${LISTS[kind].path}/${id}`)
      if (isError(body)) throw new Error(reason(body.messages))
      return { kind, id, name: String(body.name ?? ''), fields: fieldsOf(body), ...(kind === 'categories' && { categoryType: text(body.category_type) }) }
    },

    // A record's form: the kind's fields and, editing, its current values; an Asset's include its Asset Model's custom fields.
    async form(kind: EditKind, id?: number): Promise<RecordForm> {
      checkKind(kind)
      if (id === undefined) return { fields: FORMS[kind], values: {} }
      checkId(id, 'record')
      const raw = await request<RawRow>(`${LISTS[kind].path}/${id}`)
      if (isError(raw)) throw new Error(reason(raw.messages))
      const custom = kind === 'assets' && (raw.model as Named)?.id ? await customFields((raw.model as { id: number }).id) : []
      const fields = [...FORMS[kind].filter((f) => !f.newOnly), ...custom]
      // Snipe-IT keeps custom field values under their label, each saying its db column.
      const customValues = Object.values((raw.custom_fields ?? {}) as Record<string, { field?: string; value?: unknown } | null>)
      const values = Object.fromEntries(fields.map((f) => [f.key, f.key.startsWith('_snipeit_')
        ? String(customValues.find((c) => c?.field === f.key)?.value ?? '') : formValue(raw, f)]))
      return { fields, values }
    },

    // Creates (id null) or edits a record. Only the form's fields (and custom fields) reach Snipe-IT; a blank choice, number
    // or date is sent as none, and a blank password when editing is left out. Snipe-IT's refusal comes back per field.
    async save(kind: EditKind, id: number | null, values: Record<string, string>): Promise<SaveResult> {
      checkKind(kind)
      if (id !== null) checkId(id, 'record')
      if (typeof values !== 'object' || values === null) throw new Error('Invalid form')
      const byKey = new Map(FORMS[kind].map((f) => [f.key, f]))
      const body: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(values)) {
        const f = byKey.get(key)
        if ((!f && !(kind === 'assets' && /^_snipeit_[a-z0-9_]+$/.test(key))) || typeof value !== 'string') throw new Error(`Invalid field: ${key}`)
        if (f?.newOnly && id !== null) continue
        const blankIsNone = f?.type === 'choice' || f?.type === 'number' || f?.type === 'date'
        body[key] = value === '' && blankIsNone ? null : value
      }
      const path = LISTS[kind].path
      const result = await request<{ status?: string; payload?: { id?: number } | null }>(id === null ? path : `${path}/${id}`, body, id === null ? 'POST' : 'PATCH')
      if (!isError(result)) {
        const saved = id ?? result.payload?.id
        if (!saved) throw new Error("Snipe-IT saved it but didn't say which record it is; look for it in the List.")
        return { ok: true, id: saved }
      }
      // Validation arrives as field → messages; anything else is one line.
      const fieldMessages = result.messages && typeof result.messages === 'object' ? (result.messages as Record<string, unknown>) : null
      if (!fieldMessages) return { ok: false, message: reason(result.messages) || "Snipe-IT didn't save it.", errors: {} }
      const errors = Object.fromEntries(Object.entries(fieldMessages).map(([k, m]) => [k, reason(m)]))
      // A field the form shows (an edit sends only the changed ones; an Asset's custom fields are its model's) is marked below, not repeated in the line.
      const known = new Set([...byKey.keys(), ...Object.keys(values)])
      const shown = (k: string) => known.has(k) || (kind === 'assets' && k.startsWith('_snipeit_'))
      const other = Object.entries(errors).filter(([k]) => !shown(k)).map(([, m]) => m).join(' ')
      return { ok: false, message: other || "Snipe-IT didn't save it: see the fields marked below.", errors }
    },

    customFields,

    // Deletes a record; Snipe-IT refuses (e.g. an Asset still checked out) with its reason.
    async remove(kind: EditKind, id: number): Promise<void> {
      checkKind(kind)
      checkId(id, 'record')
      const result = await request(`${LISTS[kind].path}/${id}`, {}, 'DELETE')
      if (isError(result)) throw new Error(reason(result.messages))
    },

    // Names for filter dropdowns. ponytail: every row, via allRows; fine at a school's few hundred models.
    async names(kind: NamesKind): Promise<StatusLabel[]> {
      const paths: Record<NamesKind, string> = {
        models: '/models', categories: '/categories?category_type=asset', departments: '/departments', statuslabels: '/statuslabels', locations: '/locations',
        suppliers: '/suppliers', companies: '/companies', manufacturers: '/manufacturers', 'categories:license': '/categories?category_type=license',
        'categories:accessory': '/categories?category_type=accessory', 'categories:consumable': '/categories?category_type=consumable', 'categories:component': '/categories?category_type=component',
      }
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
