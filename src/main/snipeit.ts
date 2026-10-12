import { appNote, liveEntries, parseAppNote, parseWorkflowNote } from './notes'
import type { Release } from './release'

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
  /** The Status Label's own type (status_type): deployable, pending, archived, undeployable. Unlike status_meta, which
   *  says 'deployed' for any checked-out Asset, it still shows a Pending or Broken label on one that's out. */
  statusType: string
  assignee: Assignee | null
  /** Checkout allowed: no Assignee and a deployable status */
  checkoutAllowed: boolean
  location: string
  /** Where Snipe-IT puts the Asset on a Checkin with no Location (its rtd_location); '' when it has none */
  defaultLocation: string
  /** The Location's id, so an undo can put it back */
  locationId: number | null
  category: string
  serial: string
  purchaseDate: string | null
  warrantyEnd: string | null
  /** "YYYY-MM-DD", or "YYYY-MM-DD HH:MM" when Snipe-IT (v8.7+) holds a time of day */
  expectedCheckin: string | null
  /** When its current Checkout was made, "YYYY-MM-DD HH:MM"; null when Snipe-IT doesn't say */
  lastCheckout: string | null
  /** The date of the Asset's last Audit, or null when it has never been Audited */
  lastAudited: string | null
  /** The date Snipe-IT expects its next Audit, or null when it has none */
  nextAudit: string | null
  /** Its End of life date, or null when Snipe-IT has none */
  endOfLife: string | null
  /** What it cost, as a plain number ("1234.56"), or null when Snipe-IT has none */
  purchaseCost: string | null
  /** How late, or null when not Overdue */
  overdue: Lateness | null
  /** Expiring (ends within 90 days) or expired; null when neither, or when Snipe-IT has no warranty date */
  warranty: { expired: false; daysLeft: number } | { expired: true } | null
  /** What Snipe-IT lets the Operator's key do to this Asset (its available_actions); true when Snipe-IT doesn't say. */
  can: Can
}

/** What the Operator's key may do to one record, as Snipe-IT's available_actions says. */
export type Can = { checkout: boolean; checkin: boolean; update: boolean; delete: boolean; audit: boolean }
// Snipe-IT sends permissions decoded (key → value); an older one, or a field saved by hand, may send the JSON text.
const permissionsOf = (raw: unknown): Record<string, unknown> => {
  let value = raw
  if (typeof raw === 'string') try { value = JSON.parse(raw) } catch { return {} }
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}
const canFrom = (raw: unknown): Can => {
  const a = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof Can, unknown>>
  return { checkout: a.checkout !== false, checkin: a.checkin !== false, update: a.update !== false, delete: a.delete !== false, audit: a.audit !== false }
}

export type HistoryEntry = { when: string; action: string; operator: string; detail: string; note: string }

/** historyError is set when History couldn't be loaded (e.g. the key lacks permission); the Asset still shows. fields: every field Snipe-IT sent. */
export type AssetWithHistory = Asset & { history: HistoryEntry[]; historyError?: string; fields: Field[] }

export type StatusLabel = { id: number; name: string }

/** A Checkin. fromAssignee and fromStatusId: who it must still be checked out to and the Status Label it must still have,
 *  checked on Checkin's own last read (an Undo never undoes someone else's Checkout or overwrites a label set since).
 *  noDefaultLocation: it must have no Default Location then, which a Checkin with no Location would move it to. */
export type CheckinOptions = { statusId?: number; locationId?: number; note?: string; fromAssignee?: Pick<Assignee, 'type' | 'id'>; fromStatusId?: number; noDefaultLocation?: boolean }

/** The User a Workflow's first step found, for its header. assets: how many Assets they hold. */
export type UserCard = { id: number; name: string; username: string; employeeNum: string; assets: number }

/** A User or Location to check an Asset out to. detail tells namesakes apart (a User's username). */
export type CheckoutTarget = { id: number; name: string; detail: string }

/**
 * How late an Overdue Asset is: whole days past its Expected Checkin's date (0 on the due day, once its time of day has
 * passed), and minutes past the moment it became Overdue, which lists sort by.
 */
export type Lateness = { days: number; minutes: number }

