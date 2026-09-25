// A pretend Snipe-IT with made-up data, for developing and screenshotting without real student records.
// Run: node scripts/mock-snipeit.mjs [port]   then use http://127.0.0.1:<port> and any API token in Settings.
// ponytail: covers only the endpoints and filters the app uses; changes live in memory until it stops.
import { createServer } from 'node:http'

const port = Number(process.argv[2] ?? 8765)
const named = (list) => list.map((name, i) => ({ id: i + 1, name }))
const pick = (list, n) => list[n % list.length]

const statuses = [
  ['Ready to Deploy', 'deployable', '#2ea043'], ['Deployed', 'deployed', '#388bfd'], ['In Repair', 'undeployable', '#d29922'],
  ['Broken', 'undeployable', '#e5534b'], ['Pending', 'pending', null], ['Archived', 'archived', '#6e7681'],
].map(([name, status_meta, color], i) => ({ id: i + 1, name, status_meta, color }))
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
const users = Array.from({ length: 64 }, (_, i) => {
  const [f, l] = [pick(first, i), pick(last, i * 3 + Math.floor(i / 16))]
  return { id: i + 1, name: `${f} ${l}`, username: `${f[0]}${l}${i + 1}`.toLowerCase(), email: `${f}.${l}${i + 1}@example.org`.toLowerCase(), department: pick(departments, i), location: pick(locations.slice(1), i) }
})
const day = (offset) => new Date(Date.now() + offset * 864e5).toISOString().slice(0, 10)
const assets = Array.from({ length: 240 }, (_, i) => {
  const model = pick(models, i % 7 ? 0 : i)
  const status = i % 11 === 3 ? statuses[2] : i % 17 === 5 ? statuses[3] : i % 23 === 7 ? statuses[5] : i % 3 === 0 ? statuses[0] : statuses[1]
  const toUser = status.status_meta === 'deployed' && i % 5 !== 0
  const holder = status.status_meta !== 'deployed' ? null : toUser ? { ...pick(users, i), type: 'user' } : { ...pick(locations.slice(1), i), type: 'location' }
  return {
    id: i + 1, asset_tag: `NOMMA-${String(1000 + i).padStart(6, '0')}`, name: `${model.category.name.slice(0, 2).toUpperCase()}-${String(i + 1).padStart(3, '0')}`,
    serial: `5CD${(2381000 + i * 37).toString(36).toUpperCase()}`, model, category: model.category, status_label: status,
    location: holder?.type === 'location' ? holder : pick(locations.slice(1), i), assigned_to: holder,
    purchase_date: { date: day(-400 - i) }, warranty_expires: { date: day(30 + i * 4) }, expected_checkin: holder && i % 9 === 1 ? { date: day(-(i % 30)) } : null,
  }
})
const log = []
const act = (action_type, asset, target, note = null, when = new Date()) =>
  log.unshift({ id: log.length + 1, action_type, created_at: { datetime: when.toISOString().replace('T', ' ').slice(0, 19) }, created_by: { id: 900, name: 'Demo Operator' },
    item: { id: asset.id, name: `${asset.asset_tag} (${asset.name})`, type: 'asset' }, target: target && { id: target.id, name: target.name, type: target.type ?? 'user' }, note })
for (const a of assets.slice(0, 90).reverse()) {
  const action = a.id % 4 ? 'checkout' : a.id % 3 ? 'checkin from' : 'update'
  act(action, a, action === 'update' ? null : a.assigned_to ?? pick(users, a.id), a.id % 6 ? null : 'Charger included', new Date(Date.now() - a.id * 36e5))
}

const text = (...fields) => fields.filter(Boolean).join(' ').toLowerCase()
const lists = {
  hardware: { rows: () => assets, search: (a) => text(a.asset_tag, a.name, a.serial, a.model.name, a.assigned_to?.name), filters: {
    status_id: (a, v) => a.status_label.id === +v, location_id: (a, v) => a.location?.id === +v, model_id: (a, v) => a.model.id === +v, category_id: (a, v) => a.category.id === +v,
    assigned_to: (a, v) => a.assigned_to?.type === 'user' && a.assigned_to.id === +v, status: (a, v) => (v === 'Deployed' ? !!a.assigned_to : !a.assigned_to && a.status_label.status_meta === 'deployable'),
  }, sorts: { asset_tag: (a) => a.asset_tag, name: (a) => a.name, status: (a) => a.status_label.name, model: (a) => a.model.name, category: (a) => a.category.name, location: (a) => a.location?.name, assigned_to: (a) => a.assigned_to?.name ?? '', serial: (a) => a.serial } },
  users: { rows: () => users.map((u) => ({ ...u, assets_count: assets.filter((a) => a.assigned_to?.type === 'user' && a.assigned_to.id === u.id).length })), search: (u) => text(u.name, u.username, u.email),
    filters: { location_id: (u, v) => u.location.id === +v, department_id: (u, v) => u.department.id === +v }, sorts: { last_name: (u) => u.name.split(' ')[1], username: (u) => u.username, assets_count: (u) => u.assets_count } },
  locations: { rows: () => locations.map((l) => ({ ...l, assets_count: assets.filter((a) => a.location?.id === l.id).length, assigned_assets_count: assets.filter((a) => a.assigned_to?.type === 'location' && a.assigned_to.id === l.id).length, users_count: users.filter((u) => u.location.id === l.id).length })),
    search: (l) => text(l.name, l.city), filters: {}, sorts: { name: (l) => l.name, assets_count: (l) => l.assets_count } },
  models: { rows: () => models.map((m) => ({ ...m, assets_count: assets.filter((a) => a.model.id === m.id).length, remaining: assets.filter((a) => a.model.id === m.id && !a.assigned_to && a.status_label.status_meta === 'deployable').length })),
    search: (m) => text(m.name, m.model_number, m.manufacturer.name), filters: { category_id: (m, v) => m.category.id === +v }, sorts: { name: (m) => m.name, assets_count: (m) => m.assets_count } },
  'reports/activity': { rows: () => log, search: (r) => text(r.item?.name, r.target?.name, r.note), filters: { action_type: (r, v) => r.action_type === v, item_type: (r, v) => r.item?.type === v, item_id: () => true }, sorts: { created_at: (r) => r.created_at.datetime }, sort: 'created_at' },
  statuslabels: { rows: () => statuses }, categories: { rows: () => categories }, departments: { rows: () => departments },
  licenses: { rows: () => [] }, accessories: { rows: () => [] }, consumables: { rows: () => [] }, components: { rows: () => [] },
}

