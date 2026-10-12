// A pretend Snipe-IT with made-up data, for developing and screenshotting without real student records.
// Run: node scripts/mock-snipeit.mjs [port]   then use http://127.0.0.1:<port> and any API token in Settings.
// For timing, make it bigger and slower like a real server: MOCK_SCALE=20 (240 Assets and 64 Users each),
// MOCK_LATENCY_MS=150 (every request) and MOCK_ROW_MS=5 (each row a list returns).
// To see how the app takes a failure, MOCK_FAIL answers every request the same way: 401 (API key rejected), 403 (refused),
// 429 (too many requests, with Retry-After: MOCK_RETRY_AFTER seconds, 23 unless set; set it empty to send none),
// 503 (the proxy can't reach Snipe-IT), or hang (never answers, so the app's timeout fires).
// MOCK_ALL_AUDITED=1 moves every next audit date at least 40 days ahead, so nothing is Audit late or Audit due.
// It also stands in for GitHub's latest Snipe-IT release (v8.8.1, a patch past its /version), so the app never asks GitHub:
// start the app from source with SNIPEIT_RELEASES_URL=http://127.0.0.1:<port>/repos/grokability/snipe-it/releases/latest.
// ponytail: covers only the endpoints and filters the app uses; changes live in memory until it stops.
// It answers any number of requests at once, where a real server has a few workers; parallel requests look better here.
import { createServer } from 'node:http'

const port = Number(process.argv[2] ?? 8765)
const scale = Number(process.env.MOCK_SCALE ?? 1)
const latency = Number(process.env.MOCK_LATENCY_MS ?? 0)
const rowCost = Number(process.env.MOCK_ROW_MS ?? 0)
const failAll = process.env.MOCK_FAIL
const retryAfter = process.env.MOCK_RETRY_AFTER ?? '23'
const named = (list) => list.map((name, i) => ({ id: i + 1, name }))
const pick = (list, n) => list[n % list.length]