/** How late, for display: "40 min" or "2 h" on the due day, "3d" after it. */
export const lateness = ({ days, minutes }: Lateness) =>
  days ? `${days}d` : minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h`

/** An Audit's Next audit ("YYYY-MM-DD"; left out, Snipe-IT sets it from its audit interval) and the typed note, if any. */
export type AuditOptions = { nextAudit?: string; note?: string }
/** The next audit date an Audit moved from (was) and to (next); next is null when Snipe-IT has no audit interval set. */
export type Audited = { was: string | null; next: string | null }

/** A Checkout to a User, a Location or another Asset. statusId: the Status Label to set instead of the current one (it
 *  must be deployable). fromStatusId: the Status Label the Asset must still have, checked on Checkout's own last read (an
 *  Undo never overwrites a label set since). fromLocationId: the Location it must still be at then (null: none).
 *  expectedCheckin: "YYYY-MM-DD", or "YYYY-MM-DD HH:MM" with a time of day. */
export type CheckoutOptions = { targetType: Assignee['type']; targetId: number; statusId?: number; fromStatusId?: number; fromLocationId?: number | null; expectedCheckin?: string; note?: string }
const TARGET_NAME: Record<Assignee['type'], string> = { user: 'User', location: 'Location', asset: 'Asset' }

/** What the rail shows for a match or a recent scan. */
export type AssetSummary = Pick<Asset, 'id' | 'assetTag' | 'name' | 'status' | 'statusMeta' | 'assignee' | 'can'>

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
export type RecordDetail = { kind: RecordKind; id: number; name: string; fields: Field[]; categoryType?: string; can: Can }
/** A User's permissions of their own (key → granted '1', denied '-1') and their permission groups. */
export type UserAccess = { permissions: Record<string, string>; groups: StatusLabel[] }
/** A permission group and what it grants (key → '1' granted, '0' not). */
export type Group = { id: number; name: string; permissions: Record<string, string> }

// Snipe-IT's permission keys (config/permissions.php), by area, as its group editor shows them.
export const PERMISSIONS: [area: string, keys: string[]][] = [
  ['Global', ['superuser', 'admin', 'import', 'reports.view']],
  ...(['assets', 'accessories', 'consumables', 'licenses', 'components'] as const).map((k): [string, string[]] => [k.charAt(0).toUpperCase() + k.slice(1), [
    `${k}.view`, `${k}.create`, `${k}.edit`, `${k}.delete`, `${k}.checkout`,
    ...(k === 'consumables' ? [] : [`${k}.checkin`]), ...(k === 'assets' ? ['assets.audit', 'assets.view.requestable', 'assets.view.encrypted_custom_fields'] : []), ...(k === 'licenses' ? ['licenses.keys'] : []),
  ]]),
  ...([['Users', 'users'], ['Asset Models', 'models'], ['Categories', 'categories'], ['Departments', 'departments'], ['Status Labels', 'statuslabels'], ['Custom Fields', 'customfields'],
    ['Suppliers', 'suppliers'], ['Manufacturers', 'manufacturers'], ['Depreciations', 'depreciations'], ['Locations', 'locations'], ['Companies', 'companies'], ['Kits', 'kits']] as const)
    .map(([area, k]): [string, string[]] => [area, [`${k}.view`, `${k}.create`, `${k}.edit`, `${k}.delete`]]),
  ['Self', ['self.two_factor', 'self.api', 'self.edit_location', 'self.checkout_assets', 'self.view_purchase_cost']],
]
/** The Assets List's built-in Views: each a fixed condition that the search and filter boxes narrow. path: Snipe-IT's route,
 * if not /hardware. filter: the Snipe-IT filter the View fixes (status_id names a Status Label, found by name). column: shown
 * in its View whatever the Operator picked under Columns. sort: where picking the View starts the sort. */
export type AssetView = 'all' | 'checkedOut' | 'available' | 'damaged' | 'auditDue' | 'auditLate'
export const ASSET_VIEWS: Record<AssetView, { name: string; path?: string; filter?: [string, string]; column?: keyof Asset; sort?: { key: keyof Asset; order: 'asc' | 'desc' } }> = {
  all: { name: 'All' },
  checkedOut: { name: 'Checked out', filter: ['status', 'Deployed'], column: 'expectedCheckin' },
  available: { name: 'Available', filter: ['status', 'RTD'] },
  damaged: { name: 'Damaged', filter: ['status_id', 'Damaged'] },
  // The same routes as the audit Reports, so a View and a Report never disagree; Snipe-IT applies the filter boxes to them too.
  auditDue: { name: 'Audit due', path: '/hardware/audit/due', column: 'nextAudit', sort: { key: 'nextAudit', order: 'asc' } },
  auditLate: { name: 'Audit late', path: '/hardware/audit/overdue', column: 'nextAudit', sort: { key: 'nextAudit', order: 'asc' } },
}
/** sort is a row field (see LIST_SORTS); filters are Snipe-IT filter name → value, '' meaning none. offset counts rows.
 * view: an Assets View (All when left out). */
export type ListQuery = { search?: string; filters?: Record<string, string>; sort?: string; order?: 'asc' | 'desc'; offset?: number; view?: AssetView }
/** Each row carries what the Operator may do to it (its available_actions), so a Bulk Action is offered only when allowed.
 * why: what an empty page says instead of "Nothing matches" (a Damaged View with no Status Label named Damaged). */
export type ListPage<K extends ListKind> = { total: number; rows: (ListRows[K] & { can: Can })[]; why?: string }

/** The dashboard pieces: the charts (assets is Assets by Status Label), the five Inventory Chart bars, then the two tables. */
export const DASHBOARD_PIECES = ['assets', 'categories', 'locations', 'licenses', 'accessories', 'consumables', 'components', 'users', 'overdue', 'expiring'] as const
export type DashboardPiece = (typeof DASHBOARD_PIECES)[number]
/** The pieces built from the one Asset list; the screen groups them so they share a fetch. */
export const ASSET_PIECES: readonly DashboardPiece[] = ['assets', 'categories', 'locations', 'overdue', 'expiring']

/** How many Assets have one Status Label, Category or Location. id is null for the Assets with none (e.g. No Location). */
export type Tally = { id: number | null; name: string; count: number }
/** type: the Status Label's kind (deployable, pending, undeployable, archived); color: Snipe-IT's color for it, or null. */
export type StatusTally = Tally & { type: string; color: string | null }
/** Why a dashboard piece couldn't load: Snipe-IT's reason, or the app's connection message. */
export type Failed = { error: string }
/** A kind counted by quantity: the used side (In use, Checked out, Used, Holding) and the available side. */
export type Split = { used: number; available: number }

/**
 * One entry per requested piece: its data, or { error } with the reason it couldn't load.
 * Tallies most first, Overdue Assets most late first, Expiring Warranties soonest first (expired ones left out).
 */
export type Dashboard = {
  [K in DashboardPiece]?: Failed | {
    assets: StatusTally[]; categories: Tally[]; locations: Tally[]
    licenses: Split; accessories: Split; consumables: Split; components: Split; users: Split
    overdue: { rows: OverdueRow[]; tempError?: string }
    expiring: (AssetSummary & { daysLeft: number })[]
  }[K]
}

/** An Overdue Asset on the dashboard; temp when it's an outstanding Temp checkout. Whole, so its Checkin Quick Action can run. */
export type OverdueRow = Asset & { expectedCheckin: string; overdue: Lateness; temp: boolean }
/** The dashboard Overdue list, or only its Temp checkouts (Health warning 5 counts that). */
export const overdueList = (rows: OverdueRow[], tempOnly: boolean) => (tempOnly ? rows.filter((r) => r.temp) : rows)

/**
 * One load of the Health warnings' checks, each run at once and failing on its own (Temp checkouts Overdue comes from the
 * dashboard's Overdue list instead). probe is the /version call: the version
 * Snipe-IT runs, or that it can't be reached or refuses the key (which every other check would hit too). The Audit late and
 * Audit due totals are Snipe-IT's own (its /hardware/audit routes), for the Upcoming audits timeline (#112) to share.
 */
export type Health = {
  probe: { version: string } | { warning: 'unreachable' | 'key'; message: string } | Failed
  auditLate: number | Failed
  auditDue: number | Failed
}
/** One line of the Health warnings strip, or why its check couldn't run. */
export type HealthLine =
  | { warning: 'unreachable' | 'key'; message: string }
  | { warning: 'tooOld'; version: string }
  | { warning: 'auditLate' | 'auditDue' | 'temp'; count: number }
  | { warning: 'newer'; release: Release; running: string }
  | { warning: 'tooOld' | 'auditLate' | 'auditDue' | 'temp'; error: string }
/** The oldest Snipe-IT this app supports: v8.7 sends Expected Checkin with a time of day, which Temp checkout needs. */
export const MIN_SNIPEIT = [8, 7] as const

/**
 * The strip's lines, red before amber: none at 0. Snipe-IT unreachable or the key failing shows only that line. release:
 * GitHub's latest Snipe-IT release, from the main process's daily check (createReleaseCheck), if one is known and not hidden.
 * Temp checkouts Overdue counts the dashboard's Overdue list (none until it has loaded).
 */
export function healthLines({ probe, auditLate, auditDue }: Health, release?: Release | null, overdue?: Dashboard['overdue']): HealthLine[] {
  if ('warning' in probe) return [probe]
  const running = 'version' in probe ? versionParts(probe.version) : null
  const tooOld: HealthLine[] = 'error' in probe ? [{ warning: 'tooOld', error: probe.error }]
    : !running ? [{ warning: 'tooOld', error: `Snipe-IT's version, ${probe.version}, isn't one this app can read.` }]
    : olderThan(running, MIN_SNIPEIT) ? [{ warning: 'tooOld', version: probe.version }] : []
  const latest = release && versionParts(release.tag)
  const newer: HealthLine[] = running && latest && olderThan(running, latest) && 'version' in probe ? [{ warning: 'newer', release, running: probe.version }] : []
  const total = (warning: 'auditLate' | 'auditDue' | 'temp', t: number | Failed | undefined): HealthLine[] =>
    t === undefined ? [] : typeof t !== 'number' ? [{ warning, error: t.error }] : t ? [{ warning, count: t }] : []
  const temp = !overdue || 'error' in overdue ? overdue : overdue.tempError ? { error: overdue.tempError } : overdueList(overdue.rows, true).length
  return [...tooOld, ...total('auditLate', auditLate), ...total('temp', temp), ...newer, ...total('auditDue', auditDue)]
}
// "v8.8.0", "8.8" or "v8.8.0 build 120 (g1a2b3c)" → [8, 8, 0]; null when it isn't a version.
const versionParts = (v: string) => /^v?(\d+)\.(\d+)(?:\.(\d+))?/.exec(v)?.slice(1).map((n) => Number(n ?? 0)) ?? null
const olderThan = (a: readonly number[], b: readonly number[]) => {
  const i = a.findIndex((n, i) => n !== (b[i] ?? 0))
  return i >= 0 && a[i] < (b[i] ?? 0)
}

/** The Reports: the Activity Report over a date range, the Overdue and Warranty expiring lists in full, the audit Reports, End of life, two snapshots, Maintenances, Temp checkout history and Damaged. */
export const REPORTS = ['activity', 'overdue', 'expiring', 'auditDue', 'auditLate', 'lastAudited', 'endOfLife', 'statusLocation', 'checkedOut', 'maintenances', 'tempHistory', 'damaged'] as const
export type ReportKind = (typeof REPORTS)[number]
export const REPORT_NAMES: Record<ReportKind, string> = {
  activity: 'Activity Report', overdue: 'Overdue', expiring: 'Warranty expiring', auditDue: 'Audit due', auditLate: 'Audit late', lastAudited: 'Last audited', endOfLife: 'End of life',
  statusLocation: 'Assets by Status Label and Location', checkedOut: 'Checked out per User', maintenances: 'Maintenances',
  tempHistory: 'Temp checkout history', damaged: 'Damaged',
}
/** The Reports whose Schedule sets their dates relative to each send (see Schedule's range); the others look ahead or take every date. */
export const RANGED_REPORTS: readonly ReportKind[] = ['activity', 'overdue', 'lastAudited', 'maintenances', 'tempHistory']
/** Whether a Schedule's Report (a { builtIn } or { saved } key, from the screen) takes a date range: a Saved Report's List has no dates. */
export const takesRange = (report: unknown) =>
  !!report && typeof report === 'object' && 'builtIn' in report && RANGED_REPORTS.includes(report.builtIn as ReportKind)
/** The audit Reports, which ask Snipe-IT for its audit dates. */
export const AUDIT_REPORTS: readonly ReportKind[] = ['auditDue', 'auditLate', 'lastAudited']
/** The Reports narrowed to a Location and a Category. */
export const LOCATION_CATEGORY_REPORTS: readonly ReportKind[] = [...AUDIT_REPORTS, 'endOfLife', 'statusLocation', 'checkedOut']
/** Kinds of thing the Activity Report can be narrowed to (Snipe-IT's item types). */
export const ACTIVITY_ITEM_TYPES = ['asset', 'license', 'accessory', 'consumable', 'component', 'user'] as const
/** Glossary name for each Record type, for the Activity Report's filter and column. */
export const itemTypeName: Record<(typeof ACTIVITY_ITEM_TYPES)[number], string> = { asset: 'Assets', license: 'Licenses', accessory: 'Accessories', consumable: 'Consumables', component: 'Components', user: 'Users' }
/**
 * from/to are "YYYY-MM-DD", both included; what they bound depends on the report (when it happened, Expected Checkin, warranty
 * end, next audit, last audit, End of life, Maintenance start, Checkout day). locationId/categoryId: Snipe-IT ids, for LOCATION_CATEGORY_REPORTS.
 */
export type ReportQuery = { from?: string; to?: string; itemType?: string; actionType?: string; locationId?: string; categoryId?: string }
/** A report as a table of text, ready to show or export. capped: more rows matched than a report holds. */
export type Report = { columns: string[]; rows: string[][]; capped: boolean }

/** The kinds the app can create, edit and delete. */
export const EDIT_KINDS = ['assets', 'users', 'locations', 'licenses', 'accessories', 'consumables', 'components'] as const
export type EditKind = (typeof EDIT_KINDS)[number]
/** The kinds the app can delete: every List of Records, including the kinds it doesn't edit. */
export const DELETE_KINDS = [...EDIT_KINDS, 'models', 'categories', 'manufacturers', 'suppliers', 'departments', 'companies', 'statuslabels'] as const
export type DeleteKind = (typeof DELETE_KINDS)[number]
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

/** What an Import can create or update, in Snipe-IT's import-type names. */
export const IMPORT_TYPES = { asset: 'Assets', user: 'Users', license: 'Licenses', accessory: 'Accessories', consumable: 'Consumables', component: 'Components', location: 'Locations' } as const
export type ImportType = keyof typeof IMPORT_TYPES
// Snipe-IT's import field lists (its Livewire Importer's {type}_fields), English labels. Snipe-IT fills a Custom Field from
// the column headed with its name, so custom fields need no matching and aren't listed. ponytail: copied from Snipe-IT v8,
// which doesn't serve them over the API; a field it adds later is missing here until copied in (its heading still works).
export const IMPORT_FIELDS: Record<ImportType, [key: string, label: string][]> = {
  asset: [['id', 'ID'], ['asset_eol_date', 'EOL Date'], ['asset_model', 'Model Name'], ['asset_notes', 'Asset Notes'], ['asset_tag', 'Asset Tag'], ['byod', 'BYOD'],
    ['category', 'Category'], ['company', 'Company'], ['image', 'Image Filename'], ['item_name', 'Asset Name'], ['location', 'Location'], ['manufacturer', 'Manufacturer'],
    ['model_notes', 'Model Notes'], ['model_number', 'Model No.'], ['order_number', 'Order Number'], ['purchase_cost', 'Purchase Cost'], ['purchase_date', 'Purchase Date'],
    ['requestable', 'Requestable'], ['serial', 'Serial Number'], ['status', 'Status'], ['supplier', 'Supplier'], ['warranty_months', 'Warranty'], ['checkout_class', 'Checkout Type'],
    ['first_name', 'Checked Out to: First Name'], ['last_name', 'Checked Out to: Last Name'], ['full_name', 'Checked Out to: Full Name'], ['email', 'Checked Out to: Email'],
    ['username', 'Checked Out to: Username'], ['checkout_location', 'Checkout to Location'], ['checkout_asset', 'Checkout to Asset Tag'], ['checkout_user', 'Checkout to Username'],
    ['last_checkin', 'Last Checkin Date'], ['last_checkout', 'Checkout Date'], ['expected_checkin', 'Expected Checkin Date'], ['last_audit_date', 'Last Audit'], ['next_audit_date', 'Next Audit Date']],
  user: [['id', 'ID'], ['activated', 'Activated'], ['address', 'Address'], ['avatar', 'Image'], ['city', 'City'], ['company', 'Company'], ['country', 'Country'], ['department', 'Department'],
    ['email', 'Email'], ['employee_num', 'Employee Number'], ['end_date', 'End Date'], ['first_name', 'First Name'], ['gravatar', 'Gravatar Email'], ['jobtitle', 'Title'], ['last_name', 'Last Name'],
    ['location', 'Location'], ['manager_first_name', 'Manager First Name'], ['manager_last_name', 'Manager Last Name'], ['manager_employee_num', 'Manager Employee Number'],
    ['manager_username', 'Manager Username'], ['notes', 'Notes'], ['phone_number', 'Phone'], ['mobile_number', 'Mobile'], ['remote', 'Remote'], ['start_date', 'Start Date'], ['state', 'State'],
    ['username', 'Username'], ['display_name', 'Display Name'], ['vip', 'VIP'], ['website', 'Website'], ['zip', 'Zip']],
  license: [['asset_tag', 'Checked Out to: Asset Tag'], ['category', 'Category'], ['checkout_class', 'Checkout Type'], ['company', 'Company'], ['email', 'Checked Out to: Email'],
    ['expiration_date', 'Expiration Date'], ['full_name', 'Checked Out to: Full Name'], ['item_name', 'License Name'], ['license_email', 'Licensed to Email'], ['license_name', 'Licensed To'],
    ['location', 'Location'], ['maintained', 'Maintained'], ['manufacturer', 'Manufacturer'], ['min_amt', 'Min. QTY'], ['notes', 'Notes'], ['order_number', 'Order Number'],
    ['purchase_cost', 'Purchase Cost'], ['purchase_date', 'Purchase Date'], ['purchase_order', 'Purchase Order Number'], ['reassignable', 'Reassignable'], ['seats', 'Seats'],
    ['serial', 'Serial/Product Key'], ['supplier', 'Supplier'], ['termination_date', 'Termination Date'], ['username', 'Checked Out to: Username']],
  accessory: [['category', 'Category'], ['company', 'Company'], ['item_name', 'Accessory Name'], ['location', 'Location'], ['manufacturer', 'Manufacturer'], ['min_amt', 'Min QTY'],
    ['model_number', 'Model No.'], ['notes', 'Notes'], ['order_number', 'Order Number'], ['purchase_cost', 'Purchase Cost'], ['purchase_date', 'Purchase Date'], ['quantity', 'QTY'], ['supplier', 'Supplier']],
  consumable: [['category', 'Category'], ['checkout_class', 'Checkout Type'], ['company', 'Company'], ['item_name', 'Consumable Name'], ['item_no', 'Item No.'], ['location', 'Location'],
    ['manufacturer', 'Manufacturer'], ['min_amt', 'Min. QTY'], ['model_number', 'Model No.'], ['notes', 'Notes'], ['order_number', 'Order Number'], ['purchase_cost', 'Purchase Cost'],
    ['purchase_date', 'Purchase Date'], ['quantity', 'QTY'], ['supplier', 'Supplier']],
  component: [['category', 'Category'], ['company', 'Company'], ['item_name', 'Component Name'], ['location', 'Location'], ['manufacturer', 'Manufacturer'], ['min_amt', 'Min QTY'],
    ['model_number', 'Model No.'], ['notes', 'Notes'], ['order_number', 'Order Number'], ['purchase_cost', 'Purchase Cost'], ['purchase_date', 'Purchase Date'], ['quantity', 'QTY'],
    ['serial', 'Serial Number'], ['supplier', 'Supplier']],
  location: [['id', 'ID'], ['company', 'Company'], ['name', 'Name'], ['address', 'Address'], ['address2', 'Address Line 2'], ['city', 'City'], ['country', 'Country'], ['currency', 'Currency'],
    ['ldap_ou', 'LDAP Search OU'], ['manager', 'Manager Full Name'], ['manager_username', 'Manager Username'], ['notes', 'Notes'], ['parent_location', 'Parent'], ['state', 'State'],
    ['zip', 'Zip'], ['tag_color', 'Tag Color']],
}
/**
 * A CSV uploaded to Snipe-IT's importer: its headings and first row, and how it was last imported (type, and heading →
 * field), or '' and {} if it hasn't been. uploaded is as Snipe-IT says it ("2 hours ago").
 */
export type ImportFile = { id: number; name: string; size: string; uploaded: string; type: ImportType | ''; headers: string[]; firstRow: string[]; mapping: Record<string, string> }
/** Imported, or Snipe-IT's errors for each row that failed, keyed by the row's name, exactly as Snipe-IT sent them. */
export type ImportResult = { ok: true } | { ok: false; errors: Record<string, unknown> }

/**
 * What kind of failure a call hit, so the window can tell one every following request would hit too (Snipe-IT
 * unreachable or too slow, the API key rejected, a refusal, or a request limit) from one about this request alone (refused).
 */
export type FailureKind = 'unreachable' | 'timeout' | 'key' | 'forbidden' | 'rateLimited' | 'refused'
/**
 * A failed call as the window receives it: the message for the Operator, its kind, and for rateLimited the seconds to wait.
 * A plain object, not an Error: the bridge to the window copies an Error's message only, but an object's every field.
 */
export type Failure = { message: string; kind: FailureKind; retryAfter?: number }

// Electron passes only an error's message from the main process, so it writes the kind into it ("[rateLimited 23] …")
// and the preload reads it back out. An error with no kind is about this request alone.
export function toWire(e: unknown): Error {
  const { kind = 'refused', retryAfter } = e as Partial<Failure>
  return new Error(`[${kind}${retryAfter === undefined ? '' : ` ${retryAfter}`}] ${e instanceof Error ? e.message : String(e)}`)
}
export function fromWire(message: string): Failure {
  const [, kind = 'refused', seconds, text = message] = /^\[(\w+)(?: (\d+))?\] ([\s\S]*)$/.exec(message) ?? []
  return { message: text, kind: kind as FailureKind, ...(seconds !== undefined && { retryAfter: Number(seconds) }) }
}

export type SnipeIt = ReturnType<typeof createSnipeIt>
/** What the screen can call: labelPdf only the main process uses, to print Labels. */
export type SnipeItBridge = Omit<SnipeIt, 'labelPdf'>

type SnipeItError = { status: 'error'; messages: unknown }
type Named = { id: number; name: string } | null
type RawAsset = {
  id: number
  asset_tag: string
  name: string | null
  serial: string | null
  model: Named
  status_label: { id: number; name: string; status_type?: string; status_meta: string } | null
  category: Named
  location: Named
  rtd_location: Named
  // employee_number only for a User the Operator may view (Snipe-IT's AssetsTransformer, v8.7+).
  assigned_to: { id: number; name: string; type: Assignee['type']; employee_number?: string | null } | null
  last_checkout?: { date?: string; datetime?: string } | null
  purchase_date: { date: string } | null
  warranty_expires: { date: string } | null
  // Snipe-IT v8.7+ sends { datetime } (a date-only one at 00:00); older servers send { date }.
  expected_checkin: { date?: string; datetime?: string } | null
  // Snipe-IT (to v8.8 at least) sends last_audit_date as {datetime} and next_audit_date as {date}; either is read.
  last_audit_date?: { date?: string; datetime?: string } | null
  next_audit_date?: { date?: string; datetime?: string } | null
  asset_eol_date?: { date: string } | null
  // Formatted text, e.g. "1,234.56"; null when none.
  purchase_cost?: string | number | null
  available_actions?: unknown
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
type RawMaintenance = {
  id: number
  asset: { id: number; name: string | null; asset_tag: string } | null
  // Snipe-IT v8 renamed `title` to `name` and still sends both.
  title: string | null
  // v8.6+ sends the type as maintenance_type (and asset_maintenance_type empty); earlier versions only asset_maintenance_type.
  maintenance_type?: string | null
  asset_maintenance_type?: string | null
  supplier: Named
  is_warranty: boolean | number | string | null
  cost: string | null
  start_date: { date: string } | null
  // v8.6+ records completed_at; before that completion_date was when it was completed (v8.7 made it the expected date).
  completed_at?: { datetime: string } | null
  completion_date?: { date: string } | null
  asset_maintenance_time: number | null
  created_by?: Named
  completed_by?: Named
}

const EXPIRING_DAYS = 90
// End of life is a buying horizon, so its Report looks a year ahead.
const END_OF_LIFE_DAYS = 365
// Rows per List page.
export const LIST_PAGE = 50
// Kinds counted by quantity: their list, and the fields for the whole quantity and the available part. Used is the rest.
const QUANTITIES = {
  licenses: ['/licenses', 'seats', 'free_seats_count'],
  accessories: ['/accessories', 'qty', 'remaining_qty'],
  consumables: ['/consumables', 'qty', 'remaining'],
  components: ['/components', 'qty', 'remaining'],
} as const
// ponytail: a Report, or a List's CSV, holds this many rows at most (it says so when it's cut short); a school year of
// activity, or every Asset, is far below it.
export const REPORT_MAX = 10000

// Processing an Import may take as long as Snipe-IT allows it (its importer's time limit, 10 minutes by default).
const IMPORT_TIMEOUT = 600000

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
export const reason = (messages: unknown): string =>
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

export const toSummary = ({ id, assetTag, name, status, statusMeta, assignee, can }: Asset): AssetSummary =>
  ({ id, assetTag, name, status, statusMeta, assignee, can })

// Expected Checkin as "YYYY-MM-DD", or "YYYY-MM-DD HH:MM" when it has a time of day.
// ponytail: 00:00 means date-only, so a real midnight due time is Overdue only from the next day; no Workflow sets one.
function expectedCheckinOf(v: RawAsset['expected_checkin']): string | null {
  const when = v?.datetime ?? v?.date
  if (!when) return null
  const time = when.slice(11, 16)
  return time && time !== '00:00' ? `${when.slice(0, 10)} ${time}` : when.slice(0, 10)
}

// How late an Expected Checkin is, or null until it has passed: its time of day when it has one, else the last moment of its date.
// A started minute counts as 1, so an Asset just past due reads "1 min", never "0 min".
function overdueOf(now: Date, due: string): Lateness | null {
  const [y, mo, d, h, mi] = due.split(/[- :]/).map(Number)
  const at = due.length > 10 ? new Date(y, mo - 1, d, h, mi) : new Date(y, mo - 1, d + 1, 0, 0, 0, -1)
  const ms = now.getTime() - at.getTime()
  if (ms <= 0) return null
  return { days: -daysFrom(now, due.slice(0, 10)) || 0, minutes: Math.max(1, Math.floor(ms / 6e4)) } // || 0: not -0
}

// A Snipe-IT date object's day ("YYYY-MM-DD"), whether it came as a date or a datetime.
const dayOf = (d: { date?: string; datetime?: string } | null | undefined) => (d?.date ?? d?.datetime)?.slice(0, 10) || null

function toAsset(raw: RawAsset, today: Date): Asset {
  const expectedCheckin = expectedCheckinOf(raw.expected_checkin)
  const warrantyEnd = raw.warranty_expires?.date ?? null
  const warrantyLeft = warrantyEnd === null ? null : daysFrom(today, warrantyEnd)
  return {
    id: raw.id,
    assetTag: raw.asset_tag,
    name: raw.name ?? '',
    model: raw.model?.name ?? '',
    status: raw.status_label?.name ?? '',
    statusId: raw.status_label?.id ?? null,
    statusMeta: raw.status_label?.status_meta ?? '',
    statusType: raw.status_label?.status_type ?? '',
    assignee: raw.assigned_to && { type: raw.assigned_to.type, id: raw.assigned_to.id, name: raw.assigned_to.name },
    checkoutAllowed: !raw.assigned_to && raw.status_label?.status_meta === 'deployable',
    location: raw.location?.name ?? '',
    defaultLocation: raw.rtd_location?.name ?? '',
    locationId: raw.location?.id ?? null,
    category: raw.category?.name ?? '',
    serial: raw.serial ?? '',
    purchaseDate: raw.purchase_date?.date ?? null,
    warrantyEnd,
    expectedCheckin,
    lastCheckout: (raw.last_checkout?.datetime ?? raw.last_checkout?.date)?.slice(0, 16) || null,
    lastAudited: dayOf(raw.last_audit_date),
    nextAudit: dayOf(raw.next_audit_date),
    endOfLife: raw.asset_eol_date?.date ?? null,
    purchaseCost: plainNumber(raw.purchase_cost) || null,
    overdue: expectedCheckin && raw.assigned_to ? overdueOf(today, expectedCheckin) : null,
    warranty:
      warrantyLeft === null || warrantyLeft > EXPIRING_DAYS ? null
      : warrantyLeft < 0 ? { expired: true }
      : { expired: false, daysLeft: warrantyLeft },
    can: canFrom(raw.available_actions),
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
const HIDDEN_FIELDS = new Set(['id', 'name', 'custom_fields', 'available_actions', 'user_can_checkout', 'image', 'avatar', 'permissions', 'groups'])

type RawImport = { id: number; file_path: string; name: string | null; filesize: string | null; import_type: string | null; created_at: string | null; header_row: unknown; first_row: unknown; field_map: unknown }
const strings = (v: unknown) => (Array.isArray(v) ? v.map((x) => (x == null ? '' : String(x))) : [])
const toImportFile = (r: RawImport): ImportFile => ({
  id: r.id, name: r.name || r.file_path, size: r.filesize ?? '', uploaded: r.created_at ?? '',
  type: r.import_type && Object.hasOwn(IMPORT_TYPES, r.import_type) ? (r.import_type as ImportType) : '',
  headers: strings(r.header_row), firstRow: strings(r.first_row),
  mapping: r.field_map && typeof r.field_map === 'object' ? Object.fromEntries(Object.entries(r.field_map).filter(([, f]) => typeof f === 'string')) : {},
})
type RawUser = { id: number; name: string; username: string | null; email: string | null; employee_num?: string | null; department: Named; location: Named; assets_count: number | null }
const toUserCard = (r: RawUser): UserCard => ({ id: r.id, name: r.name, username: r.username ?? '', employeeNum: r.employee_num ?? '', assets: r.assets_count ?? 0 })
type RawLocation = { id: number; name: string; parent: Named; city: string | null; assets_count: number | null; assigned_assets_count: number | null; users_count: number | null }
type RawModel = { id: number; name: string; model_number: string | null; manufacturer: Named; category: Named; assets_count: number | null; remaining?: number | null }

// Which row fields each List can sort by, and Snipe-IT's name for that sort. The screen offers only these.
export const LIST_SORTS = {
  assets: {
    assetTag: 'asset_tag', name: 'name', status: 'status', model: 'model', category: 'category', location: 'location', assignee: 'assigned_to', serial: 'serial',
    expectedCheckin: 'expected_checkin', purchaseDate: 'purchase_date', purchaseCost: 'purchase_cost', endOfLife: 'asset_eol_date', lastAudited: 'last_audit_date', nextAudit: 'next_audit_date',
  },
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
// Not item_type: Snipe-IT only applies it together with one item_id. Repair intake and Incoming repair write `note added` on an Asset.
export const ACTIVITY_ACTIONS = ['checkout', 'checkin from', 'update', 'create', 'delete', 'audit', 'note added'] as const
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
    txt('asset_tag', 'Asset Tag', { required: true }), pick('model_id', 'Asset Model', 'models', { required: true }), pick('status_id', 'Status', 'statuslabels', { required: true, from: 'status_label' }), { key: 'expected_checkin', label: 'Expected Checkin', type: 'date' },
    // Here so a mistaken Audit, which can't be undone, can be put back.
    { key: 'next_audit_date', label: 'Next audit date', type: 'date' },
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

/** The kinds a Selection can be bulk edited for. */
export type BulkKind = 'assets' | 'users'
// A bulk edit's fields: what Records of a kind can share (not an Asset Tag or Serial, each Asset's own), none required,
// since a field left blank is left as each Record has it. ponytail: no custom fields; they differ by Asset Model.
const optional = (fields: FormField[]) => fields.map((f) => ({ ...f, required: false }))
export const BULK_FORMS: Record<BulkKind, FormField[]> = {
  assets: optional(FORMS.assets.filter((f) => f.key !== 'asset_tag' && f.key !== 'serial')),
  users: optional(FORMS.users.filter((f) => ['department_id', 'location_id', 'company_id'].includes(f.key))),
}
/** Only the fields filled in, so a bulk edit leaves the rest as each Record has them. */
export const filled = (values: Record<string, string>) => Object.fromEntries(Object.entries(values).filter(([, v]) => v.trim() !== ''))

// Snipe-IT keeps notes as Markdown but sends them rendered to inline HTML; this turns what it renders back into
// Markdown, so editing a note keeps its links and emphasis. ponytail: the inline subset Snipe-IT renders, not all of HTML.
export const markdownOf = (html: string) => html
  .replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>\s*<p>/gi, '\n\n')
  .replace(/<a [^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, '[$2]($1)')
  .replace(/<(strong|b)>(.*?)<\/\1>/gi, '**$2**').replace(/<(em|i)>(.*?)<\/\1>/gi, '*$2*').replace(/<code>(.*?)<\/code>/gi, '`$1`')
  .replace(/<[^>]*>/g, '')

// Snipe-IT formats costs with thousands separators ("1,200.50") and a warranty as "36 months"; only the number is kept, a plain
// number a spreadsheet can sum. ponytail: assumes 1,234.56 formatting, which NOMMA uses; a server set to 1.234,56 would be misread.
const plainNumber = (v: unknown) => (v === null || v === undefined ? '' : String(v).replace(/[^\d.-]/g, ''))

// A form value from a record as Snipe-IT sends it: an id from its object, a date's (or datetime's) day, a number or text as it is.
function formValue(raw: RawRow, f: FormField): string {
  const v = raw[f.from ?? (f.type === 'choice' ? f.key.replace(/_id$/, '') : f.key)]
  if (v === null || v === undefined) return ''
  if (typeof v === 'object') {
    const o = v as { id?: unknown; date?: unknown; datetime?: unknown }
    return String(o.id ?? o.date ?? (typeof o.datetime === 'string' ? o.datetime.slice(0, 10) : ''))
  }
  // Only a note is Markdown Snipe-IT rendered; a Name or Serial is kept as it is (request() already decoded its entities).
  if (f.type === 'number') return plainNumber(v)
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
    // A list of records (a Location's children, or a { total, rows } page) gives each its own field; a list of plain values reads as one.
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
  // Pass `post` to send it with `method` (POST unless told otherwise) instead of GETting: as JSON, or a FormData as multipart.
  // Every other failure throws an Error whose message the Operator can act on. All SnipeIt functions go through here.
  // Each thrown Error carries its FailureKind, and an HTTP error its status.
  async function request<T>(path: string, post?: object, method = 'POST', timeout = TIMEOUT): Promise<T | SnipeItError> {
    const failure = (kind: FailureKind, message: string, extra?: object) => Object.assign(new Error(message), { kind, ...extra })
    const unreachable = (extra?: object) => failure('unreachable', `Can't reach Snipe-IT at ${config.baseUrl}. Check your network connection and server URL in Settings.`, extra)
    // A server that is reachable but slow isn't a network problem; don't send the Operator to check one.
    const failed = (e: unknown) => (e as Error).name === 'TimeoutError'
      ? failure('timeout', `Snipe-IT at ${config.baseUrl} took longer than ${timeout / 1000} seconds to answer. It may be busy; try again.`)
      : unreachable()
    const send = async () => {
      try {
        return await fetch(api + path, {
          signal: AbortSignal.timeout(timeout),
          redirect: 'error',
          headers: { Authorization: `Bearer ${config.apiKey}`, Accept: 'application/json', ...(post && !(post instanceof FormData) && { 'Content-Type': 'application/json' }) },
          ...(post && { method, body: post instanceof FormData ? post : JSON.stringify(post) }),
        })
      } catch (e) {
        throw failed(e)
      }
    }
    let res = await send(), text: string
    // Retry-After is in seconds; without a readable one, Snipe-IT's throttle window is a minute.
    const retryAfter = (r: Response) => {
      const header = r.headers.get('Retry-After')?.trim() ?? ''
      return /^\d+$/.test(header) ? Number(header) : 60
    }
    // Snipe-IT throttles its API (120 requests a minute by default) and refuses the rest before doing anything, so a refused
    // request is safe to send again once the wait it names is over. A Report reads one Asset at a time.
    for (let tries = 0; res.status === 429 && tries < 3; tries++) {
      await new Promise((done) => setTimeout(done, Math.min(retryAfter(res), 60) * 1000))
      res = await send()
    }
    // Snipe-IT answers a wrong, revoked or expired key and a deactivated account alike, on purpose; the app doesn't guess.
    if (res.status === 401)
      throw failure('key', 'Snipe-IT rejected your API key. It may be wrong or revoked, or your Snipe-IT account may have been deactivated. Check the token in Settings, or ask a Superuser to check your account.')
    // Still over Snipe-IT's requests a minute after those tries.
    if (res.status === 429) {
      const wait = retryAfter(res)
      throw failure('rateLimited', `Snipe-IT is limiting requests; try again in ${wait} second${wait === 1 ? '' : 's'}.`, { status: 429, retryAfter: wait })
    }
    // The proxy in front of Snipe-IT can't reach it.
    if ([502, 503, 504].includes(res.status)) throw unreachable({ status: res.status })
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
    // An Import with rows that failed answers 500 with each row's errors; processImport, the only caller it reaches, reads them.
    if ((body as { status?: unknown } | undefined)?.status === 'import-errors') return body as T
    if (!res.ok) {
      const answer = body as { messages?: unknown; message?: unknown } | undefined
      const snipeItReason = reason(answer?.messages ?? answer?.message)
      throw failure(res.status === 403 ? 'forbidden' : 'refused', `Snipe-IT returned HTTP ${res.status}${snipeItReason ? `: ${snipeItReason}` : ''}`, { status: res.status })
    }
    if (body === undefined)
      throw new Error(`${config.baseUrl} did not answer like Snipe-IT. Check the server URL in Settings.`)
    return body as T | SnipeItError
  }

  const isError = (body: unknown): body is SnipeItError => (body as SnipeItError)?.status === 'error'

  // The Asset with exactly this Asset Tag, or null; no search fallback, so a Workflow scan never acts on a near match.
  async function assetByTag(tag: string): Promise<Asset | null> {
    if (typeof tag !== 'string' || !tag) throw new Error('Invalid Asset Tag')
    const body = await request<RawAsset>(`/hardware/bytag/${encodeURIComponent(tag)}`)
    // Snipe-IT answers an unknown Asset Tag with a 404 or a 200-with-error, depending on version.
    return isError(body) ? null : toAsset(body, today())
  }

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

  // The Damaged Report (#69 §3): Assets whose Status Label is Damaged (by name, as #59 decided), when they became
  // Damaged, and what their newest live Repair intake recorded. Damaged since is the open Repair Maintenance's start, else
  // that Repair intake's date, else not recorded (set Damaged by hand). Each Asset's Activity is searched PAGE_BATCH at a time.
  async function damaged(now: Date): Promise<Report> {
    const label = (await allRows<StatusLabel>('/statuslabels')).find((l) => l.name.trim().toLowerCase() === 'damaged')
    if (!label) throw new Error('Snipe-IT has no Status Label named Damaged.')
    const [assets, openMaintenances] = await Promise.all([allRows<RawAsset>(`/hardware?status_id=${label.id}`), allRows<RawMaintenance>('/maintenances?completed=false')])
    // Repair intake opens one Repair Maintenance (#59); should an Asset have more, the newest start is the one Incoming repair closes (#60).
    const started = new Map<number, string>()
    for (const m of openMaintenances) {
      const start = dayOf(m.start_date)
      if (m.asset && start && (m.maintenance_type || m.asset_maintenance_type || '').trim().toLowerCase() === 'repair' && start > (started.get(m.asset.id) ?? ''))
        started.set(m.asset.id, start)
    }
    // "repair" finds Repair intake and Incoming repair notes however their spacing was typed, and their undos; the parser
    // picks them out (#63 §5). A live Incoming repair ends a Damaged spell, so only a Repair intake after the newest one counts.
    // ponytail: the newest 20 hits, far more than one Asset's repairs; an undo whose step is older than those would
    // leave that step live. Page further if that ever happens.
    const intakeOf = async (id: number) => {
      const body = await request<{ rows: RawActivity[] }>(`/reports/activity?item_type=asset&item_id=${id}&search=repair&sort=created_at&order=desc&limit=20`)
      if (isError(body)) throw new Error(reason(body.messages))
      // item_id also matches entries that only target the Asset, such as its Maintenance's; only the Asset's own count.
      const oldestFirst = body.rows.filter((r) => r.item?.type === 'asset' && r.item.id === id).sort((a, b) => (a.created_at?.datetime ?? '').localeCompare(b.created_at?.datetime ?? '') || a.id - b.id)
      let intake: (HistoryEntry & { from: string; text: string }) | undefined
      for (const e of liveEntries(oldestFirst.map((r) => ({ ...toHistoryEntry(r), from: r.target?.name ?? '' })))) {
        const n = parseWorkflowNote(e.note)
        if (!n || n.undo) continue
        if (n.workflow === 'Incoming repair') intake = undefined
        else if (n.workflow === 'Repair intake') intake = { ...e, text: n.text ?? '' }
      }
      return intake
    }
    const intakes: Awaited<ReturnType<typeof intakeOf>>[] = []
    for (let i = 0; i < assets.length; i += PAGE_BATCH) intakes.push(...await Promise.all(assets.slice(i, i + PAGE_BATCH).map((a) => intakeOf(a.id))))
    const rows = assets.map((raw, i) => {
      const a = toAsset(raw, now), intake = intakes[i]
      const since = started.get(a.id) ?? (intake?.when.slice(0, 10) || null)
      return { since, cells: [a.assetTag, a.name, a.model, since ?? 'Not recorded', since ? String(Math.max(0, -daysFrom(now, since))) : 'Not recorded',
        intake?.from ?? '', intake?.operator ?? '', intake?.text ?? '', started.has(a.id) ? 'Open' : 'None'] }
    })
    return {
      columns: ['Asset Tag', 'Name', 'Asset Model', 'Damaged since', 'Days Damaged', 'Taken in from', 'Operator', 'What happened', 'Maintenance'],
      // Oldest since is longest Damaged; not recorded goes last.
      rows: rows.sort((x, y) => (x.since ?? '9').localeCompare(y.since ?? '9')).map((r) => r.cells),
      capped: false,
    }
  }

  // The Activity Report newest first, down to its first entry before `from`. Each page starts where the last one's rows
  // ended: a server may cap pages below PAGE_LIMIT. An entry without a date can't be placed, and mustn't end it either.
  async function* activitySince(from?: string, actionType?: string): AsyncGenerator<RawActivity> {
    for (let offset = 0; ; ) {
      const params = new URLSearchParams({ limit: String(PAGE_LIMIT), offset: String(offset), sort: 'created_at', order: 'desc', ...(actionType && { action_type: actionType }) })
      const page = await request<{ total: number; rows: RawActivity[] }>(`/reports/activity?${params}`)
      if (isError(page)) throw new Error(reason(page.messages))
      for (const r of page.rows) {
        const day = dayOf(r.created_at)
        if (from && day && day < from) return
        yield r
      }
      offset += page.rows.length
      if (!page.rows.length || offset >= page.total) return
    }
  }

  async function statusLabels(): Promise<StatusLabel[]> {
    // ponytail: first 500 status labels; a school has a handful.
    const body = await request<{ rows: StatusLabel[] }>('/statuslabels?limit=500')
    if (isError(body)) throw new Error(reason(body.messages))
    return body.rows.map(({ id, name }) => ({ id, name }))
  }

  // A page of a List. Filters and sort arrive from the screen over IPC, so only known ones reach the URL.
  async function listPage<K extends ListKind>(kind: K, { search, filters = {}, sort, order, offset = 0, view }: ListQuery, limit: number, timeout?: number): Promise<ListPage<K>> {
    if (!Object.hasOwn(LISTS, kind)) throw new Error(`Unknown list: ${kind}`)
    if ((search !== undefined && typeof search !== 'string') || typeof filters !== 'object' || filters === null) throw new Error('Invalid search or filters')
    if (view !== undefined && (kind !== 'assets' || !Object.hasOwn(ASSET_VIEWS, view))) throw new Error(`Unknown View: ${view}`)
    const spec = LISTS[kind]
    const { path = spec.path, filter } = view ? ASSET_VIEWS[view] : {}
    const params = new URLSearchParams({ limit: String(limit), offset: String(Number.isSafeInteger(offset) && offset > 0 ? offset : 0) })
    if (search?.trim()) params.set('search', search.trim())
    for (const [key, value] of Object.entries(filters)) {
      if (value === '' || value === undefined) continue
      if (typeof value !== 'string') throw new Error(`Invalid filter: ${key}`)
      const allowed = Object.hasOwn(spec.filters, key) ? spec.filters[key] : undefined
      if (!allowed || !(allowed === 'id' ? /^[1-9]\d*$/.test(value) : allowed.includes(value))) throw new Error(`Invalid filter: ${key}`)
      if (key === 'user_id') params.set('assigned_to', value), params.set('assigned_type', 'App\\Models\\User')
      else params.set(key, value)
    }
    // The View's own condition, over any filter box for the same thing (the List hides that box).
    if (filter?.[0] === 'status_id') {
      // The Status Label named Damaged, found by name in any case, ignoring outer spaces, as the Damaged Report finds it.
      const label = (await statusLabels()).find((l) => l.name.trim().toLowerCase() === filter[1].toLowerCase())
      if (!label) return { total: 0, rows: [], why: `Snipe-IT has no Status Label named ${filter[1]}, so no Asset is ${filter[1]}.` }
      params.set('status_id', String(label.id))
    } else if (filter) params.set(...filter)
    // Any List can also go in id order, which rows added meanwhile can't shift (for paging through all of it).
    const sorts: Record<string, string> = { id: 'id', ...LIST_SORTS[kind] }
    if (sort && Object.hasOwn(sorts, sort)) params.set('sort', sorts[sort]), params.set('order', order === 'asc' ? 'asc' : 'desc')
    const page = await request<{ total: number; rows: unknown[] }>(`${path}?${params}`, undefined, undefined, timeout)
    if (isError(page)) throw new Error(reason(page.messages))
    const now = today()
    return { total: page.total, rows: page.rows.map((r) => ({ ...spec.row(r as never, now), can: canFrom((r as RawRow).available_actions) })) as ListPage<K>['rows'] }
  }

  // id arrives from the screen over IPC; check it before it becomes part of a URL.
  const checkId = (id: number, what = 'Asset') => {
    if (!Number.isInteger(id)) throw new Error(`Invalid ${what} id: ${id}`)
  }
  // kind arrives from the screen over IPC; only a kind the app edits (or, to delete, a kind it deletes) reaches the URL.
  const checkKind = (kind: string, kinds: readonly string[] = EDIT_KINDS) => {
    if (!kinds.includes(kind)) throw new Error(`Unknown record: ${kind}`)
  }

  // Whether Snipe-IT lets the Operator's key read `path`. Only a refusal (HTTP 403) means no; any other error is a reason to show.
  async function allowed(path: string): Promise<boolean> {
    try {
      const body = await request(path)
      if (isError(body)) throw new Error(reason(body.messages))
      return true
    } catch (e) {
      // A refusal is the answer; anything else (offline…) is an error.
      if ((e as Partial<Failure>).kind === 'forbidden') return false
      throw e
    }
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
    // The Fieldset brings its Custom Fields; Snipe-IT's /fieldsets/{id}/fields answers only a POST.
    const set = await request<{ fields: { rows: { name: string; db_column_name: string; type: string; format: string; required: number | boolean; field_values_array: string[] | null }[] } }>(`/fieldsets/${model.fieldset.id}`)
    if (isError(set)) throw new Error(reason(set.messages))
    return set.fields.rows.map((c) => ({
      key: c.db_column_name, label: c.name, required: !!c.required,
      ...(c.field_values_array?.length ? { type: c.type === 'checkbox' ? 'choices' as const : 'choice' as const, options: c.field_values_array }
        : { type: c.type === 'textarea' ? 'textarea' as const : c.format === 'DATE' ? 'date' as const : c.format === 'NUMERIC' ? 'number' as const : 'text' as const }),
    }))
  }

  // Outstanding Temp checkouts (#61 §2): of these Assets, the checked-out ones whose Expected Checkin has a time of day and
  // whose current Checkout (last_checkout) has a Temp tag, its own or one an undo put back. Only Checkouts mentioning "Temp"
  // are asked for (the parser reads tags loosely, so a hand-typed `[Temp  checkout …]` counts), newest first, until past the oldest candidate's last Checkout: usually one request.
  // ponytail: only the dashboard calls it yet; the End-of-day reminder, Automatic check-in and the Out on temp View will.
  // ponytail: untagged Checkouts aren't fetched, so a tag counts if it's no older than last_checkout. That misreads a web UI
  // Checkout backdated to before an older tag, or an untagged one in the tag's minute; fetching every Checkout would fix it.
  async function outstandingTemp(assets: Asset[]): Promise<Set<number>> {
    const since = new Map(assets.flatMap((a) => (a.assignee && a.lastCheckout && a.expectedCheckin && a.expectedCheckin.length > 10 ? [[a.id, a.lastCheckout]] : [])))
    const temp = new Set<number>()
    if (!since.size) return temp
    const oldest = [...since.values()].sort()[0]
    for (let offset = 0; ; ) {
      const params = new URLSearchParams({ action_type: 'checkout', item_type: 'asset', search: 'Temp', sort: 'created_at', order: 'desc', limit: String(PAGE_LIMIT), offset: String(offset) })
      const page = await request<{ total: number; rows: RawActivity[] }>(`/reports/activity?${params}`)
      if (isError(page)) throw new Error(reason(page.messages))
      for (const r of page.rows) {
        // To the minute: Snipe-IT logs the Checkout a moment after it sets last_checkout.
        const when = r.created_at?.datetime.slice(0, 16) ?? ''
        if (when && when < oldest) return temp
        const from = r.item?.type === 'asset' ? since.get(r.item.id) : undefined
        const note = from !== undefined && when >= from && parseWorkflowNote(plainText(r.note ?? ''))
        if (note && (note.undo ? note.due : note.workflow === 'Temp checkout')) temp.add(r.item!.id)
      }
      offset += page.rows.length
      if (!page.rows.length || offset >= page.total) return temp
    }
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
    // Where Reports and the test email go: only ever the Operator's own address.
    async operatorEmail(): Promise<string> {
      const user = await request<{ email?: string | null }>('/users/me')
      if (isError(user)) throw new Error(reason(user.messages))
      if (!user.email) throw new Error('Your Snipe-IT account has no email address. Add one to your user in Snipe-IT.')
      return user.email
    },
    async locations(): Promise<StatusLabel[]> {
      return (await allRows<StatusLabel>('/locations')).map(({ id, name }) => ({ id, name }))
    },
    assetByTag,
    async lookup(query: string): Promise<LookupResult> {
      const tag = query.trim()
      if (!tag) return { exact: false, assets: [], others: [] }
      const exact = await assetByTag(tag)
      if (exact) return { exact: true, assets: [exact] }
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

    // One Label PDF for all the Asset Tags (Snipe-IT leaves out ones it doesn't have), built from Snipe-IT's label settings so
    // it matches the web UI's, base64. null when Snipe-IT can't make Labels over the API: an older Snipe-IT has no endpoint
    // (404, or 405 where GET /hardware/{id} holds the path), and one on the legacy label engine answers 500. The app then prints
    // its own. ponytail: any 500 falls back, as the legacy engine's reason comes translated to the Operator's language; narrow
    // it if a broken server should say so instead. ponytail: one request however many tags; split it if a big one times out.
    async labelPdf(assetTags: string[]): Promise<string | null> {
      if (!Array.isArray(assetTags) || !assetTags.length || !assetTags.every((t) => typeof t === 'string' && t)) throw new Error('Invalid Asset Tag')
      const body = await request<{ payload?: { pdf?: unknown } }>('/hardware/labels', { asset_tags: assetTags }).catch((e: Error & { status?: number }) => {
        if (e.status === 405 || e.status === 500) return null
        throw e
      })
      const pdf = body && !isError(body) ? body.payload?.pdf : null
      // "JVBERi" is "%PDF" in base64.
      return typeof pdf === 'string' && pdf.startsWith('JVBERi') ? pdf : null
    },

    statusLabels,

    // One page of a List.
    async list<K extends ListKind>(kind: K, query: ListQuery = {}): Promise<ListPage<K>> {
      return listPage(kind, query, LIST_PAGE)
    },

    // Every row of a List as searched, filtered and sorted on screen, for its CSV, up to the Report row cap. Each page starts
    // where the last one's rows ended: a server may cap pages below PAGE_LIMIT. ponytail: offset paging, so a row added or
    // removed meanwhile can shift one into the next page or out of the export; fine for a snapshot, id order if it matters.
    async exportList<K extends ListKind>(kind: K, query: Omit<ListQuery, 'offset'> = {}): Promise<{ rows: ListPage<K>['rows']; capped: boolean }> {
      const rows: ListPage<K>['rows'] = []
      for (let offset = 0; ; ) {
        const page = await listPage(kind, { ...query, offset }, PAGE_LIMIT, PAGE_TIMEOUT)
        rows.push(...page.rows)
        offset += page.rows.length
        if (rows.length >= REPORT_MAX) return { rows: rows.slice(0, REPORT_MAX), capped: page.total > REPORT_MAX }
        if (!page.rows.length || offset >= page.total) return { rows, capped: false }
      }
    },

    // A report's rows. Snipe-IT can't filter its log by date, or by kind without one item, so the Activity Report pages
    // newest first, keeps what's in range, and stops once it's past `from`. Overdue and Warranty expiring use the dashboard's rules.
    // Snipe-IT decides which Assets are Audit due (its Audit warning setting) and Audit late; Last audited and End of life read every Asset.
    async report(kind: ReportKind, { from, to, itemType, actionType, locationId, categoryId }: ReportQuery = {}): Promise<Report> {
      // The query arrives from the screen over IPC.
      if (!REPORTS.includes(kind)) throw new Error(`Unknown report: ${kind}`)
      for (const date of [from, to]) if (date !== undefined && date !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(String(date))) throw new Error('Dates must be YYYY-MM-DD')
      if (itemType && !(ACTIVITY_ITEM_TYPES as readonly string[]).includes(itemType)) throw new Error(`Unknown record type: ${itemType}`)
      if (actionType && !(ACTIVITY_ACTIONS as readonly string[]).includes(actionType)) throw new Error(`Unknown action: ${actionType}`)
      for (const [id, what] of [[locationId, 'Location'], [categoryId, 'Category']]) if (id !== undefined && id !== '' && !/^[1-9]\d*$/.test(String(id))) throw new Error(`Invalid ${what} id: ${id}`)
      const inRange = (day: string) => (!from || day >= from) && (!to || day <= to)
      if (kind === 'activity') {
        const rows: string[][] = []
        for await (const r of activitySince(from, actionType)) {
          if (!inRange(dayOf(r.created_at) ?? '') || (itemType && r.item?.type !== itemType)) continue
          // Full, and one more matches: it's cut short.
          if (rows.length === REPORT_MAX) return { columns: ACTIVITY_COLUMNS, rows, capped: true }
          const e = toHistoryEntry(r)
          rows.push([e.when, e.action, e.operator, itemTypeName[r.item?.type as keyof typeof itemTypeName] ?? r.item?.type ?? '', r.item?.name ?? '', e.detail, e.note])
        }
        return { columns: ACTIVITY_COLUMNS, rows, capped: false }
      }
      const now = today()
      if (kind === 'tempHistory') {
        // From now, not from `to`, so a Temp checkout returned after the range still gets its return (#69 §4).
        // ponytail: without From it reads the whole log, with no row cap to stop early; pick a From on a big log.
        const byAsset = new Map<number, (HistoryEntry & { id: number; at: string; user: string; item: string })[]>()
        for await (const r of activitySince(from)) {
          if (r.item?.type !== 'asset') continue
          const list = byAsset.get(r.item.id) ?? byAsset.set(r.item.id, []).get(r.item.id)!
          list.push({ ...toHistoryEntry(r), id: r.id, at: r.created_at?.datetime ?? '', user: r.target?.name ?? '', item: r.item.name })
        }
        const found: { assetId: number; id: number; at: string; out: string; cells: string[] }[] = []
        for (const [assetId, entries] of byAsset) {
          // Oldest first by id: a Move's Checkin and Checkout can share a second. An undo and what it undid drop out, so
          // the Temp tag an undo puts back never starts a row, and an undone return leaves its Temp checkout open.
          const live = liveEntries(entries.sort((a, b) => a.id - b.id))
          live.forEach((e, i) => {
            const tag = e.action === 'Checkout' ? parseWorkflowNote(e.note) : null
            const due = tag?.workflow === 'Temp checkout' && tag.due
            if (!due || !inRange(e.when.slice(0, 10))) return
            // Whatever its note: a web UI Checkin returns it too.
            const back = live.slice(i + 1).find((x) => x.action === 'Checkin')
            // To the second: a return 40 seconds after the due minute is late.
            const late = overdueOf(back ? new Date(back.at.replace(' ', 'T')) : now, due)
            const by = back && (parseAppNote(back.note)?.tag === 'Automatic check-in' ? 'Automatic check-in' : back.operator)
            found.push({ assetId, id: e.id, at: e.at, out: e.when, cells: [e.user, e.operator, due, back?.when ?? 'Still out', by || '', late ? lateness(late) : ''] })
          })
        }
        // To the second, then by id: the shown minute can't order two Checkouts in the same minute.
        found.sort((a, b) => b.at.localeCompare(a.at) || b.id - a.id)
        const capped = found.length > REPORT_MAX
        // ponytail: every Asset for its Asset Tag and Name (the log's item name mixes both); one dropped since shows the log's name.
        const assets = found.length ? new Map((await allRows<RawAsset>('/hardware')).map((a) => [a.id, a])) : new Map<number, RawAsset>()
        return {
          columns: ['Checked out', 'Asset Tag', 'Name', 'User', 'Operator', 'Due', 'Returned', 'Returned by', 'Late by'],
          rows: found.slice(0, REPORT_MAX).map(({ assetId, out, cells }) => {
            const a = assets.get(assetId)
            return [out, a?.asset_tag ?? '', a?.name ?? byAsset.get(assetId)![0].item, ...cells]
          }),
          capped,
        }
      }
      const params = new URLSearchParams({ ...(locationId && { location_id: locationId }), ...(categoryId && { category_id: categoryId }) })
      const inPlace = (path: string) => (params.size ? `${path}?${params}` : path)
      if (AUDIT_REPORTS.includes(kind) || kind === 'endOfLife') {
        const path = kind === 'auditDue' ? '/hardware/audit/due' : kind === 'auditLate' ? '/hardware/audit/overdue' : '/hardware'
        // Paged in id order (see allRows) and sorted here, so a row added mid-load can't shift a page.
        const assets = (await allRows<RawAsset>(inPlace(path))).map((r) => toAsset(r, now))
        if (kind === 'endOfLife')
          return {
            columns: ['Asset Tag', 'Name', 'Asset Model', 'Status Label', 'Assignee', 'Location', 'Purchase date', 'End of life', 'Days left'],
            // Snipe-IT may list Archived Assets (its "show archived" setting). Oldest first puts the past ones first, then the soonest.
            rows: assets.filter((a) => a.endOfLife && a.statusMeta !== 'archived' && inRange(a.endOfLife) && daysFrom(now, a.endOfLife) <= END_OF_LIFE_DAYS)
              .sort((x, y) => x.endOfLife!.localeCompare(y.endOfLife!))
              .map((a) => [a.assetTag, a.name, a.model, a.status, a.assignee?.name ?? '', a.location, a.purchaseDate ?? '', a.endOfLife!, String(daysFrom(now, a.endOfLife!))]),
            capped: false,
          }
        // Every audit Report starts with these columns; the to-do ones add the Assignee before the audit dates.
        const assetColumns = ['Asset Tag', 'Name', 'Asset Model', 'Category', 'Location']
        const assetCells = (a: Asset) => [a.assetTag, a.name, a.model, a.category, a.location]
        const auditCells = (a: Asset) => [a.lastAudited ?? 'Never', a.nextAudit ?? '']
        if (kind === 'lastAudited')
          return {
            columns: [...assetColumns, 'Last audited', 'Next audit'],
            // A blank From includes Assets never Audited; they're the oldest, so they come first.
            rows: assets.filter((a) => (a.lastAudited ? inRange(a.lastAudited) : !from)).sort((a, b) => (a.lastAudited ?? '').localeCompare(b.lastAudited ?? ''))
              .map((a) => [...assetCells(a), ...auditCells(a)]),
            capped: false,
          }
        // Soonest first is most days late first too.
        const listed = assets.filter((a) => a.nextAudit && inRange(a.nextAudit)).sort((a, b) => a.nextAudit!.localeCompare(b.nextAudit!))
        const due = kind === 'auditDue'
        return {
          columns: [...assetColumns, 'Assignee', 'Last audited', 'Next audit', due ? 'Days left' : 'Days late'],
          rows: listed.map((a) => [...assetCells(a), a.assignee?.name ?? '', ...auditCells(a), String(due ? daysFrom(now, a.nextAudit!) : -daysFrom(now, a.nextAudit!))]),
          capped: false,
        }
      }
      if (kind === 'maintenances') {
        // Snipe-IT can't filter Maintenances by date, so every one is read and those started in the range kept.
        const rows = (await allRows<RawMaintenance>('/maintenances')).flatMap((m) => {
          const started = m.start_date?.date ?? ''
          if (!inRange(started)) return []
          // Open or completed as Snipe-IT counts it (completed_at set, on v8.6+, even for one completed before the upgrade).
          const completed = dayOf('completed_at' in m ? m.completed_at : m.completion_date)
          // Snipe-IT counts the days once it's completed; while open, it's the days so far (none yet if it starts later).
          const days = completed ? String(m.asset_maintenance_time ?? '') : started ? String(Math.max(0, -daysFrom(now, started))) : ''
          return [{ id: m.id, started, cells: [started, completed ?? 'Open', days, m.asset?.asset_tag ?? '', m.asset?.name ?? '', m.title ?? '',
            m.maintenance_type || m.asset_maintenance_type || '', m.supplier?.name ?? '', Number(m.is_warranty) ? 'Yes' : 'No',
            m.cost ? plainNumber(m.cost) : '', m.created_by?.name ?? '', m.completed_by?.name ?? ''] }]
        })
        return {
          columns: ['Started', 'Completed', 'Days', 'Asset Tag', 'Name', 'Title', 'Type', 'Supplier', 'Warranty repair', 'Cost', 'Opened by', 'Completed by'],
          rows: rows.sort((a, b) => b.started.localeCompare(a.started) || b.id - a.id).map((r) => r.cells),
          capped: false,
        }
      }
      if (kind === 'statusLocation') {
        // One row per Location and Status Label pair. Archived Assets are left out, as Snipe-IT's own listing leaves them out by default.
        const pairs = new Map<string, { location: string; status: string; type: string; assets: number; cost: number }>()
        for (const r of await allRows<RawAsset>(inPlace('/hardware'))) {
          const type = r.status_label?.status_type ?? ''
          if (type === 'archived') continue
          const location = r.location?.name || '(no Location)'
          const status = r.status_label?.name ?? ''
          // By id, so two Locations with the same name stay apart.
          const key = `${r.location?.id ?? ''}:${r.status_label?.id ?? ''}`
          const pair = pairs.get(key) ?? pairs.set(key, { location, status, type, assets: 0, cost: 0 }).get(key)!
          pair.assets++
          // In cents, so the total doesn't drift; a blank or unreadable cost adds nothing.
          pair.cost += Math.round(Number(plainNumber(r.purchase_cost ?? '')) * 100) || 0
        }
        return {
          columns: ['Location', 'Status Label', 'Status type', 'Assets', 'Purchase cost (total)'],
          rows: [...pairs.values()].sort((a, b) => a.location.localeCompare(b.location) || b.assets - a.assets || a.status.localeCompare(b.status))
            .map((p) => [p.location, p.status, p.type, String(p.assets), (p.cost / 100).toFixed(2)]),
          capped: false,
        }
      }
      if (kind === 'checkedOut') {
        // Who holds what: Assets checked out to a Location are left out.
        const held = (await allRows<RawAsset>(inPlace('/hardware'))).filter((r) => r.assigned_to?.type === 'user')
        const byTag = (a: RawAsset, b: RawAsset) => a.asset_tag.localeCompare(b.asset_tag, undefined, { numeric: true })
        return {
          columns: ['User', 'Employee No.', 'Asset Tag', 'Name', 'Asset Model', 'Category', 'Checked out', 'Expected Checkin'],
          rows: held.sort((a, b) => a.assigned_to!.name.localeCompare(b.assigned_to!.name) || a.assigned_to!.id - b.assigned_to!.id || byTag(a, b)).map((r) => {
            const a = toAsset(r, now)
            return [r.assigned_to!.name, r.assigned_to!.employee_number ?? '', a.assetTag, a.name, a.model, a.category, dayOf(r.last_checkout) ?? '', a.expectedCheckin ?? '']
          }),
          capped: false,
        }
      }
      if (kind === 'damaged') return damaged(now)
      const assets = (await allRows<RawAsset>('/hardware')).map((r) => toAsset(r, now))
      if (kind === 'overdue')
        return {
          columns: ['Asset Tag', 'Name', 'Assignee', 'Expected Checkin', 'How late'],
          rows: assets.filter((a) => a.overdue !== null && inRange(a.expectedCheckin!.slice(0, 10))).sort((a, b) => b.overdue!.minutes - a.overdue!.minutes)
            .map((a) => [a.assetTag, a.name, a.assignee?.name ?? '', a.expectedCheckin!, lateness(a.overdue!)]),
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
      return { kind, id, name: String(body.name ?? ''), fields: fieldsOf(body), can: canFrom(body.available_actions), ...(kind === 'categories' && { categoryType: text(body.category_type) }) }
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
    async remove(kind: DeleteKind, id: number): Promise<void> {
      checkKind(kind, DELETE_KINDS)
      checkId(id, 'record')
      const result = await request(`${LISTS[kind].path}/${id}`, {}, 'DELETE')
      if (isError(result)) throw new Error(reason(result.messages))
    },

    // Whether the Operator's own account may manage permissions: Snipe-IT lets only a superuser read groups, so ask it.
    canManagePermissions: () => allowed('/groups?limit=1'),
    // Whether the Operator's own account has Snipe-IT's import permission, which listing Imports needs.
    canImport: () => allowed('/imports'),

    // The CSVs uploaded before, newest first; Snipe-IT shows an Operator who isn't a superuser only their own.
    async imports(): Promise<ImportFile[]> {
      const body = await request<RawImport[]>('/imports')
      if (isError(body)) throw new Error(reason(body.messages))
      return body.map(toImportFile)
    },

    // Uploads a CSV (its text, read by the screen) under its file name.
    async uploadImport(name: string, csv: string): Promise<ImportFile> {
      if (typeof name !== 'string' || typeof csv !== 'string') throw new Error('Invalid CSV')
      const form = new FormData()
      form.append('files[]', new Blob([csv], { type: 'text/csv' }), name)
      const body = await request<{ files: RawImport[] }>('/imports', form, 'POST', PAGE_TIMEOUT)
      if (isError(body)) throw new Error(reason(body.messages))
      return toImportFile(body.files[0])
    },

    // Imports an uploaded CSV as `type`, with each heading matched to one of the type's fields ('' or left out: not matched,
    // so Snipe-IT reads it only if the heading is a field's name). update: Records that already exist are updated, not skipped.
    async processImport(id: number, type: ImportType, mapping: Record<string, string>, update: boolean): Promise<ImportResult> {
      checkId(id, 'import')
      if (!Object.hasOwn(IMPORT_TYPES, type)) throw new Error(`Unknown import type: ${type}`)
      if (typeof mapping !== 'object' || mapping === null) throw new Error('Invalid mapping')
      const fields = new Set(IMPORT_FIELDS[type].map(([key]) => key))
      const matched = Object.fromEntries(Object.entries(mapping).filter(([, field]) => field !== ''))
      for (const field of Object.values(matched)) if (!fields.has(field)) throw new Error(`Invalid field: ${field}`)
      // An older Snipe-IT updates when import-update is sent at all, whatever its value, so skipping leaves it out.
      const result = await request<{ status?: string; messages?: unknown }>(`/imports/process/${id}`, { 'import-type': type, ...(update === true && { 'import-update': true }), 'column-mappings': matched }, 'POST', IMPORT_TIMEOUT)
      if (result.status === 'import-errors' && result.messages && typeof result.messages === 'object') return { ok: false, errors: result.messages as Record<string, unknown> }
      // Any other refusal (a form error, another Operator's CSV…) is one message, not rows.
      if (isError(result)) throw new Error(reason(result.messages) || "Snipe-IT didn't import it.")
      return { ok: true }
    },

    // Deletes an uploaded CSV; Snipe-IT answers one it won't delete (another Operator's) with a warning, which is passed on.
    async deleteImport(id: number): Promise<void> {
      checkId(id, 'import')
      const result = await request<{ status?: string; messages?: unknown }>(`/imports/${id}`, {}, 'DELETE')
      if (isError(result) || result.status === 'warning') throw new Error(reason(result.messages) || "Snipe-IT didn't delete it.")
    },

    // A User's own permissions and groups; anyone who may view the User may see them.
    async userAccess(id: number): Promise<UserAccess> {
      checkId(id, 'User')
      const user = await request<{ permissions?: unknown; groups?: { rows?: Named[] } | null }>(`/users/${id}`)
      if (isError(user)) throw new Error(reason(user.messages))
      const permissions = Object.fromEntries(Object.entries(permissionsOf(user.permissions)).map(([k, v]) => [k, String(v)]).filter(([, v]) => v === '1' || v === '-1'))
      return { permissions, groups: (user.groups?.rows ?? []).flatMap((g) => (g ? [{ id: g.id, name: g.name }] : [])) }
    },

    // Every permission group (superuser only).
    async groups(): Promise<StatusLabel[]> {
      return (await allRows<StatusLabel>('/groups')).map(({ id, name }) => ({ id, name }))
    },

    async group(id: number): Promise<Group> {
      checkId(id, 'group')
      const g = await request<{ id: number; name: string; permissions?: unknown }>(`/groups/${id}`)
      if (isError(g)) throw new Error(reason(g.messages))
      return { id: g.id, name: g.name, permissions: Object.fromEntries(Object.entries(permissionsOf(g.permissions)).map(([k, v]) => [k, String(v) === '1' ? '1' : '0'])) }
    },

    // A User's groups, all at once: the ones listed are kept or added, the rest removed.
    async setUserGroups(userId: number, groupIds: number[]): Promise<void> {
      checkId(userId, 'User')
      if (!Array.isArray(groupIds)) throw new Error('Invalid groups')
      for (const g of groupIds) checkId(g, 'group')
      const result = await request(`/users/${userId}`, { groups: groupIds }, 'PATCH')
      if (isError(result)) throw new Error(reason(result.messages))
    },

    // A group's name and what it grants. Only permission keys and grant/not reach Snipe-IT, which drops keys it doesn't know.
    async saveGroup(id: number, name: string, permissions: Record<string, string>): Promise<SaveResult> {
      checkId(id, 'group')
      if (typeof name !== 'string' || typeof permissions !== 'object' || permissions === null) throw new Error('Invalid group')
      for (const [k, v] of Object.entries(permissions)) if (!/^[a-z_]+(\.[a-z_]+)*$/.test(k) || (v !== '1' && v !== '0')) throw new Error(`Invalid permission: ${k}`)
      const result = await request(`/groups/${id}`, { name, permissions: JSON.stringify(permissions) }, 'PATCH')
      if (!isError(result)) return { ok: true, id }
      const fieldMessages = result.messages && typeof result.messages === 'object' ? (result.messages as Record<string, unknown>) : null
      return fieldMessages
        ? { ok: false, message: "Snipe-IT didn't save it: see the fields marked below.", errors: Object.fromEntries(Object.entries(fieldMessages).map(([k, m]) => [k, reason(m)])) }
        : { ok: false, message: reason(result.messages) || "Snipe-IT didn't save it.", errors: {} }
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

    // A Workflow's exact User match on Enter (#57): a whole employee number (all digits, e.g. a scanned ID card) or an
    // email first, then a username. Only rows whose field really is the text count, whatever the server's filter does.
    async exactUsers(text: string): Promise<UserCard[]> {
      const q = String(text).trim()
      if (!q) return []
      const fields: ('employee_num' | 'email' | 'username')[] = [...(/^\d+$/.test(q) ? ['employee_num' as const] : q.includes('@') ? ['email' as const] : []), 'username']
      for (const field of fields) {
        const body = await request<{ rows: RawUser[] }>(`/users?${field}=${encodeURIComponent(q)}&limit=2`)
        if (isError(body)) throw new Error(reason(body.messages))
        const rows = body.rows.filter((r) => String(r[field] ?? '').toLowerCase() === q.toLowerCase())
        if (rows.length) return rows.map(toUserCard)
      }
      return []
    },
    // Snipe-IT's User picker (Users only): each row's text tells namesakes apart, "name (username) - #employee number".
    async userSelectlist(text: string): Promise<StatusLabel[]> {
      const q = String(text).trim()
      if (!q) return []
      const body = await request<{ results: { id: number; text: string }[] }>(`/users/selectlist?search=${encodeURIComponent(q)}`)
      if (isError(body)) throw new Error(reason(body.messages))
      return body.results.map((r) => ({ id: r.id, name: r.text }))
    },
    async userCard(id: number): Promise<UserCard> {
      checkId(id, 'User')
      const body = await request<RawUser>(`/users/${id}`)
      if (isError(body)) throw new Error(reason(body.messages))
      return toUserCard(body)
    },
    searchLocations: (text: string) => searchTargets('locations', text),

    // Checkout allowed: no Assignee and a deployable status. Snipe-IT requires a status, so the current one is sent
    // unless another is given (Snipe-IT accepts only a deployable one).
    async checkout(id: number, { targetType, targetId, statusId, fromStatusId, fromLocationId, expectedCheckin, note }: CheckoutOptions): Promise<void> {
      if (!Object.hasOwn(TARGET_NAME, targetType)) throw new Error('An Asset can only be checked out to a User, a Location or another Asset.')
      checkId(targetId, TARGET_NAME[targetType])
      if (statusId !== undefined) checkId(statusId, 'status')
      if (expectedCheckin && !/^\d{4}-\d{2}-\d{2}( \d{2}:\d{2})?$/.test(expectedCheckin)) throw new Error(`Expected Checkin must be YYYY-MM-DD or YYYY-MM-DD HH:MM, not ${expectedCheckin}`)
      const body = await current(id)
      if (body.assigned_to) throw new Error(`${body.asset_tag} is already checked out to ${body.assigned_to.name}. Check it in first.`)
      if (fromStatusId !== undefined && body.status_label?.id !== fromStatusId) throw new Error(`${body.asset_tag} is '${body.status_label?.name ?? 'no status'}' now`)
      if (fromLocationId !== undefined && (body.location?.id ?? null) !== fromLocationId) throw new Error(`${body.asset_tag} is at ${body.location?.name ?? 'no Location'} now`)
      if (body.status_label?.status_meta !== 'deployable')
        throw new Error(`${body.asset_tag} is "${body.status_label?.name ?? 'no status'}", which can't be checked out.`)
      const result = await request(`/hardware/${id}/checkout`, {
        status_id: statusId ?? body.status_label.id,
        checkout_to_type: targetType,
        [`assigned_${targetType}`]: targetId,
        ...(expectedCheckin && { expected_checkin: expectedCheckin }),
        ...(note?.trim() && { note: note.trim() }),
      })
      if (isError(result)) throw new Error(reason(result.messages))
    },

    // Checkin allowed: the Asset has an Assignee. Snipe-IT requires a status, so the current one is kept unless another is chosen.
    async checkin(id: number, { statusId, locationId, note, fromAssignee, fromStatusId, noDefaultLocation }: CheckinOptions): Promise<void> {
      if (locationId !== undefined) checkId(locationId, 'Location')
      const body = await current(id)
      if (!body.assigned_to) throw new Error(`${body.asset_tag} is not checked out, so there is nothing to check in.`)
      if (fromAssignee && (body.assigned_to.type !== fromAssignee.type || body.assigned_to.id !== fromAssignee.id)) throw new Error(`${body.asset_tag} is checked out to ${body.assigned_to.name} now`)
      if (fromStatusId !== undefined && body.status_label?.id !== fromStatusId) throw new Error(`${body.asset_tag} is '${body.status_label?.name ?? 'no status'}' now`)
      if (noDefaultLocation && body.rtd_location) throw new Error(`${body.asset_tag} has a Default Location now, ${body.rtd_location.name}; a Checkin would move it there`)
      const result = await request(`/hardware/${id}/checkin`, {
        status_id: statusId ?? body.status_label?.id,
        ...(locationId !== undefined && { location_id: locationId }),
        ...(note?.trim() && { note: note.trim() }),
      })
      if (isError(result)) throw new Error(reason(result.messages))
    },

    // The Health warnings' checks: three small requests at once, each failing on its own. Runs on open and Refresh only.
    async health(): Promise<Health> {
      const failed = (e: Error): Failed => ({ error: e.message })
      const total = async (path: string) => {
        const body = await request<{ total?: unknown }>(`${path}?limit=1`)
        if (isError(body)) throw new Error(reason(body.messages))
        if (typeof body.total !== 'number') throw new Error(`Snipe-IT didn't send a total for ${path.slice(1)}.`)
        return body.total
      }
      const [probe, auditLate, auditDue] = await Promise.all([
        request<{ version?: unknown }>('/version').then(
          (body): Health['probe'] => isError(body) ? { error: reason(body.messages) }
            : typeof body.version === 'string' ? { version: body.version } : { error: "Snipe-IT didn't say which version it runs." },
          (e: Error & Partial<Failure>): Health['probe'] =>
            e.kind === 'unreachable' || e.kind === 'timeout' ? { warning: 'unreachable', message: e.message }
            // /version needs no permission, so a 403 on it is about the whole key (since v8.8: 2FA not enrolled, or User-Agent blocked).
            : e.kind === 'key' || e.kind === 'forbidden' ? { warning: 'key', message: e.message }
            : failed(e)),
        total('/hardware/audit/overdue').catch(failed),
        total('/hardware/audit/due').catch(failed),
      ])
      return { probe, auditLate, auditDue }
    },

    // One Audit: sets the last audited date to now and the next audit date to nextAudit, or Snipe-IT's audit interval when left out.
    // Never sends a Location: an Audit doesn't move an Asset. Snipe-IT v8.6.3+'s single-Asset route.
    async audit(id: number, { nextAudit, note }: AuditOptions): Promise<Audited> {
      if (nextAudit !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(nextAudit)) throw new Error(`Next audit must be a date (YYYY-MM-DD), not ${nextAudit}`)
      const text = appNote('Audit', note)
      const was = dayOf((await current(id)).next_audit_date)
      const result = await request<{ payload?: { next_audit_date?: RawAsset['next_audit_date'] } }>(`/hardware/${id}/audit`, { note: text, ...(nextAudit && { next_audit_date: nextAudit }) })
      if (isError(result)) throw new Error(reason(result.messages))
      return { was, next: dayOf(result.payload?.next_audit_date) }
    },

    // Fetches only what the requested pieces need; one piece failing (e.g. a permission error) leaves the others.
    async dashboard(requested: DashboardPiece[]): Promise<Dashboard> {
      // The list arrives from the screen over IPC; keep only pieces this module knows.
      const pieces = DASHBOARD_PIECES.filter((p) => Array.isArray(requested) && requested.includes(p))
      const now = today()
      const wants = (...p: DashboardPiece[]) => p.some((x) => pieces.includes(x))
      // The charts and tables all come from the Asset list, so it's fetched once for them all.
      const raw = wants(...ASSET_PIECES) ? allRows<RawAsset>('/hardware') : undefined
      const assets = wants('overdue', 'expiring') ? raw!.then((rows) => rows.map((r) => toAsset(r, now))) : undefined
      // The plain list leaves Archived Assets out unless Snipe-IT's "show archived in list" is on, so the Status Label chart
      // asks for them too. Only that chart: the Category and Location bars match the Assets List they open, which leaves
      // them out the same way. If they can't load, the chart shows without them.
      const archived = wants('assets') ? allRows<RawAsset>('/hardware?status=Archived').catch((): RawAsset[] => []) : undefined
      // Without Status Labels, each label has no color and takes its kind from its Assets.
      const statusLabels = wants('assets')
        ? allRows<{ id: number; type?: string; color: string | null }>('/statuslabels').then((rows) => new Map(rows.map((l) => [l.id, l])), () => new Map())
        : undefined
      const entry = async <T>(piece: DashboardPiece, work: () => Promise<T>): Promise<[DashboardPiece, T | Failed] | []> =>
        !pieces.includes(piece) ? [] : [piece, await work().catch((e: Error) => ({ error: e.message }))]
      // Most first; ties by name, so the order holds from one load to the next.
      const tally = <T extends Tally = Tally>(rows: RawAsset[], of: (r: RawAsset) => Omit<T, 'count'>): T[] => {
        const counts = new Map<number | null, T>()
        for (const r of rows) {
          const t = of(r)
          const seen = counts.get(t.id)
          if (seen) seen.count++
          else counts.set(t.id, { ...t, count: 1 } as T)
        }
        return [...counts.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
      }
      const named = (n: Named, none: string) => (n ? { id: n.id, name: n.name } : { id: null, name: none })
      const entries = await Promise.all([
        entry('assets', async () => {
          const [list, shelved, labels] = await Promise.all([raw!, archived!, statusLabels!])
          const listed = new Set(list.map((a) => a.id))
          return tally<StatusTally>([...list, ...shelved.filter((a) => !listed.has(a.id))], ({ status_label: s }) => {
            const label = s && labels.get(s.id)
            // An Asset's status_meta says "deployed" for a checked-out Asset whose label is deployable.
            const type = label?.type ?? (s?.status_meta === 'deployed' ? 'deployable' : s?.status_meta ?? '')
            return s ? { id: s.id, name: s.name, type, color: label?.color ?? null } : { id: null, name: 'No Status Label', type, color: null }
          })
        }),
        entry('categories', async () => tally(await raw!, (r) => named(r.category, 'No Category'))),
        entry('locations', async () => tally(await raw!, (r) => named(r.location, 'No Location'))),
        // The Temp marks failing (say a 403 on the Activity Report) leaves the list, unmarked, with the reason.
        entry('overdue', async () => {
          const list = await assets!
          const temp = await outstandingTemp(list).catch((e: Error) => e)
          const rows = list
            .flatMap((a) => (a.overdue === null ? [] : [{ ...a, expectedCheckin: a.expectedCheckin!, overdue: a.overdue, temp: temp instanceof Set && temp.has(a.id) }]))
            .sort((a, b) => b.overdue.minutes - a.overdue.minutes)
          return temp instanceof Error ? { rows, tempError: temp.message } : { rows }
        }),
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