function listPage(spec, q) {
  let rows = spec.rows()
  const search = q.get('search')?.toLowerCase()
  if (search && spec.search) rows = rows.filter((r) => spec.search(r).includes(search))
  for (const [key, test] of Object.entries(spec.filters ?? {})) if (q.get(key)) rows = rows.filter((r) => test(r, q.get(key)))
  const by = spec.sorts?.[q.get('sort') ?? spec.sort]
  if (by) rows = [...rows].sort((a, b) => String(by(a)).localeCompare(String(by(b)), undefined, { numeric: true }) * (q.get('order') === 'asc' ? 1 : -1))
  const offset = Number(q.get('offset') ?? 0)
  return { total: rows.length, rows: rows.slice(offset, offset + Number(q.get('limit') ?? 50)) }
}

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x')
  const path = url.pathname.replace(/^\/api\/v1\//, '')
  const body = req.method === 'GET' ? {} : JSON.parse(await new Promise((ok) => { let s = ''; req.on('data', (c) => (s += c)).on('end', () => ok(s || '{}')) }))
  const send = (value, status = 200) => (res.writeHead(status, { 'Content-Type': 'application/json' }), res.end(JSON.stringify(value)))
  const fail = (messages) => send({ status: 'error', messages, payload: null })
  let m
  if (path === 'users/me') return send({ id: 900, name: 'Demo Operator' })
  if (path === 'version') return send({ version: 'v8.3.0 (mock)' })
  if ((m = path.match(/^hardware\/bytag\/(.+)$/))) return send(assets.find((a) => a.asset_tag.toLowerCase() === decodeURIComponent(m[1]).toLowerCase()) ?? { status: 'error', messages: 'Asset does not exist.' })
  if ((m = path.match(/^hardware\/(\d+)(?:\/(checkin|checkout))?$/))) {
    const a = assets.find((x) => x.id === +m[1])
    if (!a) return send({ status: 'error', messages: 'Asset does not exist.' }, 404)
    if (m[2] === 'checkin') {
      act('checkin from', a, a.assigned_to, body.note)
      Object.assign(a, { assigned_to: null, expected_checkin: null, status_label: statuses.find((s) => s.id === body.status_id) ?? a.status_label, location: locations.find((l) => l.id === body.location_id) ?? a.location })
    } else if (m[2] === 'checkout') {
      const target = body.checkout_to_type === 'user' ? users.find((u) => u.id === body.assigned_user) : locations.find((l) => l.id === body.assigned_location)
      if (!target) return fail('Checkout target does not exist.')
      a.assigned_to = { ...target, type: body.checkout_to_type }
      a.status_label = statuses[1]
      a.expected_checkin = body.expected_checkin ? { date: body.expected_checkin } : null
      act('checkout', a, a.assigned_to, body.note)
    } else if (req.method === 'PATCH') {
      const status = statuses.find((s) => s.id === body.status_id)
      if (!status) return fail({ status_id: ['Choose a valid status.'] })
      if (a.assigned_to && status.status_meta !== 'deployable' && status.status_meta !== 'deployed') return fail({ status_id: ['A checked-out Asset needs a deployable status.'] })
      a.status_label = status
      act('update', a, null, `Status changed to ${status.name}`)
    }
    return send(req.method === 'GET' ? a : { status: 'success', messages: 'Done.', payload: a })
  }
  const spec = lists[path]
  if (spec) return send(listPage(spec, url.searchParams))
  send({ status: 'error', messages: 'Not found' }, 404)
}).listen(port, '127.0.0.1', () => console.log(`Mock Snipe-IT on http://127.0.0.1:${port}`))