const statuses = [
  ['Ready to Deploy', 'deployable', '#2ea043'], ['Deployed', 'deployed', '#388bfd'], ['Damaged', 'undeployable', '#d29922'],
  ['Broken', 'undeployable', '#e5534b'], ['Pending', 'pending', null], ['Archived', 'archived', '#6e7681'],
// status_type is the label's own type; status_meta says 'deployed' for a deployable label on a checked-out Asset.
].map(([name, status_meta, color], i) => ({ id: i + 1, name, status_type: status_meta === 'deployed' ? 'deployable' : status_meta, status_meta, color }))
const campus = { id: 1, name: 'Main Campus', parent: null, city: 'Springfield' }
const locations = [campus, ...['Library', 'Room 101', 'Room 204', 'Science Lab', 'Gym', 'Front Office', 'IT Office'].map((name, i) => ({ id: i + 2, name, parent: campus, city: 'Springfield' }))]
const categories = named(['Chromebook', 'Laptop', 'Projector', 'Tablet'])
const manufacturers = named(['HP', 'Dell', 'Epson', 'Apple', 'Lenovo'])
const departments = named(['Science', 'Math', 'English', 'Front Office', 'IT'])
const models = [
  ['HP Chromebook 14 G7', '14-G7', 0, 0], ['Lenovo 300e Chromebook', '82CE', 4, 0], ['Dell Latitude 3440', 'L3440', 1, 1],
  ['Epson PowerLite 118', 'V11H', 2, 2], ['iPad 10th Gen', 'A2696', 3, 3],
].map(([name, model_number, m, c], i) => ({ id: i + 1, name, model_number, manufacturer: manufacturers[m], category: categories[c] }))
const first = ['Avery', 'Blake', 'Casey', 'Devon', 'Emery', 'Finley', 'Harper', 'Jordan', 'Kai', 'Logan', 'Morgan', 'Parker', 'Quinn', 'Riley', 'Sage', 'Taylor']
const last = ['Testwell', 'Sampleton', 'Mockford', 'Demoski', 'Fakely', 'Placeholder', 'Example', 'Dummyworth']
const users = Array.from({ length: 64 * scale }, (_, i) => {
  const [f, l] = [pick(first, i), pick(last, i * 3 + Math.floor(i / 16))]
  // A few deactivated Users, some still holding Assets.
  return { id: i + 1, name: `${f} ${l}`, username: `${f[0]}${l}${i + 1}`.toLowerCase(), employee_num: i % 10 === 9 ? null : `E-${2001 + i}`, email: `${f}.${l}${i + 1}@example.org`.toLowerCase(), department: pick(departments, i), location: pick(locations.slice(1), i), activated: i % 13 !== 5 }
})
const prices = [289, 249, 1149.99, 649.5, 349] // per Asset Model
const day = (offset) => new Date(Date.now() + offset * 864e5).toISOString().slice(0, 10)
// Activity times are local, as Snipe-IT sends them in its own timezone.
const local = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().replace('T', ' ').slice(0, 19)
// Expected Checkin as Snipe-IT v8.7+ sends it: a datetime, with a date-only one at midnight.
const dueBack = (v) => (v ? { datetime: v.length > 10 ? v : `${v} 00:00:00`, formatted: v } : null)
// A due time of day some minutes ago, in local time, so the dashboard has Assets Overdue by minutes and hours today.
const minutesAgo = (m) => new Date(Date.now() - (m + new Date().getTimezoneOffset()) * 6e4).toISOString().slice(0, 16).replace('T', ' ') + ':00'
const dueOf = (i) => (i === 1 ? minutesAgo(40) : i === 19 ? minutesAgo(125) : i % 2 ? `${day(-(i % 30))} 14:50:00` : day(-(i % 30)))
const assets = Array.from({ length: 240 * scale }, (_, i) => {
  const model = pick(models, i % 7 ? 0 : i)
  const status = i % 11 === 3 ? statuses[2] : i % 17 === 5 ? statuses[3] : i % 23 === 7 ? statuses[5] : i % 3 === 0 ? statuses[0] : statuses[1]
  const toUser = status.status_meta === 'deployed' && i % 5 !== 0
  const holder = status.status_meta !== 'deployed' ? null : toUser ? { ...pick(users, i), employee_number: pick(users, i).employee_num, type: 'user' } : { ...pick(locations.slice(1), i), type: 'location' }
  // A few with no Serial (none or blank), no Asset Model (deleted), or no Location (some of those checked out, which don't count as missing it).
  const noLocation = holder?.type !== 'location' && i % 29 === 11
  // Next audit from 40 days late to about a year ahead, a year after the last; some never audited, a few with no audit date at all.
  const nextAudit = i % 19 === 0 ? null : ((i * 37) % 420) - 40 + (process.env.MOCK_ALL_AUDITED ? 80 : 0)
  return {
    id: i + 1, asset_tag: `NOMMA-${String(1000 + i).padStart(6, '0')}`, name: `${model.category.name.slice(0, 2).toUpperCase()}-${String(i + 1).padStart(3, '0')}`,
    // Shaped like Snipe-IT's hardware rows: the manufacturer and model number sit beside the Asset Model, not in it.
    serial: i % 41 === 9 ? null : i % 41 === 30 ? '' : `5CD${(2381000 + i * 37).toString(36).toUpperCase()}`, model: i % 97 === 50 ? null : { id: model.id, name: model.name }, model_number: model.model_number, manufacturer: model.manufacturer,
    category: model.category, status_label: status,
    // A few unassigned Assets have no Location, for the dashboard's No Location bar.
    location: holder?.type === 'location' ? holder : noLocation || (!holder && i % 13 === 6) ? null : pick(locations.slice(1), i), assigned_to: holder,
    // Like Snipe-IT, a Checkin with no Location moves the Asset here, or to no Location when there's none.
    rtd_location: i % 4 === 2 ? null : pick(locations.slice(1), i + 1),
    purchase_date: { date: day(-400 - i) }, warranty_expires: { date: day(30 + i * 4) }, warranty_months: model.category.name === 'Chromebook' ? '36 months' : null, expected_checkin: holder && i % 9 === 1 ? dueBack(dueOf(i)) : null,
    // Shaped like Snipe-IT v8.7+: last_audit_date is a datetime, next_audit_date a date.
    last_audit_date: nextAudit === null || i % 7 === 2 ? null : { datetime: `${day(nextAudit - 365)} 10:30:00`, formatted: day(nextAudit - 365) },
    next_audit_date: nextAudit === null ? null : { date: day(nextAudit), formatted: day(nextAudit) },
    // End of life from 90 days past to about 20 months ahead, a few with none.
    asset_eol_date: i % 13 === 0 ? null : { date: day(((i * 53) % 700) - 90), formatted: day(((i * 53) % 700) - 90) },
    // Snipe-IT formats money as text ("1,149.99") and sends null for none.
    purchase_cost: i % 8 === 6 ? null : prices[model.id - 1].toLocaleString('en-US', { minimumFractionDigits: 2 }),
    // When the current Checkout was made: the same moment as its Checkout in the Activity Report below.
    last_checkout: holder ? { datetime: local(new Date(Date.now() - (i + 1) * 36e5)), formatted: day(-(i + 1) / 24) } : null,
    notes: i % 13 === 4 ? 'Cracked screen, waiting on a part' : null,
    custom_fields: { 'MAC Address': { field: '_snipeit_mac_address_1', value: `00:1A:2B:${[i >> 8, i & 255, 7].map((n) => n.toString(16).padStart(2, '0')).join(':')}`.toUpperCase() } },
  }
})
// A checked-out Asset someone set to Pending while it was out: Bulk return checks it in but keeps the label.
// Snipe-IT's status_meta says 'deployed' for any checked-out Asset; status_type keeps the label's own type.
assets[1].status_label = { ...statuses[4], status_meta: 'deployed' }
// The stocked kinds, a few of each.
const stock = (list) => list.map((r, i) => ({ id: i + 1, notes: null, manufacturer: null, category: null, ...r }))
// min_amt as Snipe-IT sends it: null when none is set, and for 0 too (its LicensesTransformer). Two are Running out.
const licenses = stock([{ name: 'Office Suite A3', seats: 300, free_seats_count: 42, min_amt: 20, license_name: 'Main Campus' }, { name: 'Classroom Filter', seats: 500, free_seats_count: 120, min_amt: null, notes: 'Renews each July' },
  { name: 'Typing Tutor', seats: 30, free_seats_count: 3, min_amt: 5 }, { name: 'Lab Design Suite', seats: 25, free_seats_count: 0, min_amt: null }])
const accessories = stock([{ name: 'USB-C Charger 65W', model_number: 'CHG-65', qty: 80, remaining_qty: 23 }, { name: 'Wireless Mouse', model_number: 'M-220', qty: 40, remaining_qty: 31, notes: 'For the Library cart' }])
const consumables = stock([{ name: 'Toner 206A Black', item_no: '206A-BK', qty: 12, remaining: 5 }, { name: 'Copy Paper (case)', item_no: 'PAPER-10', qty: 40, remaining: 31 }])
const components = stock([{ name: '8GB DDR4 SODIMM', serial: null, qty: 20, remaining: 14 }, { name: '256GB NVMe SSD', serial: null, qty: 10, remaining: 6, notes: 'Chromebook repair spares' }])
const log = []
const act = (action_type, asset, target, note = null, when = new Date(), operator = 'Demo Operator') =>
  log.unshift({ id: log.length + 1, action_type, created_at: { datetime: local(when) }, created_by: { id: 900, name: operator },
    item: { id: asset.id, name: `${asset.asset_tag} (${asset.name})`, type: 'asset' }, target: target && { id: target.id, name: target.name, type: target.type ?? 'user' }, note })
