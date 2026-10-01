import type { ListKind, ListRows } from './snipeit'

// What Export writes, shared by the window (Export CSV) and the Report scheduler (the emailed CSV), so the two match.

// The stocked kinds share their columns: what it is, where it is, and how many are left
// (Available for Accessories and Components, Remaining for Consumables, as CONTEXT.md names them).
const stockColumns = <K extends 'accessories' | 'consumables' | 'components'>(left: string): ListColumn<K>[] => [
  { key: 'name', label: 'Name' },
  { key: 'category', label: 'Category' },
  { key: 'manufacturer', label: 'Manufacturer', hidden: true },
  { key: 'location', label: 'Location' },
  { key: 'qty', label: 'Quantity' },
  { key: 'remaining', label: left },
]
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** A List's column: the first is always shown and opens the row; the rest the Operator can hide. hidden = hidden until shown.
 * text: the cell's text where it isn't the row's field as is (an Assignee's name). */
export type ListColumn<K extends ListKind> = { key: keyof ListRows[K] & string; label: string; hidden?: true; text?: (row: ListRows[K]) => string | undefined }
/** The same columns without their List's row type, for code that works on whichever List is open. */
export type AnyColumn = { key: string; label: string; hidden?: true; text?: (row: never) => string | undefined }
export const LIST_COLUMNS: { [K in ListKind]: ListColumn<K>[] } = {
  assets: [
    { key: 'assetTag', label: 'Asset Tag' },
    { key: 'name', label: 'Name' },
    { key: 'status', label: 'Status' },
    { key: 'model', label: 'Asset Model' },
    { key: 'category', label: 'Category' },
    { key: 'location', label: 'Location' },
    { key: 'assignee', label: 'Assignee', text: (a) => a.assignee?.name },
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
    { key: 'item', label: 'Item', text: (r) => r.item?.name },
    { key: 'detail', label: 'Detail' },
    { key: 'note', label: 'Note' },
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
  categories: [{ key: 'name', label: 'Name' }, { key: 'type', label: 'Type', text: (r) => capital(r.type) }, { key: 'items', label: 'Items' }],
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
  statuslabels: [{ key: 'name', label: 'Name' }, { key: 'type', label: 'Type', text: (r) => capital(r.type) }, { key: 'assets', label: 'Assets' }],
}

// Which of a List's columns show, from a stored list of keys (the first column always, ones it no longer has dropped);
// its default ones when there's none.
export function shownColumns(kind: ListKind, stored: unknown): string[] {
  const all: AnyColumn[] = LIST_COLUMNS[kind]
  if (Array.isArray(stored)) return all.filter((c, i) => i === 0 || stored.includes(c.key)).map((c) => c.key)
  return all.filter((c) => !c.hidden).map((c) => c.key)
}

/** A cell's text as the List shows it (a status, an Assignee's name); empty where the List shows a dash. */
export function cellText(c: AnyColumn, row: object): string {
  const v = [c.text?.(row as never), (row as Record<string, unknown>)[c.key]].find((x) => typeof x === 'string' || typeof x === 'number')
  return v === undefined ? '' : String(v)
}

// A List as Export saves it: its visible Columns in the order shown, each cell the text the List shows.
export function exportTable(kind: ListKind, shown: string[], rows: object[]) {
  const columns = (LIST_COLUMNS[kind] as AnyColumn[]).filter((c) => shown.includes(c.key))
  return { columns: columns.map((c) => c.label), rows: rows.map((row) => columns.map((c) => cellText(c, row))) }
}

// Every cell quoted, so commas, quotes and line breaks survive. A cell a spreadsheet would run as a formula
// (=, +, -, @ first) gets a leading ' so a note can't become one. The byte-order mark lets Excel read it as UTF-8.
export function toCsv(columns: string[], rows: string[][]): string {
  const cell = (v: string) => `"${(/^[=+\-@\t\r]/.test(v) ? `'${v}` : v).replace(/"/g, '""')}"`
  return '\uFEFF' + [columns, ...rows].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n'
}

/** "12 rows", "1 row", "0 rows". */
export const rowCount = (n: number) => `${n.toLocaleString('en-US')} ${n === 1 ? 'row' : 'rows'}`
/** The day as "YYYY-MM-DD", local, so a late-evening export isn't stamped with tomorrow (UTC). */
export const localDate = (d: Date) => [d.getFullYear(), d.getMonth() + 1, d.getDate()].map((n) => String(n).padStart(2, '0')).join('-')
/** A CSV's file name: what it holds ("Activity Report") and the day, e.g. activity-report-2026-10-01.csv. */
export const csvName = (name: string, d: Date) => `${name.toLowerCase().replace(/ /g, '-')}-${localDate(d)}.csv`