// A checked-out Asset due at a time of day is a Temp checkout: its current Checkout carries the tag. Except NOMMA-001055,
// checked in and out again in the web UI since its tagged Checkout; and NOMMA-001037's tag was put back by an undo.
for (const a of assets.slice(0, 90).reverse()) {
  const when = new Date(Date.now() - a.id * 36e5)
  const temp = a.assigned_to && a.expected_checkin?.datetime.slice(11, 16) > '00:00'
  const tag = temp && `[Temp checkout | due: ${a.expected_checkin.datetime.slice(0, 16)}]`
  if (temp && a.id !== 56) {
    act('checkout', a, a.assigned_to, a.id === 38 ? `[Undo] Bulk return ${tag}` : `${tag} Charger included`, when)
    continue
  }
  if (temp) act('checkout', a, a.assigned_to, tag, new Date(when - 2 * 864e5))
  const action = temp || a.id % 4 ? 'checkout' : a.id % 3 ? 'checkin from' : 'update'
  act(action, a, action === 'update' ? null : a.assigned_to ?? pick(users, a.id), a.id % 6 ? null : 'Charger included', when)
}
// Damaged Assets, three ways: taken in by Repair intake with its Repair Maintenance open, taken in without one (its
// Maintenance step failed, or an Asset that wasn't checked out), or set Damaged by hand in the web UI with neither.
// One also had a second Repair intake that was undone.
const maintenances = []
const maintain = (asset, start, type = 'Repair', completed = null) => maintenances.push({ id: maintenances.length + 1, asset: { id: asset.id, name: asset.name, asset_tag: asset.asset_tag },
  name: `${asset.asset_tag} damaged`, title: `${asset.asset_tag} damaged`, maintenance_type: type, asset_maintenance_type: '', start_date: { date: day(start), formatted: day(start) }, completed_at: completed && { datetime: `${day(completed)} 15:00:00` } })
const at = (offset, hour) => new Date(`${day(offset)}T${String(hour).padStart(2, '0')}:00:00Z`)
const repairs = ['cracked screen', 'won’t power on', 'keyboard missing keys', 'hinge broken', 'water damage', 'charging port loose']
assets.filter((a) => a.status_label.name === 'Damaged').forEach((a, k) => {
  const since = -(k * 4 + 2)
  if (k % 3 === 0) {
    act('checkin from', a, pick(users, a.id), `[Repair intake] ${pick(repairs, k)}`, at(since, 14))
    maintain(a, since)
  } else if (k % 3 === 1) {
    act('note added', a, null, `[Repair intake] ${pick(repairs, k)}`, at(since, 15))
    if (k === 1) act('note added', a, null, '[Repair intake] wrong Asset scanned', at(since + 1, 9)), act('note added', a, null, '[Undo] Repair intake', at(since + 1, 10))
  }
})
// Not Damaged-since sources: a finished repair, and an open Maintenance that isn't a repair.
maintain(assets[1], -60, 'Repair', -50)
maintain(assets[4], -6, 'Upgrade')
// Temp checkouts, for Temp checkout history: returned late, on time and by Automatic check-in, one undone, and one whose
// Bulk return was undone, so it's still out (and Overdue). [ago days, HH:MM] is local time that many days back.
{
  const at = (ago, hm) => { const d = new Date(Date.now() - ago * 864e5); d.setHours(...hm.split(':').map(Number), 0, 0); return d }
  const stamp = (d) => local(d).slice(0, 16)
  const temp = (a, user, out, due, ...after) => {
    act('checkout', a, user, `[Temp checkout | due: ${stamp(due)}]`, out)
    for (const [action, note, when, operator] of after) act(action, a, user, note, when, operator)
  }
  const [late, sameDay, onTime, auto, undone] = assets.filter((a) => a.id > 90 && a.status_label.status_meta === 'deployable')
  const out = assets.find((a) => a.id > 90 && a.assigned_to?.type === 'user')
  const user = (n) => ({ ...pick(users, n), type: 'user' })
  temp(late, user(3), at(6, '08:00'), at(6, '14:50'), ['checkin from', '[Bulk return]', at(4, '09:10'), 'Library Desk'])
  temp(sameDay, user(4), at(5, '08:15'), at(5, '15:00'), ['checkin from', '[Bulk return]', at(5, '15:40')])
  temp(onTime, user(5), at(4, '10:00'), at(4, '15:00'), ['checkin from', null, at(4, '14:20'), 'Library Desk'])
  temp(auto, user(6), at(3, '09:30'), at(3, '15:00'), ['checkin from', '[Automatic check-in]', at(3, '15:00')])
  temp(undone, user(7), at(2, '11:00'), at(2, '15:00'), ['checkin from', '[Undo] Temp checkout', at(2, '11:01')])
  const due = at(1, '15:00')
  temp(out, out.assigned_to, at(1, '08:30'), due, ['checkin from', '[Bulk return]', at(1, '15:20')],
    ['checkout', `[Undo] Bulk return [Temp checkout | due: ${stamp(due)}]`, at(1, '15:22')])
  out.expected_checkin = dueBack(local(due))
}
log.sort((x, y) => y.created_at.datetime.localeCompare(x.created_at.datetime))

const text = (...fields) => fields.filter(Boolean).join(' ').toLowerCase()
const lists = {
  // Searches the fields and related names real Snipe-IT does (Asset::$searchableRelations), plus custom fields.
  hardware: { rows: () => assets, search: (a) => text(a.asset_tag, a.name, a.serial, a.notes, a.model?.name, a.model_number, a.manufacturer.name, a.category.name, a.status_label.name,
    a.location?.name, a.assigned_to?.name, ...Object.values(a.custom_fields).map((f) => f.value)), filters: {
    status_id: (a, v) => a.status_label.id === +v, location_id: (a, v) => a.location?.id === +v, model_id: (a, v) => a.model?.id === +v, category_id: (a, v) => a.category.id === +v,
    assigned_to: (a, v) => a.assigned_to?.type === 'user' && a.assigned_to.id === +v, status: (a, v) => (v === 'Deployed' ? !!a.assigned_to : v === 'Archived' ? a.status_label.status_meta === 'archived' : !a.assigned_to && a.status_label.status_meta === 'deployable'),
  }, sorts: { asset_tag: (a) => a.asset_tag, name: (a) => a.name, status: (a) => a.status_label.name, model: (a) => a.model?.name ?? '', category: (a) => a.category.name, location: (a) => a.location?.name, assigned_to: (a) => a.assigned_to?.name ?? '', serial: (a) => a.serial ?? '',
    next_audit_date: (a) => a.next_audit_date?.date ?? '', last_audit_date: (a) => a.last_audit_date?.datetime ?? '', asset_eol_date: (a) => a.asset_eol_date?.date ?? '',
    purchase_cost: (a) => a.purchase_cost?.replace(/,/g, '') ?? '' }, archived: (a) => a.status_label.status_meta === 'archived' },
  users: { rows: () => users.map((u) => ({ ...u, assets_count: assets.filter((a) => a.assigned_to?.type === 'user' && a.assigned_to.id === u.id).length })), search: (u) => text(u.name, u.username, u.email, u.department.name, u.location.name),
    // Like Snipe-IT, username, email and employee_num are exact matches.
    filters: { location_id: (u, v) => u.location.id === +v, department_id: (u, v) => u.department.id === +v, username: (u, v) => u.username === v, email: (u, v) => u.email === v, employee_num: (u, v) => u.employee_num === v, activated: (u, v) => String(Number(u.activated)) === v }, sorts: { last_name: (u) => u.name.split(' ')[1], username: (u) => u.username, assets_count: (u) => u.assets_count } },
  locations: { rows: () => locations.map((l) => ({ ...l, assets_count: assets.filter((a) => a.location?.id === l.id).length, assigned_assets_count: assets.filter((a) => a.assigned_to?.type === 'location' && a.assigned_to.id === l.id).length, users_count: users.filter((u) => u.location?.id === l.id).length })),
    search: (l) => text(l.name, l.city), filters: {}, sorts: { name: (l) => l.name, assets_count: (l) => l.assets_count } },
  models: { rows: () => models.map((m) => ({ ...m, assets_count: assets.filter((a) => a.model?.id === m.id).length, remaining: assets.filter((a) => a.model?.id === m.id && !a.assigned_to && a.status_label.status_meta === 'deployable').length })),
    search: (m) => text(m.name, m.model_number, m.manufacturer.name), filters: { category_id: (m, v) => m.category.id === +v }, sorts: { name: (m) => m.name, assets_count: (m) => m.assets_count } },
  'reports/activity': { rows: () => log, search: (r) => text(r.item?.name, r.target?.name, r.note), filters: { action_type: (r, v) => r.action_type === v, item_type: (r, v) => r.item?.type === v, item_id: (r, v) => r.item?.id === +v }, sorts: { created_at: (r) => r.created_at.datetime }, sort: 'created_at' },
  // Snipe-IT's completed filter: true for completed Maintenances, anything else for open ones.
  maintenances: { rows: () => maintenances, filters: { completed: (m, v) => !!m.completed_at === (v === 'true'), asset_id: (m, v) => m.asset.id === +v } },
  statuslabels: { rows: () => statuses }, categories: { rows: () => categories }, departments: { rows: () => departments },
  licenses: { rows: () => licenses, search: (r) => text(r.name, r.license_name, r.notes), sorts: { name: (r) => r.name, seats: (r) => r.seats, free_seats_count: (r) => r.free_seats_count } }, accessories: { rows: () => accessories, search: (r) => text(r.name, r.model_number, r.notes) },
  consumables: { rows: () => consumables, search: (r) => text(r.name, r.item_no, r.notes) }, components: { rows: () => components, search: (r) => text(r.name, r.notes) },
}

function listPage(spec, q) {
  let rows = spec.rows()
  // Snipe-IT's structured filter (only its is:null here: none or blank) replaces the search, as Snipe-IT's does.
  const filter = JSON.parse(q.get('filter') || '{}')
  for (const [key, v] of Object.entries(filter)) if (v === 'is:null') rows = rows.filter((r) => r[key] == null || r[key] === '')
  const search = q.get('filter') ? '' : q.get('search')?.toLowerCase()
  if (search && spec.search) rows = rows.filter((r) => spec.search(r).includes(search))
  for (const [key, test] of Object.entries(spec.filters ?? {})) if (q.get(key)) rows = rows.filter((r) => test(r, q.get(key)))
  // Like Snipe-IT with "show archived in list" off: the plain Asset list leaves Archived Assets out, but status_id or status=Archived lists them.
  if (spec.archived && !q.get('status_id') && q.get('status') !== 'Archived') rows = rows.filter((r) => !spec.archived(r))
  const by = spec.sorts?.[q.get('sort') ?? spec.sort]
  if (by) rows = [...rows].sort((a, b) => String(by(a)).localeCompare(String(by(b)), undefined, { numeric: true }) * (q.get('order') === 'asc' ? 1 : -1))
  const offset = Number(q.get('offset') ?? 0)
  return { total: rows.length, rows: rows.slice(offset, offset + Number(q.get('limit') ?? 50)) }
}

// The record kinds beyond Assets that the app browses, each with a few fields for its record page.
const suppliers = named(['Campus Tech Supply', 'EduDevices Inc.'])
const companies = named(['NOMMA'])
for (const a of assets) {
  Object.assign(a, { supplier: pick(suppliers, a.id), company: companies[0], order_number: `PO-${2024000 + (a.id % 12)}` })
  a.custom_fields ??= { 'MAC Address': { field: '_snipeit_mac_address_1', value: `00:1A:2B:00:${(a.id >> 8).toString(16).padStart(2, '0')}:${(a.id & 255).toString(16).padStart(2, '0')}`.toUpperCase() } }
}
const tally = (list, test) => list.filter(test).length
const makerOf = (a) => a.manufacturer ?? a.model.manufacturer
Object.assign(lists, {
  manufacturers: { rows: () => manufacturers.map((m) => ({ ...m, assets_count: tally(assets, (a) => makerOf(a).id === m.id) })), search: (m) => text(m.name), sorts: { name: (m) => m.name } },
  suppliers: { rows: () => suppliers.map((s) => ({ ...s, contact: 'Pat Vendor', phone: '555-0100', email: 'orders@example.org', assets_count: tally(assets, (a) => a.supplier.id === s.id) })), search: (s) => text(s.name), sorts: { name: (s) => s.name } },
  companies: { rows: () => companies.map((c) => ({ ...c, assets_count: assets.length, users_count: users.length })), search: (c) => text(c.name) },
})
lists.categories.rows = () => categories.map((c) => ({ ...c, category_type: 'asset', item_count: tally(assets, (a) => a.category.id === c.id) }))
lists.departments.rows = () => departments.map((d) => ({ ...d, location: campus, users_count: tally(users, (u) => u.department?.id === d.id) }))
lists.statuslabels.rows = () => statuses.map((s) => ({ ...s, type: s.status_meta, assets_count: tally(assets, (a) => a.status_label.id === s.id) }))
Object.assign(lists.hardware.filters, { manufacturer_id: (a, v) => makerOf(a).id === +v, supplier_id: (a, v) => a.supplier.id === +v, company_id: (a, v) => a.company.id === +v })
// A User made in the app may have no Location or department.
Object.assign(lists.users.filters, { company_id: () => true, location_id: (u, v) => u.location?.id === +v, department_id: (u, v) => u.department?.id === +v })
for (const k of ['licenses', 'accessories', 'consumables', 'components']) lists[k].filters = { ...lists[k].filters, category_id: (r, v) => r.category?.id === +v }
// Snipe-IT's audit routes: next audit within its Audit warning setting (30 days here), or past; never Archived Assets.
const auditable = (a) => a.next_audit_date && a.status_label.status_meta !== 'archived'
lists['hardware/audit/due'] = { ...lists.hardware, rows: () => assets.filter((a) => auditable(a) && a.next_audit_date.date >= day(0) && a.next_audit_date.date <= day(30)) }
lists['hardware/audit/overdue'] = { ...lists.hardware, rows: () => assets.filter((a) => auditable(a) && a.next_audit_date.date < day(0)) }
// More Maintenances, after the Damaged ones above, shaped like Snipe-IT v8.7+ (cost as formatted text, the type under maintenance_type): one every few days
// over the last four months, mostly Repairs, the newest still open.
const maintenanceTypes = ['Repair', 'Repair', 'Repair', 'Upgrade', 'Software Support']
maintenances.push(...Array.from({ length: 24 }, (_, i) => {
  const a = assets[(i * 41 + 3) % assets.length]
  const start = -120 + i * 5
  const time = i % 4 === 1 ? 3 : 6 + (i % 9)
  const open = start + time > -2
  const type = pick(maintenanceTypes, i)
  return {
    id: maintenances.length + i + 1, asset: { id: a.id, name: a.name, asset_tag: a.asset_tag }, title: `${type === 'Repair' ? pick(['Cracked screen', 'Keyboard replacement', 'Battery swap', 'Hinge repair'], i) : type} for ${a.name}`,
    maintenance_type: type, asset_maintenance_type: '', supplier: pick(suppliers, i), is_warranty: i % 3 === 0, cost: i % 5 === 4 ? null : (35 + ((i * 173) % 1400) + 0.5 * (i % 2)).toLocaleString('en-US', { minimumFractionDigits: 2 }),
    start_date: { date: day(start), formatted: day(start) }, completed_at: open ? null : { datetime: `${day(start + time)} 15:20:00`, formatted: day(start + time) },
    completed_by: open ? null : { id: 900, name: 'Demo Operator' }, asset_maintenance_time: open ? 0 : time, created_by: { id: 900, name: 'Demo Operator' },
  }
}))

// Creating, editing and deleting records, checked the way Snipe-IT checks them (a few of its rules).
// Chromebook Asset Models have a custom fieldset with a MAC Address.
const fieldset = { id: 1, name: 'Chromebooks', fields: [{ id: 1, name: 'MAC Address', db_column_name: '_snipeit_mac_address_1', type: 'text', format: 'MAC', required: 0, field_values_array: null }] }
for (const m of models) m.fieldset = m.category.name === 'Chromebook' ? { id: fieldset.id, name: fieldset.name } : null
// The kinds the app only deletes are kept here too, so a delete takes them out of their List.
const store = { hardware: assets, users, locations, models, categories, manufacturers, suppliers, departments, companies, statuslabels: statuses, ...Object.fromEntries(['licenses', 'accessories', 'consumables', 'components'].map((k) => [k, lists[k].rows()])) }
for (const k of ['licenses', 'accessories', 'consumables', 'components']) lists[k].rows = () => store[k]
const required = { hardware: ['asset_tag', 'model_id', 'status_id'], users: ['first_name', 'username'], locations: ['name'], licenses: ['name', 'seats', 'category_id'],
  accessories: ['name', 'qty', 'category_id'], consumables: ['name', 'qty', 'category_id'], components: ['name', 'qty', 'category_id'] }
const refs = { model_id: ['model', models], status_id: ['status_label', statuses], location_id: ['location', locations], rtd_location_id: ['rtd_location', locations], parent_id: ['parent', locations],
  category_id: ['category', categories], manufacturer_id: ['manufacturer', manufacturers], supplier_id: ['supplier', suppliers], company_id: ['company', companies], department_id: ['department', departments] }
function saveRecord(kind, body, row) {
  const errors = {}
  for (const f of required[kind]) if ((body[f] ?? row?.[f] ?? '') === '' && !(row && !(f in body))) errors[f] = [`The ${f.replace(/_id$/, '').replace(/_/g, ' ')} field is required.`]
  if (kind === 'hardware' && body.asset_tag && assets.some((a) => a.asset_tag === body.asset_tag && a !== row)) errors.asset_tag = ['The asset tag must be unique.']
  if (kind === 'users' && !row && body.password !== body.password_confirmation) errors.password = ['The password confirmation does not match.']
  if (Object.keys(errors).length) return { status: 'error', messages: errors, payload: null }
  const target = row ?? { id: Math.max(0, ...store[kind].map((r) => r.id)) + 1 }
  for (const [k, v] of Object.entries(body)) {
    if (k.startsWith('password')) continue
    if (k === 'groups') { target.groups = groupsOf(v); continue }
    if (refs[k]) target[refs[k][0]] = refs[k][1].find((r) => r.id === Number(v)) ?? null
    else if (k.startsWith('_snipeit_')) (target.custom_fields ??= {})[fieldset.fields.find((f) => f.db_column_name === k)?.name ?? k] = { field: k, value: v }
    else if (k === 'expected_checkin') target[k] = dueBack(v)
    else if (/date$|_checkin$/.test(k)) target[k] = v ? { date: v, formatted: v } : null
    // Snipe-IT keeps a minimum of 0, but sends it back as null, like none set.
    else if (k === 'min_amt') target[k] = Number(v) || null
    else target[k] = v
  }
  if (kind === 'users' && ('first_name' in body || 'last_name' in body)) target.name = [target.first_name, target.last_name].filter(Boolean).join(' ')
  if (kind === 'hardware') Object.assign(target, { category: target.model?.category ?? target.category ?? null, assigned_to: target.assigned_to ?? null, supplier: target.supplier ?? suppliers[0], company: target.company ?? companies[0], notes: target.notes ?? null })
  if (!row) store[kind].push(target)
  return { status: 'success', messages: row ? 'Updated.' : 'Created.', payload: target }
}

// Permissions. MOCK_OPERATOR=limited runs as an Operator who isn't a superuser: groups are refused, and each record's
// available_actions (what Snipe-IT lets the key do) allows Checkout and Checkin but not editing or deleting.
const limited = process.env.MOCK_OPERATOR === 'limited'
const groups = [
  { id: 1, name: 'IT Staff', permissions: { 'assets.view': '1', 'assets.create': '1', 'assets.edit': '1', 'assets.checkout': '1', 'assets.checkin': '1', 'users.view': '1' } },
  { id: 2, name: 'Library Aides', permissions: { 'assets.view': '1', 'assets.checkout': '1', 'assets.checkin': '1' } },
]
const groupsOf = (ids) => ({ total: ids.length, rows: ids.map((id) => ({ id, name: groups.find((g) => g.id === id)?.name ?? '' })) })
for (const u of users) Object.assign(u, { groups: groupsOf(u.id % 3 ? [2] : [1]), permissions: u.id === 1 ? { 'reports.view': '1', 'assets.delete': '-1' } : {} })
const actions = limited ? { checkout: true, checkin: true, update: false, delete: false, clone: false, audit: false } : { checkout: true, checkin: true, update: true, delete: true, clone: true, audit: true }
for (const r of [...assets, ...users, ...locations, ...models, ...categories, ...manufacturers, ...suppliers, ...departments, ...companies, ...statuses]) r.available_actions = actions
// Labels. The label endpoint answers with a one-page PDF naming the Asset Tags, standing in for Snipe-IT's label engine.
// MOCK_LABELS=legacy answers as a Snipe-IT on the legacy label engine does; MOCK_LABELS=none as one without the endpoint.
const labelEngine = process.env.MOCK_LABELS
function labelPdf(tags) {
  const text = `BT /F1 9 Tf 10 60 Td (Mock Snipe-IT Label) Tj 0 -16 Td (${tags.join(' ')}) Tj ET`
  const objects = ['<</Type/Catalog/Pages 2 0 R>>', '<</Type/Pages/Kids[3 0 R]/Count 1>>', '<</Type/Page/Parent 2 0 R/MediaBox[0 0 162 90]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>',
    `<</Length ${text.length}>>stream\n${text}\nendstream`, '<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>']
  let pdf = '%PDF-1.4\n'
  const offsets = objects.map((o, i) => [pdf.length, (pdf += `${i + 1} 0 obj\n${o}\nendobj\n`)][0])
  const xref = pdf.length
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`
  return Buffer.from(`${pdf}trailer\n<</Size ${objects.length + 1}/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF\n`).toString('base64')
}
// Imports. Each keeps its CSV's text; processing fails a row that leaves its name or Asset Tag empty, as Snipe-IT's
// validation would, and records the type and mapping like Snipe-IT does. MOCK_OPERATOR=limited has no import permission.
// ponytail: splits on every comma; the mock's CSVs have no quoted cells.
const csvRows = (text) => text.split(/\r?\n/).filter((l) => l.trim()).map((l) => l.split(','))
const imports = [{
  id: 1, file_path: '2026-09-28-101500-new-chromebooks.csv', name: '', filesize: '96 B', import_type: 'asset', created_at: '3 days ago',
  csv: 'Asset Tag,Serial,Model,Cart\nNOMMA-9001,5CD9001,HP Chromebook 14 G7,Cart 3\n,5CD9002,HP Chromebook 14 G7,Cart 3\n',
  field_map: { 'Asset Tag': 'asset_tag', Serial: 'serial', Model: 'asset_model' },
}]
const importOf = ({ csv, ...i }) => ({ ...i, header_row: csvRows(csv)[0] ?? [], first_row: csvRows(csv)[1] ?? [] })
const refused = { status: 'error', messages: 'You do not have permission to access this area.', payload: null }
// The methods each path answers, as Snipe-IT routes them; any other method or path gets Snipe-IT's catch-all 404.
// A new endpoint below needs its path here too.
const routes = [
  [/^(users\/me|users\/selectlist|version|reports\/activity|hardware\/bytag\/.+|hardware\/audit\/(due|overdue)|fieldsets\/\d+)$/, ['GET']],
  // GitHub's, outside /api/v1/.
  [/^\/repos\/grokability\/snipe-it\/releases\/latest$/, ['GET']],
  [/^(fieldsets\/\d+\/fields|hardware\/\d+\/(check(in|out)|audit)|imports\/process\/\d+)$/, ['POST']],
  ...(labelEngine === 'none' ? [] : [[/^hardware\/labels$/, ['POST']]]),
  [/^[a-z]+$/, ['GET', 'POST']],
  [/^[a-z]+\/\d+$/, ['GET', 'PATCH', 'PUT', 'DELETE']],
]
const noEndpoint = { status: 'error', message: '404 endpoint not found. Please check the API reference at https://snipe-it.readme.io/reference to find a valid API endpoint.', payload: null }

createServer(async (req, res) => {
  if (failAll === 'hang') return
  if (failAll) {
    const [status, body, headers] = {
      401: [401, { message: 'Unauthenticated.' }],
      403: [403, refused],
      429: [429, { message: 'Too Many Attempts.' }, retryAfter ? { 'Retry-After': retryAfter } : {}],
      503: [503, { message: 'Service Unavailable' }],
    }[failAll] ?? [500, { message: `Unknown MOCK_FAIL: ${failAll}` }]
    return res.writeHead(status, { 'Content-Type': 'application/json', ...headers }).end(JSON.stringify(body))
  }
  const url = new URL(req.url, 'http://x')
  const path = url.pathname.replace(/^\/api\/v1\//, '')
  const raw = req.method === 'GET' ? '' : await new Promise((ok) => { let s = ''; req.on('data', (c) => (s += c)).on('end', () => ok(s)) })
  const type = req.headers['content-type'] ?? ''
  // An upload is multipart; everything else JSON.
  const body = type.startsWith('multipart/') ? await new Response(raw, { headers: { 'Content-Type': type } }).formData() : JSON.parse(raw || '{}')
  const send = (value, status = 200) => setTimeout(() => (res.writeHead(status, { 'Content-Type': 'application/json' }), res.end(JSON.stringify(value))),
    latency + rowCost * (value?.rows?.length ?? 1))
  const fail = (messages) => send({ status: 'error', messages, payload: null })
  let m
  if (!routes.find(([route]) => route.test(path))?.[1].includes(req.method)) return send(noEndpoint, 404)
  if (path === 'users/me') return send({ id: 900, name: 'Demo Operator', email: 'demo.operator@nomma.net', permissions: limited ? {} : { superuser: '1' } })
  if (path === 'groups' || path.startsWith('groups/')) {
    if (limited) return send(refused, 403)
    if (path === 'groups') return send(listPage({ rows: () => groups }, url.searchParams))
    const g = groups.find((x) => x.id === Number(path.split('/')[1]))
    if (!g) return send({ status: 'error', messages: 'Group not found' }, 404)
    if (req.method === 'PATCH') {
      if (!body.name) return fail({ name: ['The name field is required.'] })
      let permissions
      try { permissions = body.permissions && JSON.parse(body.permissions) } catch { return fail({ permissions: ['The permissions must be JSON.'] }) }
      Object.assign(g, { name: body.name, ...(permissions && { permissions }) })
    }
    return send(req.method === 'PATCH' ? { status: 'success', messages: 'Updated.', payload: g } : g)
  }
  if (path === 'imports' || path.startsWith('imports/')) {
    if (limited) return send(refused, 403)
    if (path === 'imports' && req.method === 'GET') return send(imports.map(importOf))
    if (path === 'imports') {
      const file = body.get('files[]')
      const csv = await file.text()
      if (new Set(csvRows(csv)[0]).size !== (csvRows(csv)[0] ?? []).length) return send({ status: 'error', messages: 'Duplicate header detected', payload: null }, 422)
      const i = { id: Math.max(0, ...imports.map((x) => x.id)) + 1, file_path: `2026-10-01-093015-${file.name}`, name: '', filesize: `${csv.length} B`, import_type: '', created_at: '1 second ago', csv, field_map: null }
      imports.unshift(i)
      return send({ files: [importOf(i)] })
    }
    const i = imports.find((x) => x.id === Number(path.split('/').pop()))
    if (req.method === 'DELETE') {
      if (!i) return send({ status: 'warning', messages: 'File could not be deleted.', payload: null })
      imports.splice(imports.indexOf(i), 1)
      return send({ status: 'success', messages: 'File successfully deleted', payload: null })
    }
    if (!i) return send({ status: 'import-errors', messages: { 0: { 0: 'The selected file is invalid.' } }, payload: null }, 500)
    Object.assign(i, { import_type: body['import-type'], field_map: body['column-mappings'] })
    const [head, ...rows] = csvRows(i.csv)
    const required = { asset: 'asset_tag', user: 'username', location: 'name' }[body['import-type']] ?? 'item_name'
    const column = head.findIndex((h) => body['column-mappings']?.[h] === required || h.toLowerCase() === required)
    const errors = Object.fromEntries(rows.flatMap((r, n) => (column >= 0 && r[column] ? [] : [[r.find(Boolean) ?? `Row ${n + 2}`, { [required]: { [required]: [`The ${required.replace(/_/g, ' ')} field is required.`] } }]])))
    return Object.keys(errors).length ? send({ status: 'import-errors', messages: errors, payload: null }, 500) : send({ status: 'success', messages: { redirect_url: '' }, payload: null })
  }
  // Snipe-IT's User picker: "Last, First (username) - #employee number", Users only.
  if (path === 'users/selectlist') {
    const q = (url.searchParams.get('search') ?? '').toLowerCase()
    const found = users.filter((u) => text(u.name, u.username, u.email, u.employee_num).includes(q)).slice(0, 50)
    return send({ results: found.map((u) => ({ id: u.id, text: `${u.name.split(' ').reverse().join(', ')} (${u.username})${u.employee_num ? ` - #${u.employee_num}` : ''}`, image: null })), pagination: { more: false } })
  }
  // Shaped like GitHub's releases/latest, trimmed to what the app reads.
  if (path === '/repos/grokability/snipe-it/releases/latest')
    return send({ tag_name: 'v8.8.1', name: 'v8.8.1', html_url: 'https://github.com/grokability/snipe-it/releases/tag/v8.8.1', draft: false, prerelease: false })
  // Shaped like Snipe-IT v8.8's /version.
  if (path === 'version') return send({ version: 'v8.8.0', build_version: 'v8.8.0-0-gmock', hash_version: 'gmock', full_version: 'v8.8.0 build 0 (gmock)' })
  if (path === 'hardware/labels') {
    const found = (body.asset_tags ?? []).filter((t) => assets.some((a) => a.asset_tag === t))
    if (!found.length) return send({ status: 'error', messages: 'Asset does not exist.', payload: null }, 404)
    if (labelEngine === 'legacy') return send({ status: 'error', messages: 'Error while generating labels.', payload: { error_message: 'Enable the New Label Engine to load labels via the API' } }, 500)
    return send({ status: 'success', messages: 'Labels were successfully generated.', payload: { pdf: labelPdf(found) } })
  }
  if ((m = path.match(/^hardware\/bytag\/(.+)$/))) return send(assets.find((a) => a.asset_tag.toLowerCase() === decodeURIComponent(m[1]).toLowerCase()) ?? { status: 'error', messages: 'Asset does not exist.' })
  if ((m = path.match(/^fieldsets\/(\d+)(\/fields)?$/))) {
    const fields = { total: fieldset.fields.length, rows: fieldset.fields }
    return +m[1] !== fieldset.id ? fail('Fieldset does not exist') : send(m[2] ? fields : { id: fieldset.id, name: fieldset.name, fields })
  }
  if (req.method === 'POST' && store[path]) return send(saveRecord(path, body))
  // A status-only PATCH is the Quick Action, handled with the other Asset actions below.
  const statusOnly = req.method === 'PATCH' && Object.keys(body).every((k) => k === 'status_id')
  if ((m = path.match(/^([a-z]+)\/(\d+)$/)) && store[m[1]] && req.method !== 'GET' && !(m[1] === 'hardware' && statusOnly)) {
    const row = store[m[1]].find((r) => r.id === +m[2])
    if (!row) return send({ status: 'error', messages: 'Not found' }, 404)
    if (req.method === 'PATCH' || req.method === 'PUT') return send(saveRecord(m[1], body, row))
    if (m[1] === 'hardware' && row.assigned_to) return fail('This asset is currently checked out, and cannot be deleted. Check it in first.')
    if (m[1] === 'users' && assets.some((x) => x.assigned_to?.type === 'user' && x.assigned_to.id === row.id)) return fail('This user has items assigned and could not be deleted.')
    store[m[1]].splice(store[m[1]].indexOf(row), 1)
    return send({ status: 'success', messages: 'Deleted.', payload: null })
  }
  if ((m = path.match(/^hardware\/(\d+)(?:\/(checkin|checkout|audit))?$/))) {
    const a = assets.find((x) => x.id === +m[1])
    if (!a) return send({ status: 'error', messages: 'Asset does not exist.' }, 404)
    if (m[2] === 'checkin') {
      act('checkin from', a, a.assigned_to, body.note)
      Object.assign(a, { assigned_to: null, expected_checkin: null, status_label: statuses.find((s) => s.id === body.status_id) ?? a.status_label, location: locations.find((l) => l.id === body.location_id) ?? a.rtd_location })
    } else if (m[2] === 'checkout') {
      const other = body.checkout_to_type === 'asset' && assets.find((x) => x.id === body.assigned_asset && x.id !== a.id)
      const target = other ? { id: other.id, name: other.name } : body.checkout_to_type === 'user' ? users.find((u) => u.id === body.assigned_user) : locations.find((l) => l.id === body.assigned_location)
      if (!target) return fail('Checkout target does not exist.')
      // Like Snipe-IT, a Status Label sent with the Checkout must be deployable; checked out, its status_meta reads 'deployed'.
      const status = body.status_id === undefined ? statuses[1] : statuses.find((s) => s.id === body.status_id && s.status_type === 'deployable')
      if (!status) return fail({ status_id: ['The selected status id is invalid.'] })
      a.assigned_to = { ...target, ...(target.employee_num !== undefined && { employee_number: target.employee_num }), type: body.checkout_to_type }
      a.last_checkout = { datetime: local(new Date()), formatted: day(0) }
      a.status_label = { ...status, status_meta: 'deployed' }
      a.expected_checkin = dueBack(body.expected_checkin)
      act('checkout', a, a.assigned_to, body.note)
    } else if (m[2] === 'audit') {
      // Like Snipe-IT with a 12-month audit interval: the next audit date given, or a year from today.
      if (limited) return fail('You do not have permission to audit this asset.')
      const next = body.next_audit_date || day(365)
      Object.assign(a, { last_audit_date: { datetime: `${day(0)} ${new Date().toTimeString().slice(0, 8)}`, formatted: day(0) }, next_audit_date: { date: next, formatted: next } })
      act('audit', a, null, body.note)
      return send({ status: 'success', messages: 'Asset audited successfully.', payload: { asset_tag: a.asset_tag, note: body.note, next_audit_date: a.next_audit_date } })
    } else if (req.method === 'PATCH') {
      const status = statuses.find((s) => s.id === body.status_id)
      if (!status) return fail({ status_id: ['Choose a valid status.'] })
      if (a.assigned_to && status.status_meta !== 'deployable' && status.status_meta !== 'deployed') return fail({ status_id: ['A checked-out Asset needs a deployable status.'] })
      a.status_label = status
      act('update', a, null, `Status changed to ${status.name}`)
    }
    return send(req.method === 'GET' ? a : { status: 'success', messages: 'Done.', payload: a })
  }
  // One record of any other kind by id.
  if ((m = path.match(/^([a-z]+)\/(\d+)$/)) && lists[m[1]]) {
    const row = lists[m[1]].rows().find((r) => r.id === +m[2])
    return row ? send(row) : send({ status: 'error', messages: 'Not found' }, 404)
  }
  const spec = lists[path]
  if (spec) return send(listPage(spec, url.searchParams))
  send({ status: 'error', messages: 'Not found' }, 404)
}).listen(port, '127.0.0.1', () => console.log(`Mock Snipe-IT on http://127.0.0.1:${port}`))
