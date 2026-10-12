import { describe, expect, it, vi } from 'vitest'
import { allMatching } from '../renderer/src/ListView'
import { BULK_FORMS, createSnipeIt, filled, fromWire, healthLines, lateness, markdownOf, overdueList, toWire, type AssetView, type CheckoutOptions, type Dashboard } from './snipeit'
import { toCsv } from './export'
import { reportRunner } from './scheduler'
import { userNotesLine } from './notes'

const config = { baseUrl: 'https://snipe.example.org', apiKey: 'test-key' }

// Shaped like the Snipe-IT API reference hardware response (trimmed).
const chromebook = {
  id: 4812,
  name: 'CB-LIB-012',
  asset_tag: 'NOMMA-004812',
  serial: '5CD2381KQX',
  model: { id: 7, name: 'HP Chromebook 14 G7' },
  status_label: { id: 2, name: 'Deployed', status_type: 'deployable', status_meta: 'deployed' },
  category: { id: 3, name: 'Chromebook' },
  location: { id: 9, name: 'Library' },
  assigned_to: { id: 311, username: 'jreyes', name: 'Jordan Reyes', first_name: 'Jordan', last_name: 'Reyes', type: 'user' },
  purchase_date: { date: '2023-08-01', formatted: '08/01/2023' },
  warranty_expires: { date: '2026-11-30', formatted: '11/30/2026' },
  // Snipe-IT v8.7+ sends Expected Checkin as a datetime; a date-only one is at midnight.
  expected_checkin: { datetime: '2026-09-15 00:00:00', formatted: '2026-09-15 12:00 AM' },
}

// Shaped like Snipe-IT's /reports/activity rows (trimmed). Returned oldest first on purpose.
const activity = {
  total: 3,
  rows: [
    {
      id: 1, action_type: 'create', created_at: { datetime: '2023-08-03 11:00:00', formatted: '2023-08-03 11:00 AM' },
      created_by: { id: 1, name: 'Admin' }, target: null, note: null, item: { id: 4812, name: 'CB-LIB-012', type: 'asset' },
    },
    {
      id: 7, action_type: 'checkin from', created_at: { datetime: '2026-08-17 15:40:00', formatted: '2026-08-17 3:40 PM' },
      created_by: { id: 5, name: 'E. Caldwell' }, target: { id: 290, name: 'Sam Whitaker', type: 'user' },
      note: '&quot;keyboard sticky&quot;', item: { id: 4812, name: 'CB-LIB-012', type: 'asset' },
    },
    {
      id: 9, action_type: 'checkout', created_at: { datetime: '2026-08-18 08:12:00', formatted: '2026-08-18 8:12 AM' },
      admin: { id: 5, name: 'E. Caldwell' }, target: { id: 311, name: 'Jordan Reyes', type: 'user' },
      note: '', item: { id: 4812, name: 'CB-LIB-012', type: 'asset' },
    },
  ],
}

const today = () => new Date(2026, 8, 24) // 2026-09-24, local time
const snipeItWith = (hardware: object, history: { status?: number; body: unknown } = { body: { total: 0, rows: [] } }, now = today) =>
  createSnipeIt(config, fakeFetch({ '/hardware/4812': { body: hardware }, '/reports/activity': history }).fetch, now)

const notFound = { status: 'error', messages: 'Asset does not exist.', payload: null }
// What Snipe-IT's catch-all route sends for a path it has no route for under that method, e.g. a GET to a POST-only endpoint.
const noEndpoint = { status: 'error', message: '404 endpoint not found. Please check the API reference at https://snipe-it.readme.io/reference to find a valid API endpoint.', payload: null }

// A fake fetch that answers from a route → JSON map, keyed 'POST /path' (or just '/path' for a GET) like Snipe-IT routes,
// and records the paths it was asked for, plus every request as Snipe-IT would receive it (method, path, parsed JSON body),
// and each query string's parameters. A path routed only under another method gets Snipe-IT's 404, as a real server sends.
type FakeRequest = { method: string; path: string; body: unknown }
function fakeFetch(routes: Record<string, { status?: number; body: unknown }>) {
  const calls: string[] = []
  const requests: FakeRequest[] = []
  const queries: Record<string, string>[] = []
  const fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input))
    const path = url.pathname.replace('/api/v1', '')
    const method = init?.method ?? 'GET'
    calls.push(path)
    queries.push(Object.fromEntries(url.searchParams))
    // An upload (multipart) is kept as sent; anything else is JSON.
    requests.push({ method, path, body: init?.body instanceof FormData ? init.body : init?.body ? JSON.parse(String(init.body)) : undefined })
    const routedOtherwise = Object.keys(routes).some((k) => k.replace(/^[A-Z]+ /, '') === path)
    const route = routes[method === 'GET' ? path : `${method} ${path}`] ?? { status: 404, body: routedOtherwise ? noEndpoint : notFound }
    // A function body answers each request afresh (a server whose data changes between calls).
    const body = typeof route.body === 'function' ? route.body() : route.body
    return new Response(JSON.stringify(body), { status: route.status ?? 200 })
  }
  return { fetch: fetch as typeof globalThis.fetch, calls, requests, queries }
}

describe('assetByTag', () => {
  it('finds an Asset by its exact Asset Tag only: an unknown tag is null, with no fallback search', async () => {
    const { fetch, calls } = fakeFetch({ '/hardware/bytag/NOMMA-004812': { body: chromebook }, '/hardware': { body: { total: 1, rows: [chromebook] } } })
    const snipeIt = createSnipeIt(config, fetch)
    expect(await snipeIt.assetByTag('NOMMA-004812')).toMatchObject({ id: 4812, assetTag: 'NOMMA-004812', statusMeta: 'deployed', statusType: 'deployable' })
    expect(await snipeIt.assetByTag('NOMMA-0048')).toBeNull()
    expect(calls).toEqual(['/hardware/bytag/NOMMA-004812', '/hardware/bytag/NOMMA-0048'])
  })

  it("keeps a checked-out Asset's own label type, which status_meta hides behind 'deployed'", async () => {
    const pending = { ...chromebook, status_label: { id: 5, name: 'Pending', status_type: 'pending', status_meta: 'deployed' } }
    const { fetch } = fakeFetch({ '/hardware/bytag/NOMMA-004812': { body: pending } })
    expect(await createSnipeIt(config, fetch).assetByTag('NOMMA-004812')).toMatchObject({ statusMeta: 'deployed', statusType: 'pending' })
  })

  it('refuses an empty or non-text tag without asking Snipe-IT', async () => {
    const { fetch, calls } = fakeFetch({})
    const snipeIt = createSnipeIt(config, fetch)
    await expect(snipeIt.assetByTag('')).rejects.toThrow('Invalid Asset Tag')
    await expect(snipeIt.assetByTag(42 as unknown as string)).rejects.toThrow('Invalid Asset Tag')
    expect(calls).toEqual([])
  })
})

describe('lookup', () => {
  it('scanning an exact Asset Tag returns that one Asset, marked exact', async () => {
    const { fetch } = fakeFetch({ '/hardware/bytag/NOMMA-004812': { body: chromebook } })
    const result = await createSnipeIt(config, fetch).lookup('NOMMA-004812')
    expect(result.exact).toBe(true)
    expect(result.assets).toHaveLength(1)
    expect(result.assets[0]).toMatchObject({ id: 4812, assetTag: 'NOMMA-004812' })
  })

  it('trims whitespace a scanner or typist adds around the Asset Tag', async () => {
    const { fetch } = fakeFetch({ '/hardware/bytag/NOMMA-004812': { body: chromebook } })
    const result = await createSnipeIt(config, fetch).lookup('  NOMMA-004812\n')
    expect(result.exact).toBe(true)
    expect(result.assets[0].assetTag).toBe('NOMMA-004812')
  })

  it('a query that is not an exact Asset Tag falls back to a text search, not marked exact', async () => {
    const projector = { ...chromebook, id: 77, asset_tag: 'NOMMA-000077', name: 'Epson Room 204', assigned_to: null }
    const { fetch } = fakeFetch({ '/hardware': { body: { total: 2, rows: [chromebook, projector] } } })
    const result = await createSnipeIt(config, fetch).lookup('  cb-lib ')
    expect(result.exact).toBe(false)
    expect(result.assets.map((a) => a.assetTag)).toEqual(['NOMMA-004812', 'NOMMA-000077'])
  })

  it('search matches are Asset summaries: Asset Tag, name, status, and Assignee', async () => {
    const { fetch } = fakeFetch({ '/hardware': { body: { total: 1, rows: [chromebook] } } })
    const result = await createSnipeIt(config, fetch).lookup('Reyes')
    expect(result.assets).toEqual([
      {
        id: 4812,
        assetTag: 'NOMMA-004812',
        name: 'CB-LIB-012',
        status: 'Deployed',
        statusMeta: 'deployed',
        assignee: { type: 'user', id: 311, name: 'Jordan Reyes', username: 'jreyes' },
        can: { checkout: true, checkin: true, update: true, delete: true, audit: true },
        matched: 'Assignee',
      },
    ])
  })

  it('each Asset match names the field the text was found in: a custom field, the notes, the Serial', async () => {
    const withMac = { ...chromebook, id: 1, custom_fields: { 'MAC Address': { field: '_snipeit_mac_address_1', value: '00:1A:2B:3C:4D:5E' } } }
    const withNote = { ...chromebook, id: 2, notes: '<p>Cracked <strong>screen</strong></p>', custom_fields: [] }
    const bySerial = { ...chromebook, id: 3 }
    const { fetch } = fakeFetch({ '/hardware': { body: { total: 3, rows: [withMac, withNote, bySerial] } } })
    const found = (await createSnipeIt(config, fetch).lookup('4d:5e')).assets
    expect(found.map((a) => 'matched' in a && a.matched)).toEqual(['MAC Address', '', ''])
    const notes = await createSnipeIt(config, fakeFetch({ '/hardware': { body: { total: 1, rows: [withNote] } } }).fetch).lookup('cracked screen')
    expect(notes.assets.map((a) => 'matched' in a && a.matched)).toEqual(['Notes'])
    const serial = await createSnipeIt(config, fakeFetch({ '/hardware': { body: { total: 1, rows: [bySerial] } } }).fetch).lookup('2381kq')
    expect(serial.assets.map((a) => 'matched' in a && a.matched)).toEqual(['Serial'])
  })

  it("an Asset matched by its Asset Model's manufacturer or model number says so, as Snipe-IT sends them beside the model", async () => {
    const ipad = { ...chromebook, model: { id: 5, name: 'iPad 10th Gen' }, model_number: 'A2696', manufacturer: { id: 4, name: 'Apple' } }
    const { fetch } = fakeFetch({ '/hardware': { body: { total: 1, rows: [ipad] } } })
    expect((await createSnipeIt(config, fetch).lookup('apple')).assets.map((a) => 'matched' in a && a.matched)).toEqual(['Manufacturer'])
    expect((await createSnipeIt(config, fetch).lookup('a2696')).assets.map((a) => 'matched' in a && a.matched)).toEqual(['Model No.'])
  })

  it('a match on a field the app has no name for is still named, from the field Snipe-IT sent', async () => {
    const withExtras = { ...chromebook, rtd_location: { id: 4, name: 'IT Office' }, warranty_months: '36 months' }
    const { fetch } = fakeFetch({ '/hardware': { body: { total: 1, rows: [withExtras] } } })
    expect((await createSnipeIt(config, fetch).lookup('it office')).assets.map((a) => 'matched' in a && a.matched)).toEqual(['Rtd location'])
    const again = await createSnipeIt(config, fetch).lookup('36 month')
    expect(again.assets.map((a) => 'matched' in a && a.matched)).toEqual(['Warranty months'])
    // Not from dates, counts or quantities, which Snipe-IT doesn't search: a hit there would mislabel the match.
    const noisy = { ...chromebook, created_at: { datetime: '2024-01-05 09:00:00', formatted: '2024-01-05 9:00 AM' }, qty: 7777 }
    const noise = createSnipeIt(config, fakeFetch({ '/hardware': { body: { total: 1, rows: [noisy] } } }).fetch)
    expect((await noise.lookup('2024')).assets.map((a) => 'matched' in a && a.matched)).toEqual([''])
    expect((await noise.lookup('7777')).assets.map((a) => 'matched' in a && a.matched)).toEqual([''])
  })

  it('nothing matching the tag or the text search finds no Assets', async () => {
    const { fetch } = fakeFetch({ '/hardware': { body: { total: 0, rows: [] } } })
    const result = await createSnipeIt(config, fetch).lookup('NOPE-1')
    expect(result.assets).toEqual([])
  })

  it("a text search Snipe-IT rejects is thrown as Snipe-IT's message", async () => {
    const denied = { status: 'error', messages: 'You do not have permission.', payload: null }
    const { fetch } = fakeFetch({ '/hardware': { body: denied } })
    await expect(createSnipeIt(config, fetch).lookup('cb-lib')).rejects.toThrow('You do not have permission.')
  })

  it('a text search also finds Users, Locations, Asset Models and the stocked kinds, grouped by kind, each with the field it matched', async () => {
    const none = { body: { total: 0, rows: [] } }
    const { fetch } = fakeFetch({
      '/hardware': none,
      '/users': { body: { total: 1, rows: [{ id: 311, name: 'Jordan Reyes', username: 'jreyes' }] } },
      '/locations': { body: { total: 1, rows: [{ id: 12, name: 'Room 204', address: '12 Reynolds St' }] } },
      '/models': { body: { total: 1, rows: [{ id: 7, name: 'HP Chromebook 14 G7', model_number: '14-G7', manufacturer: { id: 1, name: 'HP' }, notes: 'Replaces the G5' }] } },
      '/licenses': none,
      '/accessories': { body: { total: 1, rows: [{ id: 3, name: 'USB-C Charger', model_number: 'CHG-65', notes: 'Spare for the Reyes cart' }] } },
      '/consumables': { body: { total: 1, rows: [{ id: 5, name: 'Toner', item_no: 'RE-206A' }] } },
      '/components': none,
    })
    const result = await createSnipeIt(config, fetch).lookup('re')
    expect(!result.exact && result.others).toEqual([
      { kind: 'users', rows: [{ id: 311, name: 'Jordan Reyes', detail: 'jreyes', matched: 'Name' }] },
      { kind: 'locations', rows: [{ id: 12, name: 'Room 204', detail: '', matched: 'Address' }] },
      { kind: 'models', rows: [{ id: 7, name: 'HP Chromebook 14 G7', detail: '14-G7', matched: 'Notes' }] },
      { kind: 'licenses', rows: [] },
      { kind: 'accessories', rows: [{ id: 3, name: 'USB-C Charger', detail: 'CHG-65', matched: 'Notes' }] },
      { kind: 'consumables', rows: [{ id: 5, name: 'Toner', detail: '', matched: 'Item No.' }] },
      { kind: 'components', rows: [] },
    ])
  })

  it("a kind the key can't search says why, without hiding the Assets or the other kinds", async () => {
    const denied = { status: 'error', messages: 'You do not have permission.', payload: null }
    const { fetch } = fakeFetch({
      '/hardware': { body: { total: 1, rows: [chromebook] } },
      '/users': { body: denied },
      '/locations': { body: { total: 0, rows: [] } },
      '/models': { body: { total: 0, rows: [] } },
    })
    const result = await createSnipeIt(config, fetch).lookup('cb')
    expect(result.assets).toHaveLength(1)
    expect(!result.exact && result.others[0]).toEqual({ kind: 'users', error: 'You do not have permission.' })
  })

  it('a blank query finds nothing without asking Snipe-IT', async () => {
    const { fetch, calls } = fakeFetch({})
    const result = await createSnipeIt(config, fetch).lookup('   ')
    expect(result).toEqual({ exact: false, assets: [], others: [] })
    expect(calls).toEqual([])
  })
})

describe('getAsset', () => {
  it('returns a flat Asset in app vocabulary', async () => {
    const asset = await snipeItWith(chromebook, { body: activity }).getAsset(4812)
    expect(asset).toMatchObject({
      id: 4812,
      assetTag: 'NOMMA-004812',
      name: 'CB-LIB-012',
      model: 'HP Chromebook 14 G7',
      status: 'Deployed',
      statusMeta: 'deployed',
      assignee: { type: 'user', id: 311, name: 'Jordan Reyes' },
      location: 'Library',
      category: 'Chromebook',
      serial: '5CD2381KQX',
      purchaseDate: '2023-08-01',
      warrantyEnd: '2026-11-30',
      expectedCheckin: '2026-09-15',
    })
  })

  it("carries the Asset's Default Location, blank when it has none", async () => {
    expect((await snipeItWith({ ...chromebook, rtd_location: { id: 4, name: 'IT Office' } }).getAsset(4812)).defaultLocation).toBe('IT Office')
    expect((await snipeItWith({ ...chromebook, rtd_location: null }).getAsset(4812)).defaultLocation).toBe('')
  })

  it('History is newest first: when, action, Operator, detail, and note', async () => {
    const { history } = await snipeItWith(chromebook, { body: activity }).getAsset(4812)
    expect(history).toEqual([
      { when: '2026-08-18 08:12', action: 'Checkout', operator: 'E. Caldwell', detail: 'to Jordan Reyes', note: '' },
      { when: '2026-08-17 15:40', action: 'Checkin', operator: 'E. Caldwell', detail: 'from Sam Whitaker', note: '"keyboard sticky"' },
      { when: '2023-08-03 11:00', action: 'Create', operator: 'Admin', detail: '', note: '' },
    ])
  })

  it('notes Snipe-IT renders as inline HTML are shown as plain text', async () => {
    const rows = [{ ...activity.rows[1], note: '&lt;strong&gt;cracked&lt;/strong&gt; screen' }]
    const { history } = await snipeItWith(chromebook, { body: { total: 1, rows } }).getAsset(4812)
    expect(history[0].note).toBe('cracked screen')
  })

  it('a key that cannot read History still shows the Asset, with History unavailable', async () => {
    const asset = await snipeItWith(chromebook, { status: 403, body: { message: 'Forbidden' } }).getAsset(4812)
    expect(asset.assetTag).toBe('NOMMA-004812')
    expect(asset.history).toEqual([])
    expect(asset.historyError).toBe('Snipe-IT returned HTTP 403: Forbidden')
  })

  it('HTML-escaped text from Snipe-IT is decoded', async () => {
    const escaped = { ...chromebook, name: 'Cart &quot;B&quot; &amp; charger', model: { id: 7, name: 'Dell 3100 &#039;2-in-1&#039;' } }
    const asset = await snipeItWith(escaped).getAsset(4812)
    expect(asset.name).toBe('Cart "B" & charger')
    expect(asset.model).toBe("Dell 3100 '2-in-1'")
  })

  it("a User Assignee carries their username and employee number, when Snipe-IT sends them (the key may view Users)", async () => {
    const withNumber = { ...chromebook, assigned_to: { ...chromebook.assigned_to, employee_number: '20417' } }
    expect((await snipeItWith(withNumber).getAsset(4812)).assignee).toEqual({ type: 'user', id: 311, name: 'Jordan Reyes', username: 'jreyes', employeeNum: '20417' })
    const denied = { ...chromebook, assigned_to: { id: 311, name: 'Jordan Reyes', type: 'user' } }
    expect((await snipeItWith(denied).getAsset(4812)).assignee).toEqual({ type: 'user', id: 311, name: 'Jordan Reyes' })
  })

  it('Assignee keeps its kind: a Location Assignee is a Location', async () => {
    const projector = { ...chromebook, assigned_to: { id: 12, name: 'Room 204', type: 'location' } }
    const asset = await snipeItWith(projector).getAsset(4812)
    expect(asset.assignee).toEqual({ type: 'location', id: 12, name: 'Room 204' })
  })

  it('an Asset in inventory has no Assignee and missing dates are null', async () => {
    const inStorage = { ...chromebook, assigned_to: null, purchase_date: null, warranty_expires: null, location: null }
    const asset = await snipeItWith({ ...inStorage, expected_checkin: null }).getAsset(4812)
    expect(asset).toMatchObject({ assignee: null, purchaseDate: null, warrantyEnd: null, expectedCheckin: null, location: '' })
  })

  it("a 200 with status error is thrown as Snipe-IT's message", async () => {
    const denied = { status: 'error', messages: 'You do not have permission.', payload: null }
    const { fetch } = fakeFetch({ '/hardware/4812': { body: denied } })
    await expect(createSnipeIt(config, fetch).getAsset(4812)).rejects.toThrow('You do not have permission.')
  })
})

describe('connection errors', () => {
  const rejected = { status: 401, body: { message: 'Unauthenticated.' } }

  it('a rejected API key says so and tells the Operator to check or regenerate it', async () => {
    const { fetch } = fakeFetch({ '/hardware/bytag/NOMMA-004812': rejected })
    const error = createSnipeIt(config, fetch).lookup('NOMMA-004812')
    await expect(error).rejects.toThrow(/rejected your API key/)
    await expect(error).rejects.toThrow(/may have been deactivated/)
  })

  it('a rejected API key fails getAsset too, rather than showing an Asset', async () => {
    const { fetch } = fakeFetch({ '/hardware/4812': rejected, '/reports/activity': rejected })
    await expect(createSnipeIt(config, fetch).getAsset(4812)).rejects.toThrow(/rejected your API key/)
  })

  it('an unreachable Snipe-IT names the configured URL', async () => {
    const offline = (async () => {
      throw new TypeError('fetch failed')
    }) as typeof globalThis.fetch
    await expect(createSnipeIt(config, offline).lookup('NOMMA-004812')).rejects.toThrow(
      /Can't reach Snipe-IT at https:\/\/snipe\.example\.org/,
    )
    await expect(createSnipeIt(config, offline).getAsset(4812)).rejects.toThrow(/Can't reach Snipe-IT/)
  })

  it('a request Snipe-IT throttles is sent again after the wait it asks for', async () => {
    const sent: string[] = []
    const throttled = (async (input: string | URL | Request) => {
      sent.push(String(input))
      return sent.length < 3
        ? new Response(JSON.stringify({ message: 'Too Many Attempts.' }), { status: 429, headers: { 'Retry-After': '0' } })
        : new Response(JSON.stringify(chromebook))
    }) as typeof globalThis.fetch
    await expect(createSnipeIt(config, throttled).lookup('NOMMA-004812')).resolves.toMatchObject({ exact: true })
    expect(sent).toHaveLength(3)
    // Not for ever: still throttled after three more tries, it fails as rateLimited.
    const always = (async () => new Response(JSON.stringify({ message: 'Too Many Attempts.' }), { status: 429, headers: { 'Retry-After': '0' } })) as typeof globalThis.fetch
    await expect(createSnipeIt(config, always).lookup('NOMMA-004812')).rejects.toMatchObject({ message: 'Snipe-IT is limiting requests; try again in 0 seconds.', kind: 'rateLimited' })
  })

  it('a throttled request without a Retry-After waits out the minute-long throttle window before it is sent again', async () => {
    let sent = 0
    const throttled = (async () => (++sent === 1 ? new Response('{}', { status: 429 }) : new Response(JSON.stringify(chromebook)))) as typeof globalThis.fetch
    vi.useFakeTimers({ toFake: ['setTimeout'] })
    try {
      const result = createSnipeIt(config, throttled).lookup('NOMMA-004812')
      await vi.advanceTimersByTimeAsync(59_000)
      expect(sent).toBe(1)
      await vi.advanceTimersByTimeAsync(1_000)
      await expect(result).resolves.toMatchObject({ exact: true })
      expect(sent).toBe(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('a Snipe-IT too slow to answer says so, rather than blaming the network', async () => {
    const slow = (async () => {
      throw new DOMException('The operation was aborted due to timeout', 'TimeoutError')
    }) as typeof globalThis.fetch
    const result = createSnipeIt(config, slow).dashboard(['assets'])
    await expect(result).resolves.toEqual({ assets: { error: expect.stringMatching(/took longer than 60 seconds to answer/) } })
    await expect(createSnipeIt(config, slow).getAsset(4812)).rejects.toThrow(/took longer than 15 seconds/)
  })

  it("an HTTP error carries Snipe-IT's own reason", async () => {
    const { fetch } = fakeFetch({ '/hardware/bytag/X': { status: 500, body: { status: 'error', messages: 'Server Error' } } })
    await expect(createSnipeIt(config, fetch).lookup('X')).rejects.toThrow('Snipe-IT returned HTTP 500: Server Error')
  })

  it('a reply that is not JSON (wrong URL, login page) says so and names the URL', async () => {
    const html = (async () => new Response('<html>Login</html>', { status: 200 })) as typeof globalThis.fetch
    await expect(createSnipeIt(config, html).lookup('X')).rejects.toThrow(
      /https:\/\/snipe\.example\.org did not answer like Snipe-IT/,
    )
  })

  // Each failure as the window receives it, after crossing the bridge: the message and its kind.
  const failureOf = async (fetch: typeof globalThis.fetch) => {
    const { message, kind, retryAfter } = fromWire(toWire(await createSnipeIt(config, fetch).statusLabels().catch((e) => e)).message)
    return { message, kind, retryAfter }
  }
  const answering = (status: number, headers?: Record<string, string>) =>
    (async () => new Response(JSON.stringify({ message: 'Nope.' }), { status, headers })) as typeof globalThis.fetch
  const unreachable = { message: "Can't reach Snipe-IT at https://snipe.example.org. Check your network connection and server URL in Settings.", kind: 'unreachable' }

  it.each([
    ['401', answering(401), {
      message: 'Snipe-IT rejected your API key. It may be wrong or revoked, or your Snipe-IT account may have been deactivated. Check the token in Settings, or ask a Superuser to check your account.',
      kind: 'key',
    }],
    ['403', answering(403, {}), { message: 'Snipe-IT returned HTTP 403: Nope.', kind: 'forbidden' }],
    ['429 with Retry-After', answering(429, { 'Retry-After': '23' }), { message: 'Snipe-IT is limiting requests; try again in 23 seconds.', kind: 'rateLimited', retryAfter: 23 }],
    ['429 with Retry-After: 1', answering(429, { 'Retry-After': '1' }), { message: 'Snipe-IT is limiting requests; try again in 1 second.', kind: 'rateLimited', retryAfter: 1 }],
    ['429 without Retry-After', answering(429), { message: 'Snipe-IT is limiting requests; try again in 60 seconds.', kind: 'rateLimited', retryAfter: 60 }],
    ['429 with an unreadable Retry-After', answering(429, { 'Retry-After': 'soon' }), { message: 'Snipe-IT is limiting requests; try again in 60 seconds.', kind: 'rateLimited', retryAfter: 60 }],
    ['502', answering(502), unreachable],
    ['503', answering(503), unreachable],
    ['504', answering(504), unreachable],
    ['a network error', (async () => { throw new TypeError('fetch failed') }) as typeof globalThis.fetch, unreachable],
    ['a timeout', (async () => { throw new DOMException('The operation was aborted due to timeout', 'TimeoutError') }) as typeof globalThis.fetch, {
      message: 'Snipe-IT at https://snipe.example.org took longer than 15 seconds to answer. It may be busy; try again.', kind: 'timeout',
    }],
    ['500', answering(500), { message: 'Snipe-IT returned HTTP 500: Nope.', kind: 'refused' }],
    ['a 200 with status: "error"', fakeFetch({ '/statuslabels': { body: { status: 'error', messages: 'You do not have permission to view Status Labels.' } } }).fetch,
      { message: 'You do not have permission to view Status Labels.', kind: 'refused' }],
  ])('%s says so, with its kind', async (_what, fetch, failure) => {
    // A 429 is sent again up to three times, after each wait, before it fails; fake timers skip the waits.
    vi.useFakeTimers({ toFake: ['setTimeout'] })
    try {
      const result = failureOf(fetch)
      await vi.runAllTimersAsync()
      expect(await result).toEqual(failure)
    } finally {
      vi.useRealTimers()
    }
  })

  it("field-by-field messages from Snipe-IT are joined into one readable reason", async () => {
    const invalid = { status: 'error', messages: { asset_tag: ['The asset tag field is required.'], name: ['Too long.'] } }
    const { fetch } = fakeFetch({ '/hardware': { body: invalid } })
    await expect(createSnipeIt(config, fetch).lookup('cb')).rejects.toThrow('The asset tag field is required. Too long.')
  })
})

describe('Overdue (today is 2026-09-24)', () => {
  const due = (datetime: string) => ({ ...chromebook, expected_checkin: { datetime, formatted: datetime } })
  const atTime = (hardware: object, h: number, m: number) => snipeItWith(hardware, undefined, () => new Date(2026, 8, 24, h, m))

  it('an Asset whose Expected Checkin was yesterday is Overdue by 1 day', async () => {
    const asset = await snipeItWith(due('2026-09-23 00:00:00')).getAsset(4812)
    expect(asset.overdue).toEqual({ days: 1, minutes: 1 })
  })

  it('an Asset due back today is not Overdue', async () => {
    const asset = await snipeItWith(due('2026-09-24 00:00:00')).getAsset(4812)
    expect(asset.overdue).toBeNull()
  })

  it('an Asset due today at 14:50 is not Overdue at 14:49, and is Overdue 1 min at 14:51', async () => {
    const before = await atTime(due('2026-09-24 14:50:00'), 14, 49).getAsset(4812)
    expect(before).toMatchObject({ expectedCheckin: '2026-09-24 14:50', overdue: null })
    expect((await atTime(due('2026-09-24 14:50:00'), 14, 50).getAsset(4812)).overdue).toBeNull()
    const after = await atTime(due('2026-09-24 14:50:00'), 14, 51).getAsset(4812)
    expect(after.overdue).toEqual({ days: 0, minutes: 1 })
    expect(lateness(after.overdue!)).toBe('1 min')
    expect((await atTime(due('2026-09-23 14:50:00'), 9, 0).getAsset(4812)).overdue).toEqual({ days: 1, minutes: 1090 })
  })

  it('a date-only Expected Checkin is Overdue from the end of its date, whatever the time', async () => {
    expect((await atTime(due('2026-09-24 00:00:00'), 23, 59).getAsset(4812)).overdue).toBeNull()
    expect((await atTime(due('2026-09-23 00:00:00'), 0, 40).getAsset(4812)).overdue).toEqual({ days: 1, minutes: 40 })
  })

  it('a Snipe-IT before v8.7 sends Expected Checkin as a date, which still works', async () => {
    const asset = await snipeItWith({ ...chromebook, expected_checkin: { date: '2026-09-23', formatted: '09/23/2026' } }).getAsset(4812)
    expect(asset).toMatchObject({ expectedCheckin: '2026-09-23', overdue: { days: 1 } })
  })

  it('an Asset without an Expected Checkin is never Overdue', async () => {
    const asset = await snipeItWith({ ...chromebook, expected_checkin: null }).getAsset(4812)
    expect(asset.overdue).toBeNull()
  })

  it('an Asset with no Assignee is not Overdue even with a past Expected Checkin', async () => {
    const asset = await snipeItWith({ ...chromebook, assigned_to: null }).getAsset(4812)
    expect(asset.overdue).toBeNull()
  })

  it('how late reads in minutes, then hours, on the due day, and in days after it', () => {
    expect([1, 59, 60, 119, 120, 549].map((minutes) => lateness({ days: 0, minutes }))).toEqual(['1 min', '59 min', '1 h', '1 h', '2 h', '9 h'])
    expect(lateness({ days: 3, minutes: 3000 })).toBe('3d')
  })
})

describe('warranty (today is 2026-09-24)', () => {
  const warrantyOn = (date: string | null) =>
    snipeItWith({ ...chromebook, warranty_expires: date && { date } }).getAsset(4812).then((a) => a.warranty)

  it('a warranty ending today is Expiring with 0 days left', async () => {
    expect(await warrantyOn('2026-09-24')).toEqual({ expired: false, daysLeft: 0 })
  })

  it('a warranty ending in 90 days is Expiring', async () => {
    expect(await warrantyOn('2026-12-23')).toEqual({ expired: false, daysLeft: 90 })
  })

  it('a warranty ending in 91 days is not Expiring', async () => {
    expect(await warrantyOn('2026-12-24')).toBeNull()
  })

  it('a warranty that ended yesterday is expired', async () => {
    expect(await warrantyOn('2026-09-23')).toEqual({ expired: true })
  })

  it('no warranty date means no chip', async () => {
    expect(await warrantyOn(null)).toBeNull()
  })
})

describe('statusLabels', () => {
  it('lists every status label by id and name', async () => {
    const labels = {
      total: 2,
      rows: [
        { id: 2, name: 'Deployed', type: 'deployable', color: '#00ff00' },
        { id: 5, name: 'Out for Repair', type: 'undeployable', color: null },
      ],
    }
    const { fetch } = fakeFetch({ '/statuslabels': { body: labels } })
    expect(await createSnipeIt(config, fetch).statusLabels()).toEqual([
      { id: 2, name: 'Deployed' },
      { id: 5, name: 'Out for Repair' },
    ])
  })
})

describe('checkin', () => {
  const checkedIn = { status: 'success', messages: 'Asset checked in successfully.', payload: { asset: 'NOMMA-004812' } }
  const checkinWith = (hardware: object, reply: { status?: number; body: unknown } = { body: checkedIn }) =>
    fakeFetch({ '/hardware/4812': { body: hardware }, 'POST /hardware/4812/checkin': reply })
  const posted = (requests: FakeRequest[]) => requests.filter((r) => r.method === 'POST')

  it('keeps the current status when the Operator picks none', async () => {
    const { fetch, requests } = checkinWith(chromebook)
    await createSnipeIt(config, fetch).checkin(4812, {})
    expect(posted(requests)).toEqual([{ method: 'POST', path: '/hardware/4812/checkin', body: { status_id: 2 } }])
  })

  it('sends the chosen status and the note', async () => {
    const { fetch, requests } = checkinWith(chromebook)
    await createSnipeIt(config, fetch).checkin(4812, { statusId: 5, note: 'cracked screen' })
    expect(posted(requests)).toEqual([
      { method: 'POST', path: '/hardware/4812/checkin', body: { status_id: 5, note: 'cracked screen' } },
    ])
  })

  it('an Asset with no Assignee cannot be checked in, and Snipe-IT is not asked to', async () => {
    const { fetch, requests } = checkinWith({ ...chromebook, assigned_to: null })
    await expect(createSnipeIt(config, fetch).checkin(4812, {})).rejects.toThrow(/NOMMA-004812 is not checked out/)
    expect(posted(requests)).toEqual([])
  })

  it("refuses, writing nothing, when its own read finds another Assignee or Status Label than the caller expects", async () => {
    const { fetch, requests } = checkinWith(chromebook)
    const snipeIt = createSnipeIt(config, fetch)
    // Checked out to User 311, 'Deployed' (id 2).
    await expect(snipeIt.checkin(4812, { fromAssignee: { type: 'user', id: 312 } })).rejects.toThrow('NOMMA-004812 is checked out to Jordan Reyes now')
    await expect(snipeIt.checkin(4812, { fromAssignee: { type: 'location', id: 311 } })).rejects.toThrow('NOMMA-004812 is checked out to Jordan Reyes now')
    await expect(snipeIt.checkin(4812, { fromAssignee: { type: 'user', id: 311 }, fromStatusId: 1 })).rejects.toThrow("NOMMA-004812 is 'Deployed' now")
    expect(posted(requests)).toEqual([])
    await snipeIt.checkin(4812, { statusId: 1, fromAssignee: { type: 'user', id: 311 }, fromStatusId: 2 })
    expect(posted(requests)).toEqual([{ method: 'POST', path: '/hardware/4812/checkin', body: { status_id: 1 } }])
  })

  it('refuses, writing nothing, when a Checkin with no Location would move it to a Default Location the caller expects it not to have', async () => {
    const { fetch, requests } = checkinWith({ ...chromebook, location: null, rtd_location: { id: 8, name: 'IT Office' } })
    await expect(createSnipeIt(config, fetch).checkin(4812, { noDefaultLocation: true })).rejects.toThrow('NOMMA-004812 has a Default Location now, IT Office; a Checkin would move it there')
    expect(posted(requests)).toEqual([])
    const none = checkinWith({ ...chromebook, location: null, rtd_location: null })
    await createSnipeIt(config, none.fetch).checkin(4812, { noDefaultLocation: true })
    expect(posted(none.requests)).toEqual([{ method: 'POST', path: '/hardware/4812/checkin', body: { status_id: 2 } }])
  })

  it("a Checkin Snipe-IT rejects is thrown as Snipe-IT's reason", async () => {
    const refused = { status: 'error', messages: 'That asset is already checked in.', payload: null }
    const { fetch } = checkinWith(chromebook, { body: refused })
    await expect(createSnipeIt(config, fetch).checkin(4812, {})).rejects.toThrow('That asset is already checked in.')
  })
})

describe("Finding a Workflow's User", () => {
  const avery = { id: 311, name: 'Avery Testwell', username: 'atestwell', email: 'avery.testwell@example.org', employee_num: '20417', assets_count: 2 }
  const card = { id: 311, name: 'Avery Testwell', username: 'atestwell', employeeNum: '20417', assets: 2 }

  it('all digits is tried as an exact employee number, then a username', async () => {
    const { fetch, calls, queries } = fakeFetch({ '/users': { body: { total: 1, rows: [avery] } } })
    expect(await createSnipeIt(config, fetch).exactUsers(' 20417 ')).toEqual([card])
    expect(calls).toEqual(['/users'])
    expect(queries[0]).toMatchObject({ employee_num: '20417' })
  })

  it('text with @ is tried as an exact email, then a username; nothing found is an empty list', async () => {
    const { fetch, queries } = fakeFetch({ '/users': { body: { total: 0, rows: [] } } })
    expect(await createSnipeIt(config, fetch).exactUsers('avery.testwell@example.org')).toEqual([])
    expect(queries.map((q) => Object.keys(q).filter((k) => k !== 'limit'))).toEqual([['email'], ['username']])
  })

  it('other text is tried as a username only', async () => {
    const { fetch, queries } = fakeFetch({ '/users': { body: { total: 1, rows: [avery] } } })
    expect(await createSnipeIt(config, fetch).exactUsers('ATestwell')).toEqual([card])
    expect(queries).toEqual([{ username: 'ATestwell', limit: '2' }])
  })

  it("keeps only rows whose field really matches, in case a server ignores the filter or matches loosely", async () => {
    const other = { ...avery, id: 312, employee_num: '204170' }
    const { fetch } = fakeFetch({ '/users': { body: { total: 2, rows: [other] } } })
    expect(await createSnipeIt(config, fetch).exactUsers('20417')).toEqual([])
  })

  it("the User picker list is Snipe-IT's selectlist text, Users only", async () => {
    const { fetch, calls, queries } = fakeFetch({ '/users/selectlist': { body: { results: [{ id: 311, text: 'Testwell, Avery (atestwell) - #20417', image: null }], pagination: { more: false } } } })
    expect(await createSnipeIt(config, fetch).userSelectlist(' test ')).toEqual([{ id: 311, name: 'Testwell, Avery (atestwell) - #20417' }])
    expect(calls).toEqual(['/users/selectlist'])
    expect(queries[0]).toEqual({ search: 'test' })
    expect(await createSnipeIt(config, fetch).userSelectlist('  ')).toEqual([])
  })

  it("a picked User's header: name, username, employee number and how many Assets they hold", async () => {
    const { fetch } = fakeFetch({ '/users/311': { body: { ...avery, employee_num: null } } })
    expect(await createSnipeIt(config, fetch).userCard(311)).toEqual({ ...card, employeeNum: '' })
  })
})

describe('Checkout targets', () => {
  it('searching Users returns each User by id and name, with their username to tell namesakes apart', async () => {
    const users = { total: 1, rows: [{ id: 311, name: 'Jordan Reyes', first_name: 'Jordan', last_name: 'Reyes', username: 'jreyes' }] }
    const { fetch } = fakeFetch({ '/users': { body: users } })
    expect(await createSnipeIt(config, fetch).searchUsers('reyes')).toEqual([{ id: 311, name: 'Jordan Reyes', detail: 'jreyes', matched: 'Name' }])
  })

  it('searching Locations returns each Location by id and name', async () => {
    const locations = { total: 1, rows: [{ id: 12, name: 'Room 204', address: null }] }
    const { fetch } = fakeFetch({ '/locations': { body: locations } })
    expect(await createSnipeIt(config, fetch).searchLocations(' 204 ')).toEqual([{ id: 12, name: 'Room 204', detail: '', matched: 'Name' }])
  })

  it('a blank target search finds nothing without asking Snipe-IT', async () => {
    const { fetch, calls } = fakeFetch({})
    expect(await createSnipeIt(config, fetch).searchUsers('  ')).toEqual([])
    expect(calls).toEqual([])
  })
})

describe('checkout', () => {
  const ready = { ...chromebook, assigned_to: null, expected_checkin: null, status_label: { id: 1, name: 'Ready to Deploy', status_type: 'deployable', status_meta: 'deployable' } }
  const checkedOut = { status: 'success', messages: 'Asset checked out successfully.', payload: { asset: 'NOMMA-004812' } }
  const checkoutWith = (hardware: object, reply: { status?: number; body: unknown } = { body: checkedOut }) =>
    fakeFetch({ '/hardware/4812': { body: hardware }, 'POST /hardware/4812/checkout': reply })
  const posted = (requests: FakeRequest[]) => requests.filter((r) => r.method === 'POST')

  it('to a User sends the current status, the target type, and the assigned user', async () => {
    const { fetch, requests } = checkoutWith(ready)
    await createSnipeIt(config, fetch).checkout(4812, { targetType: 'user', targetId: 311 })
    expect(posted(requests)).toEqual([
      { method: 'POST', path: '/hardware/4812/checkout', body: { status_id: 1, checkout_to_type: 'user', assigned_user: 311 } },
    ])
  })

  it('to a Location sends the assigned location, the Expected Checkin, and the note', async () => {
    const { fetch, requests } = checkoutWith(ready)
    await createSnipeIt(config, fetch).checkout(4812, { targetType: 'location', targetId: 12, expectedCheckin: '2026-10-01', note: ' scuffed lid ' })
    expect(posted(requests)).toEqual([
      {
        method: 'POST',
        path: '/hardware/4812/checkout',
        body: { status_id: 1, checkout_to_type: 'location', assigned_location: 12, expected_checkin: '2026-10-01', note: 'scuffed lid' },
      },
    ])
  })

  it('to a User with an Expected Checkin sends it', async () => {
    const { fetch, requests } = checkoutWith(ready)
    await createSnipeIt(config, fetch).checkout(4812, { targetType: 'user', targetId: 311, expectedCheckin: '2026-10-01' })
    expect(posted(requests)[0].body).toEqual({ status_id: 1, checkout_to_type: 'user', assigned_user: 311, expected_checkin: '2026-10-01' })
  })

  it('to a Location without an Expected Checkin sends neither date nor note', async () => {
    const { fetch, requests } = checkoutWith(ready)
    await createSnipeIt(config, fetch).checkout(4812, { targetType: 'location', targetId: 12, note: '  ' })
    expect(posted(requests)[0].body).toEqual({ status_id: 1, checkout_to_type: 'location', assigned_location: 12 })
  })

  it('an Asset in inventory with a deployable status can be checked out', async () => {
    expect((await snipeItWith(ready).getAsset(4812)).checkoutAllowed).toBe(true)
  })

  it('an Asset that already has an Assignee cannot be checked out, and Snipe-IT is not asked to', async () => {
    expect((await snipeItWith(chromebook).getAsset(4812)).checkoutAllowed).toBe(false)
    const { fetch, requests } = checkoutWith(chromebook)
    await expect(createSnipeIt(config, fetch).checkout(4812, { targetType: 'user', targetId: 311 })).rejects.toThrow(
      /NOMMA-004812 is already checked out to Jordan Reyes/,
    )
    expect(posted(requests)).toEqual([])
  })

  it('an Asset whose status is not deployable cannot be checked out', async () => {
    const broken = { ...ready, status_label: { id: 5, name: 'Out for Repair', status_type: 'undeployable', status_meta: 'undeployable' } }
    expect((await snipeItWith(broken).getAsset(4812)).checkoutAllowed).toBe(false)
    const { fetch, requests } = checkoutWith(broken)
    await expect(createSnipeIt(config, fetch).checkout(4812, { targetType: 'user', targetId: 311 })).rejects.toThrow(
      /Out for Repair.*can't be checked out/,
    )
    expect(posted(requests)).toEqual([])
  })

  it('to another Asset sends the assigned asset', async () => {
    const { fetch, requests } = checkoutWith(ready)
    await createSnipeIt(config, fetch).checkout(4812, { targetType: 'asset', targetId: 77 })
    expect(posted(requests)[0].body).toEqual({ status_id: 1, checkout_to_type: 'asset', assigned_asset: 77 })
  })

  it('sends a Status Label override instead of the current one, and an Expected Checkin with its time of day (Central, to the second)', async () => {
    const { fetch, requests } = checkoutWith(ready)
    await createSnipeIt(config, fetch).checkout(4812, { targetType: 'user', targetId: 311, statusId: 2, expectedCheckin: '2026-10-13 14:50' })
    expect(posted(requests)[0].body).toEqual({ status_id: 2, checkout_to_type: 'user', assigned_user: 311, expected_checkin: '2026-10-13 14:50:00' })
  })

  it("refuses, writing nothing, when the Asset's Status Label isn't the one the caller expects it still has", async () => {
    const relabelled = { ...ready, status_label: { id: 3, name: 'Loaner Pool', status_type: 'deployable', status_meta: 'deployable' } }
    const { fetch, requests } = checkoutWith(relabelled)
    await expect(createSnipeIt(config, fetch).checkout(4812, { targetType: 'user', targetId: 311, statusId: 2, fromStatusId: 1 })).rejects.toThrow("NOMMA-004812 is 'Loaner Pool' now")
    expect(posted(requests)).toEqual([])
    const same = checkoutWith(ready)
    await createSnipeIt(config, same.fetch).checkout(4812, { targetType: 'user', targetId: 311, statusId: 2, fromStatusId: 1 })
    expect(posted(same.requests)[0].body).toEqual({ status_id: 2, checkout_to_type: 'user', assigned_user: 311 })
  })

  it("refuses, writing nothing, when the Asset isn't at the Location the caller expects (null: none)", async () => {
    const { fetch, requests } = checkoutWith(ready)
    const snipeIt = createSnipeIt(config, fetch)
    await expect(snipeIt.checkout(4812, { targetType: 'user', targetId: 311, fromLocationId: 4 })).rejects.toThrow('NOMMA-004812 is at Library now')
    await expect(snipeIt.checkout(4812, { targetType: 'user', targetId: 311, fromLocationId: null })).rejects.toThrow('NOMMA-004812 is at Library now')
    expect(posted(requests)).toEqual([])
    await snipeIt.checkout(4812, { targetType: 'user', targetId: 311, fromLocationId: 9 })
    const nowhere = checkoutWith({ ...ready, location: null })
    await expect(createSnipeIt(config, nowhere.fetch).checkout(4812, { targetType: 'user', targetId: 311, fromLocationId: 9 })).rejects.toThrow('NOMMA-004812 is at no Location now')
    await createSnipeIt(config, nowhere.fetch).checkout(4812, { targetType: 'user', targetId: 311, fromLocationId: null })
    expect(posted(requests).length + posted(nowhere.requests).length).toBe(2)
  })

  it('refuses another target type, a bad Status Label id or a malformed Expected Checkin without asking Snipe-IT', async () => {
    const { fetch, requests } = checkoutWith(ready)
    const snipeIt = createSnipeIt(config, fetch)
    const toDepartment = { targetType: 'department', targetId: 77 } as unknown as CheckoutOptions
    await expect(snipeIt.checkout(4812, toDepartment)).rejects.toThrow(/User, a Location or another Asset/)
    await expect(snipeIt.checkout(4812, { targetType: 'user', targetId: 311, statusId: 1.5 })).rejects.toThrow(/Invalid status id/)
    await expect(snipeIt.checkout(4812, { targetType: 'user', targetId: 311, expectedCheckin: 'next Tuesday' })).rejects.toThrow(/YYYY-MM-DD/)
    expect(requests).toEqual([])
  })

  describe('a Status Label override on an Asset whose label is not deployable (an undo putting Damaged back)', () => {
    const damaged = { ...ready, status_label: { id: 9, name: 'Damaged', status_type: 'undeployable', status_meta: 'undeployable' } }
    const statusSet = { body: { status: 'success', messages: 'Updated.', payload: {} } }

    it('sets the override first, since Snipe-IT checks out only an Asset that is deployable now, then checks it out with it', async () => {
      const { fetch, requests } = fakeFetch({ '/hardware/4812': { body: damaged }, 'PATCH /hardware/4812': statusSet, 'POST /hardware/4812/checkout': { body: checkedOut } })
      await createSnipeIt(config, fetch).checkout(4812, { targetType: 'user', targetId: 311, statusId: 2, note: '[Undo] Repair intake' })
      expect(requests.filter((r) => r.method !== 'GET')).toEqual([
        { method: 'PATCH', path: '/hardware/4812', body: { status_id: 2 } },
        { method: 'POST', path: '/hardware/4812/checkout', body: { status_id: 2, checkout_to_type: 'user', assigned_user: 311, note: '[Undo] Repair intake' } },
      ])
    })

    it('puts the old label back when Snipe-IT refuses the Checkout, and says why', async () => {
      const refused = { body: { status: 'error', messages: 'That asset is not available for checkout!', payload: null } }
      const { fetch, requests } = fakeFetch({ '/hardware/4812': { body: damaged }, 'PATCH /hardware/4812': statusSet, 'POST /hardware/4812/checkout': refused })
      await expect(createSnipeIt(config, fetch).checkout(4812, { targetType: 'user', targetId: 311, statusId: 5 })).rejects.toThrow('That asset is not available for checkout!')
      expect(requests.filter((r) => r.method !== 'GET').map((r) => `${r.method} ${JSON.stringify(r.body)}`)).toEqual(['PATCH {"status_id":5}', expect.stringMatching(/^POST /), 'PATCH {"status_id":9}'])
    })

    it("says so when the old label can't be put back either", async () => {
      let patches = 0
      const { fetch } = fakeFetch({
        '/hardware/4812': { body: damaged },
        'PATCH /hardware/4812': { body: () => (++patches === 1 ? statusSet.body : { status: 'error', messages: 'Snipe-IT said no', payload: null }) },
        'POST /hardware/4812/checkout': { body: { status: 'error', messages: 'That asset is not available for checkout!', payload: null } },
      })
      await expect(createSnipeIt(config, fetch).checkout(4812, { targetType: 'user', targetId: 311, statusId: 5 })).rejects.toThrow("That asset is not available for checkout! (its Status Label is still the new one: put back 'Damaged' by hand)")
    })

    it("a refused override is never checked out", async () => {
      const { fetch, requests } = fakeFetch({ '/hardware/4812': { body: damaged }, 'PATCH /hardware/4812': { body: { status: 'error', messages: { status_id: ['Choose a valid status.'] }, payload: null } } })
      await expect(createSnipeIt(config, fetch).checkout(4812, { targetType: 'user', targetId: 311, statusId: 2 })).rejects.toThrow('Choose a valid status.')
      expect(requests.filter((r) => r.method === 'POST')).toEqual([])
    })
  })

  it("a Checkout Snipe-IT rejects is thrown as Snipe-IT's reason", async () => {
    const refused = { status: 'error', messages: { assigned_user: ['The selected assigned user is invalid.'] }, payload: null }
    const { fetch } = checkoutWith(ready, { body: refused })
    await expect(createSnipeIt(config, fetch).checkout(4812, { targetType: 'user', targetId: 999 })).rejects.toThrow(
      'The selected assigned user is invalid.',
    )
  })
})

describe('audit', () => {
  // Snipe-IT v8.6.3+ answers with the next audit date it set, as a date object (Helper::getFormattedDateObject).
  const audited = (next: string | null) => ({ status: 'success', messages: 'Asset audited successfully.', payload: { asset_tag: 'NOMMA-004812', next_audit_date: next && { date: next, formatted: next } } })
  const auditWith = (reply: { status?: number; body: unknown } = { body: audited('2027-10-10') }) =>
    fakeFetch({ '/hardware/4812': { body: { ...chromebook, next_audit_date: { date: '2026-10-01', formatted: '2026-10-01' } } }, 'POST /hardware/4812/audit': reply })
  const posted = (requests: FakeRequest[]) => requests.filter((r) => r.method === 'POST').map((r) => r.body)

  it('with nothing typed sends only the [Audit] note, so Snipe-IT sets the next audit date from its audit interval, and never a Location', async () => {
    const { fetch, requests } = auditWith()
    expect(await createSnipeIt(config, fetch).audit(4812, {})).toEqual({ was: '2026-10-01', next: '2027-10-10' })
    expect(posted(requests)).toEqual([{ note: '[Audit]' }])
  })

  it('sends the typed note, cleaned, after the tag, and Next audit when filled in', async () => {
    const { fetch, requests } = auditWith()
    await createSnipeIt(config, fetch).audit(4812, { nextAudit: '2027-10-10', note: ' seen in *Room 204*,\n sticker replaced ' })
    expect(requests.filter((r) => r.method === 'POST')).toEqual([
      { method: 'POST', path: '/hardware/4812/audit', body: { note: '[Audit] seen in Room 204, sticker replaced', next_audit_date: '2027-10-10' } },
    ])
  })

  it('refuses a link in the note or a Next audit that is not a date, without asking Snipe-IT', async () => {
    const { fetch, requests } = auditWith()
    const snipeIt = createSnipeIt(config, fetch)
    await expect(snipeIt.audit(4812, { note: 'see https://example.org' })).rejects.toThrow(/links/)
    await expect(snipeIt.audit(4812, { nextAudit: '10/10/2027' })).rejects.toThrow(/YYYY-MM-DD/)
    expect(posted(requests)).toEqual([])
  })

  it('says when Snipe-IT sent back no next audit date (it has no audit interval set)', async () => {
    const { fetch } = auditWith({ body: audited(null) })
    expect(await createSnipeIt(config, fetch).audit(4812, {})).toEqual({ was: '2026-10-01', next: null })
  })

  it("an Audit Snipe-IT refuses is thrown as Snipe-IT's reason", async () => {
    const { fetch } = auditWith({ body: { status: 'error', messages: 'You do not have permission to audit this asset.', payload: null } })
    await expect(createSnipeIt(config, fetch).audit(4812, {})).rejects.toThrow('You do not have permission to audit this asset.')
  })
})

describe('dashboard (today is 2026-09-24)', () => {
  // A fake Snipe-IT that pages each list (hardware, licenses, users, …) by limit/offset, capped at pageMax.
  // A list given as { status, body } answers that instead, e.g. a permission error. Records every URL it was asked for.
  // A status filter is its own list, e.g. 'hardware?status=Archived'; the fake answers it with nothing unless given.
  // A search keeps the rows that mention it anywhere, as Snipe-IT's does across a row's fields.
  type Refusal = { status?: number; body: unknown }
  function fleet(lists: Record<string, object[] | Refusal>, pageMax = 500) {
    const urls: URL[] = []
    const fetch = (async (input: string | URL | Request) => {
      const url = new URL(String(input))
      urls.push(url)
      const status = url.searchParams.get('status')
      const path = url.pathname.replace('/api/v1/', '')
      const list = status ? lists[`${path}?status=${status}`] ?? [] : lists[path]
      if (!list) return new Response(JSON.stringify(notFound), { status: 404 })
      if (!Array.isArray(list)) return new Response(JSON.stringify(list.body), { status: list.status ?? 200 })
      const search = url.searchParams.get('search')?.toLowerCase()
      const rows = search ? list.filter((r) => JSON.stringify(r).toLowerCase().includes(search)) : list
      const limit = Math.min(Number(url.searchParams.get('limit') ?? 50), pageMax)
      const offset = Number(url.searchParams.get('offset') ?? 0)
      return new Response(JSON.stringify({ total: rows.length, rows: rows.slice(offset, offset + limit) }))
    }) as typeof globalThis.fetch
    const offsets = (list: string) => urls.filter((u) => u.pathname === `/api/v1/${list}` && !u.searchParams.has('status')).map((u) => Number(u.searchParams.get('offset')))
    const listsAsked = () => [...new Set(urls.map((u) => u.pathname.replace('/api/v1/', '')))].sort()
    return { snipeIt: createSnipeIt(config, fetch, today), fetch, urls, offsets, listsAsked }
  }
  const asset = (id: number, fields: object = {}) => ({
    ...chromebook, id, asset_tag: `NOMMA-${id}`, expected_checkin: null, warranty_expires: null, ...fields,
  })
  const deployed = chromebook.status_label
  const ready = { id: 1, name: 'Ready to Deploy', status_meta: 'deployable' }
  const repair = { id: 3, name: 'Out for Repair', status_meta: 'undeployable' }
  // Shaped like Snipe-IT's /statuslabels rows (trimmed).
  const labels = [
    { id: 1, name: 'Ready to Deploy', type: 'deployable', color: '#2ea043' },
    { id: 2, name: 'Deployed', type: 'deployable', color: null },
    { id: 3, name: 'Out for Repair', type: 'undeployable', color: '#ff8800' },
  ]
  const denied = { status: 403, body: { status: 'error', messages: 'You do not have permission to view Licenses.' } }

  it('pages through every Asset, 500 at a time', async () => {
    const { snipeIt, offsets } = fleet({ hardware: Array.from({ length: 1234 }, (_, i) => asset(i + 1)), statuslabels: labels })
    const { assets } = await snipeIt.dashboard(['assets'])
    expect(offsets('hardware')).toEqual([0, 500, 1000])
    expect(assets).toMatchObject([{ name: 'Deployed', count: 1234 }])
  })

  it('after the first page, asks for the rest four at a time instead of one after another', async () => {
    const { fetch, offsets } = fleet({ hardware: Array.from({ length: 2600 }, (_, i) => asset(i + 1)) })
    let open = 0, most = 0
    const counting = (async (...args: Parameters<typeof fetch>) => {
      most = Math.max(most, ++open)
      await new Promise((r) => setTimeout(r, 5))
      try { return await fetch(...args) } finally { open-- }
    }) as typeof globalThis.fetch
    await createSnipeIt(config, counting, today).dashboard(['overdue'])
    expect(offsets('hardware')).toEqual([0, 500, 1000, 1500, 2000, 2500])
    expect(most).toBe(4)
  })

  it('still gets every Asset when the server caps pages below 500', async () => {
    const { snipeIt, offsets } = fleet({ hardware: Array.from({ length: 250 }, (_, i) => asset(i + 1)), statuslabels: labels }, 100)
    const { assets } = await snipeIt.dashboard(['assets'])
    expect(offsets('hardware')).toEqual([0, 100, 200])
    expect(assets).toMatchObject([{ count: 250 }])
  })

  it("counts Assets by Status Label, most first, with the label's kind and Snipe-IT's color (null when it has none), and no Assets", async () => {
    const { snipeIt } = fleet({
      hardware: [
        asset(1), asset(2, { status_label: ready, assigned_to: null }), asset(3),
        asset(4, { status_label: repair, assigned_to: null }), asset(5, { status_label: ready, assigned_to: null }), asset(6),
      ],
      statuslabels: labels,
    })
    expect(await snipeIt.dashboard(['assets'])).toEqual({ assets: [
      { id: 2, name: 'Deployed', type: 'deployable', color: null, count: 3 },
      { id: 1, name: 'Ready to Deploy', type: 'deployable', color: '#2ea043', count: 2 },
      { id: 3, name: 'Out for Repair', type: 'undeployable', color: '#ff8800', count: 1 },
    ] })
  })

  // Snipe-IT's plain Asset list leaves Archived Assets out unless the admin turned on "show archived in list".
  const archived = { id: 4, name: 'Archived', status_meta: 'archived' }
  it('counts Archived Assets in the Status Label chart, once each, whether or not the plain list includes them', async () => {
    const shelved = [asset(7, { status_label: archived, assigned_to: null }), asset(8, { status_label: archived, assigned_to: null })]
    const hidden = fleet({ hardware: [asset(1)], 'hardware?status=Archived': shelved, statuslabels: labels })
    const shown = fleet({ hardware: [asset(1), ...shelved], 'hardware?status=Archived': shelved, statuslabels: labels })
    for (const { snipeIt } of [hidden, shown])
      expect(await snipeIt.dashboard(['assets'])).toEqual({ assets: [
        expect.objectContaining({ name: 'Archived', count: 2 }),
        expect.objectContaining({ name: 'Deployed', count: 1 }),
      ] })
  })

  it('Overdue and Warranty expiring leave Archived Assets out, as before', async () => {
    const late = { expected_checkin: { datetime: '2026-09-01 00:00:00' }, warranty_expires: { date: '2026-10-01' } }
    const { snipeIt } = fleet({ hardware: [asset(1, late)], 'hardware?status=Archived': [asset(9, { ...late, status_label: archived })] })
    const { overdue, expiring } = await snipeIt.dashboard(['overdue', 'expiring'])
    expect([overdue && 'rows' in overdue && overdue.rows, expiring].map((rows) => Array.isArray(rows) && rows.map((a) => a.id))).toEqual([[1], [1]])
  })

  it("Status Labels that can't be loaded leave every label without a color, its kind read from the Asset (deployed is deployable)", async () => {
    const { snipeIt } = fleet({ hardware: [asset(1), asset(2, { status_label: repair }), asset(3, { status_label: null })], statuslabels: denied })
    expect(await snipeIt.dashboard(['assets'])).toEqual({
      assets: [
        { id: 2, name: 'Deployed', type: 'deployable', color: null, count: 1 },
        { id: null, name: 'No Status Label', type: '', color: null, count: 1 },
        { id: 3, name: 'Out for Repair', type: 'undeployable', color: null, count: 1 },
      ],
    })
  })

  it('counts Assets by Category and by current Location, most first (ties by name), with No Location for Assets without one', async () => {
    const tablet = { id: 5, name: 'Tablet' }, gym = { id: 2, name: 'Gym' }
    const { snipeIt } = fleet({ hardware: [
      asset(1), asset(2, { category: tablet, location: null }), asset(3, { location: gym }), asset(4, { category: tablet, location: null }), asset(5, { category: null }),
    ] })
    expect(await snipeIt.dashboard(['categories', 'locations'])).toEqual({
      categories: [{ id: 3, name: 'Chromebook', count: 2 }, { id: 5, name: 'Tablet', count: 2 }, { id: null, name: 'No Category', count: 1 }],
      locations: [{ id: 9, name: 'Library', count: 2 }, { id: null, name: 'No Location', count: 2 }, { id: 2, name: 'Gym', count: 1 }],
    })
  })

  it('lists every Overdue Asset with its Assignee, Expected Checkin and how late, most late first', async () => {
    const { snipeIt } = fleet({ hardware: [
      asset(1, { expected_checkin: { datetime: '2026-09-23 00:00:00' } }),
      asset(6, { expected_checkin: { datetime: '2026-09-23 14:50:00' } }), // a time of day: late since 14:50, before 1's end of day
      asset(2, { expected_checkin: { datetime: '2026-09-24 00:00:00' } }), // due today: not Overdue
      asset(3, { expected_checkin: { datetime: '2026-09-01 00:00:00' } }),
      asset(4, { expected_checkin: { datetime: '2026-09-01 00:00:00' }, assigned_to: null }), // no Assignee: not Overdue
      asset(5), // no Expected Checkin: never Overdue
    ] })
    const { overdue } = await snipeIt.dashboard(['overdue'])
    if (!overdue || !('rows' in overdue)) throw new Error('expected rows')
    expect(overdue.rows.map((a) => [a.assetTag, a.expectedCheckin, lateness(a.overdue)])).toEqual([
      ['NOMMA-3', '2026-09-01', '23d'], ['NOMMA-6', '2026-09-23 14:50', '1d'], ['NOMMA-1', '2026-09-23', '1d'],
    ])
    expect(overdue.rows[0]).toMatchObject({ id: 3, name: 'CB-LIB-012', assignee: { type: 'user', id: 311, name: 'Jordan Reyes' } })
  })

  // Outstanding Temp checkouts (#61 §2). Today is 2026-09-24, so every 14:50 due time on the 23rd has passed.
  const checkedOut = (id: number, due: string, lastCheckout: string) =>
    asset(id, { expected_checkin: { datetime: due }, last_checkout: { datetime: lastCheckout, formatted: lastCheckout } })
  const logged = (id: number, item: number, when: string, note: string) => ({
    id, action_type: 'checkout', created_at: { datetime: when }, created_by: { id: 5, name: 'Demo Operator' },
    target: { id: 311, name: 'Jordan Reyes', type: 'user' }, note, item: { id: item, name: `NOMMA-${item}`, type: 'asset' },
  })
  const tempHardware = [
    checkedOut(1, '2026-09-23 14:50:00', '2026-09-23 09:05:12'), // its tagged Checkout is the current one
    checkedOut(2, '2026-09-22 14:50:00', '2026-09-23 10:00:00'), // checked in and out again in the web UI since its tag
    checkedOut(3, '2026-09-20 00:00:00', '2026-09-19 08:00:00'), // date-only Expected Checkin
    checkedOut(4, '2026-09-23 14:50:00', '2026-09-23 12:00:00'), // Bulk return, then its undo put the Temp tag back
    checkedOut(5, '2026-09-23 15:30:00', '2026-09-23 07:00:00'), // a time of day, but not a Temp checkout
  ]
  // Newest first, as asked for.
  const tempLog = [
    logged(16, 4, '2026-09-23 12:00:01', '[Undo] Bulk return [Temp checkout | due: 2026-09-23 14:50]'),
    logged(15, 1, '2026-09-23 09:05:13', '[Temp  checkout | due: 2026-09-23 14:50] Charger included'), // typed by hand in the web UI
    logged(14, 4, '2026-09-23 09:00:00', '[Temp checkout | due: 2026-09-23 14:50]'),
    logged(13, 5, '2026-09-23 07:00:00', '[Bulk checkout] Temp checkout of the cart'),
    logged(12, 2, '2026-09-22 08:00:00', '[Temp checkout | due: 2026-09-22 14:50]'),
    logged(11, 3, '2026-09-19 08:00:00', '[Temp checkout | due: 2026-09-20 14:50]'),
    logged(10, 2, '2026-09-18 08:00:00', '[Temp checkout | due: 2026-09-18 14:50]'),
  ]
  const tempFleet = (pageMax?: number) => fleet({ hardware: tempHardware, 'reports/activity': tempLog }, pageMax)
  const temps = (overdue: Dashboard['overdue']) => (overdue && 'rows' in overdue ? overdue.rows.filter((a) => a.temp).map((a) => a.id).sort() : overdue)

  it('marks Overdue Temp checkouts: a tagged current Checkout or an undo-restored tag, not a later Checkout or a date-only one', async () => {
    const { snipeIt, urls } = tempFleet()
    const { overdue } = await snipeIt.dashboard(['overdue'])
    expect(temps(overdue)).toEqual([1, 4])
    expect(overdue && 'rows' in overdue && overdue.rows.map((a) => a.id)).toEqual([3, 2, 1, 4, 5])
    // One request: only tagged Checkouts, newest first, and the first page already reaches back past the oldest candidate.
    const asked = urls.filter((u) => u.pathname === '/api/v1/reports/activity')
    expect(asked.map((u) => Object.fromEntries(u.searchParams))).toEqual([
      { action_type: 'checkout', item_type: 'asset', search: 'Temp', sort: 'created_at', order: 'desc', limit: '500', offset: '0' },
    ])
  })

  it('pages the Activity Report only until past the oldest candidate\'s last Checkout', async () => {
    const { snipeIt, offsets } = tempFleet(2)
    expect(temps((await snipeIt.dashboard(['overdue'])).overdue)).toEqual([1, 4])
    // The second page ends at the oldest candidate's own Checkout; the third goes past it, so a fourth isn't asked for.
    expect(offsets('reports/activity')).toEqual([0, 2, 4])
  })

  it('asks the Activity Report nothing when no checked-out Asset has a time of day', async () => {
    const { snipeIt, listsAsked } = fleet({ hardware: [asset(1, { expected_checkin: { datetime: '2026-09-01 00:00:00' }, last_checkout: { datetime: '2026-08-31 09:00:00' } })] })
    expect(temps((await snipeIt.dashboard(['overdue'])).overdue)).toEqual([])
    expect(listsAsked()).toEqual(['hardware'])
  })

  it('an Activity Report Snipe-IT refuses still lists Overdue, with no Temp marks and the reason', async () => {
    const refused = { status: 403, body: { status: 'error', messages: 'You do not have permission to view the Activity Report.' } }
    const { snipeIt } = fleet({ hardware: [checkedOut(1, '2026-09-23 14:50:00', '2026-09-23 09:05:12')], 'reports/activity': refused })
    expect((await snipeIt.dashboard(['overdue'])).overdue).toEqual({
      rows: [expect.objectContaining({ id: 1, temp: false })], tempError: 'Snipe-IT returned HTTP 403: You do not have permission to view the Activity Report.',
    })
  })

  it('Temp only keeps the Temp checkouts, and Health warning 5 counts the same list', async () => {
    const { overdue } = await tempFleet().snipeIt.dashboard(['overdue'])
    if (!overdue || !('rows' in overdue)) throw new Error('expected rows')
    expect(overdueList(overdue.rows, true).map((a) => a.assetTag)).toEqual(['NOMMA-1', 'NOMMA-4'])
    expect(overdueList(overdue.rows, false)).toBe(overdue.rows)
    expect(healthLines({ probe: { version: 'v8.8.0' }, auditLate: 0, auditDue: 0, deactivated: { assets: 0, users: 0 } }, null, overdue)).toEqual([{ warning: 'temp', count: 2 }])
  })

  describe('the Out on temp and Overdue Views, computed in the app', () => {
    it('Out on temp keeps the checked-out Assets the Temp lookup counts, fetched whole with the boxes, then sorted here', async () => {
      const { snipeIt, urls } = fleet({ 'hardware?status=Deployed': tempHardware, 'reports/activity': tempLog })
      const page = await snipeIt.list('assets', { view: 'outOnTemp', search: 'nomma', filters: { location_id: '9' }, sort: 'assetTag', order: 'desc' })
      expect(page).toMatchObject({ total: 2, rows: [{ id: 4, temp: true }, { id: 1, temp: true }] })
      expect(urls.filter((u) => u.pathname === '/api/v1/hardware').map((u) => Object.fromEntries(u.searchParams))).toEqual([
        { search: 'nomma', location_id: '9', status: 'Deployed', limit: '500', offset: '0', sort: 'id', order: 'asc' },
      ])
    })

    it("Out on temp can't be shown without the Temp lookup, so the Activity Report refused fails it", async () => {
      const refused = { status: 403, body: { status: 'error', messages: 'You do not have permission to view the Activity Report.' } }
      const { snipeIt } = fleet({ 'hardware?status=Deployed': tempHardware, 'reports/activity': refused })
      await expect(snipeIt.list('assets', { view: 'outOnTemp' })).rejects.toThrow('permission to view the Activity Report')
    })

    it("the All View marks the page's Temp checkouts; a refused Activity Report leaves them unmarked, saying why", async () => {
      const marked = await fleet({ hardware: tempHardware, 'reports/activity': tempLog }).snipeIt.list('assets')
      expect(marked.rows.filter((a) => a.temp).map((a) => a.id)).toEqual([1, 4])
      expect(marked).not.toHaveProperty('tempError')
      const refused = { status: 403, body: { status: 'error', messages: 'No Activity Report for you.' } }
      const unmarked = await fleet({ hardware: tempHardware, 'reports/activity': refused }).snipeIt.list('assets')
      expect(unmarked).toMatchObject({ total: 5, tempError: 'Snipe-IT returned HTTP 403: No Activity Report for you.' })
      expect(unmarked.rows.some((a) => a.temp)).toBe(false)
    })

    // Today is 2026-09-24 and it's 3 pm. Snipe-IT's /hardware/checkins/overdue answers what its own rule counts: a checked-out
    // Asset whose Expected Checkin is before now, a date-only one from its midnight.
    const afternoon = () => new Date(2026, 8, 24, 15, 0)
    const due = [
      checkedOut(1, '2026-09-24 00:00:00', '2026-09-20 08:00:00'), // date-only, due today: Snipe-IT says late, the app not yet
      checkedOut(2, '2026-09-24 14:50:00', '2026-09-24 08:00:00'), // a time of day already past
      checkedOut(3, '2026-09-23 00:00:00', '2026-09-20 08:00:00'), // date-only, due yesterday
      checkedOut(4, '2026-09-23 14:50:00', '2026-09-23 12:00:00'), // a Temp checkout put back by an undo
      checkedOut(5, '2026-09-24 15:30:00', '2026-09-24 08:00:00'), // due later today
      asset(6, { expected_checkin: { datetime: '2026-09-01 00:00:00' }, assigned_to: null }), // checked in
    ]
    const snipeItLate = due.slice(0, 4) // what Snipe-IT's rule answers: checked out and due before 3 pm
    const overdueFleet = (rows = snipeItLate) => {
      const { fetch, urls } = fleet({ hardware: due, 'hardware/checkins/overdue': rows, 'reports/activity': tempLog })
      return { snipeIt: createSnipeIt(config, fetch, afternoon), urls }
    }

    it('Overdue drops a date-only Asset due today and keeps a time of day past its time; Temp checkouts carry their mark', async () => {
      const { snipeIt, urls } = overdueFleet()
      const page = await snipeIt.list('assets', { view: 'overdue', search: 'nomma', filters: { category_id: '3' }, sort: 'expectedCheckin', order: 'asc' })
      expect(page.rows.map((a) => [a.id, a.expectedCheckin, a.temp])).toEqual([[3, '2026-09-23', false], [4, '2026-09-23 14:50', true], [2, '2026-09-24 14:50', false]])
      expect(page.total).toBe(3)
      expect(urls.filter((u) => u.pathname === '/api/v1/hardware/checkins/overdue').map((u) => Object.fromEntries(u.searchParams))).toEqual([
        { search: 'nomma', category_id: '3', limit: '500', offset: '0', sort: 'id', order: 'asc' },
      ])
    })

    it('the Overdue View, the dashboard Overdue list and the Overdue Report list the same Assets', async () => {
      const { snipeIt } = overdueFleet()
      const view = (await snipeIt.list('assets', { view: 'overdue' })).rows.map((a) => a.assetTag)
      const { overdue } = await snipeIt.dashboard(['overdue'])
      const report = (await snipeIt.report('overdue')).rows.map((r) => r[0])
      expect(view.sort()).toEqual(['NOMMA-2', 'NOMMA-3', 'NOMMA-4'])
      expect(overdue && 'rows' in overdue && overdue.rows.map((a) => a.assetTag).sort()).toEqual(view)
      expect(report.sort()).toEqual(view)
    })

    it('sorts and pages the whole set here, and "Select all N matching" gets every one of it', async () => {
      const many = Array.from({ length: 60 }, (_, i) => checkedOut(i + 1, `2026-09-${String(1 + (i % 20)).padStart(2, '0')} 00:00:00`, '2026-08-31 08:00:00'))
      const { snipeIt, urls } = overdueFleet(many)
      const second = await snipeIt.list('assets', { view: 'overdue', sort: 'expectedCheckin', order: 'desc', offset: 50 })
      expect(second.total).toBe(60)
      // Three Assets due each day from the 1st to the 20th, latest first: the last ten are due on the 4th to the 1st.
      expect(second.rows.map((a) => a.expectedCheckin!.slice(8))).toEqual(['04', '03', '03', '03', '02', '02', '02', '01', '01', '01'])
      // End to end: the List's own Select all, paging through this View as the window does.
      const all = await allMatching((offset) => snipeIt.list('assets', { view: 'overdue', sort: 'id', order: 'asc', offset }))
      expect([...all!.keys()]).toEqual(many.map((a) => a.id))
      // Each page asks Snipe-IT for the whole set again, never for a page of it.
      expect(urls.filter((u) => u.pathname === '/api/v1/hardware/checkins/overdue').every((u) => u.searchParams.get('offset') === '0')).toBe(true)
    })

    // Export CSV, Email me now and Schedules all run a Saved Report through reportRunner.
    describe('a Saved Report runs its View', () => {
      const saved = (id: string, view?: AssetView) => ({ id, name: id, kind: 'assets' as const, search: '', filters: { location_id: '9' }, sort: null, columns: ['assetTag'], ...(view && { view }) })
      const reports = [saved('Audit late, Library', 'auditLate'), saved('Out on temp, Library', 'outOnTemp'), saved('Library')]
      const late = [asset(7, { next_audit_date: { date: '2026-09-01' } })]

      it('Audit late exports from the audit route with its filters, with its View column', async () => {
        const { snipeIt, urls } = fleet({ 'hardware/audit/overdue': late })
        const run = await reportRunner(snipeIt, () => reports)({ saved: 'Audit late, Library' })
        expect(run).toMatchObject({ columns: ['Asset Tag', 'Next audit'], rows: [['NOMMA-7', '2026-09-01']] })
        expect(urls.map((u) => [u.pathname, u.searchParams.get('location_id')])).toEqual([['/api/v1/hardware/audit/overdue', '9']])
      })

      it('Out on temp runs the Temp checkout lookup', async () => {
        const { snipeIt, listsAsked } = fleet({ 'hardware?status=Deployed': tempHardware, 'reports/activity': tempLog })
        const run = await reportRunner(snipeIt, () => reports)({ saved: 'Out on temp, Library' })
        expect(run.rows.map((r) => r[0])).toEqual(['NOMMA-1', 'NOMMA-4'])
        expect(run.columns).toEqual(['Asset Tag', 'Expected checkin'])
        expect(listsAsked()).toEqual(['hardware', 'reports/activity'])
      })

      it('one without a View runs the All View, as before', async () => {
        const { snipeIt, urls } = fleet({ hardware: late })
        const run = await reportRunner(snipeIt, () => reports)({ saved: 'Library' })
        expect(run).toMatchObject({ columns: ['Asset Tag'], rows: [['NOMMA-7']] })
        expect(urls.map((u) => u.pathname)).toEqual(['/api/v1/hardware'])
      })
    })
  })

  it('lists Expiring Warranties in the next 90 days, soonest first, leaving out expired ones', async () => {
    const { snipeIt } = fleet({ hardware: [
      asset(1, { warranty_expires: { date: '2026-12-23' } }), // 90 days
      asset(2, { warranty_expires: { date: '2026-12-24' } }), // 91 days: not Expiring
      asset(3, { warranty_expires: { date: '2026-09-24' } }), // today
      asset(4, { warranty_expires: { date: '2026-09-23' } }), // expired
      asset(5, { warranty_expires: { date: '2026-10-01' } }),
    ] })
    const { expiring } = await snipeIt.dashboard(['expiring'])
    if (!Array.isArray(expiring)) throw new Error('expected rows')
    expect(expiring.map((a) => [a.assetTag, a.daysLeft])).toEqual([['NOMMA-3', 0], ['NOMMA-5', 7], ['NOMMA-1', 90]])
  })

  it("an Asset list Snipe-IT refuses becomes that piece's error, Snipe-IT's own reason", async () => {
    const { snipeIt } = fleet({ hardware: { body: { status: 'error', messages: 'You do not have permission.', payload: null } } })
    expect(await snipeIt.dashboard(['overdue'])).toEqual({ overdue: { error: 'You do not have permission.' } })
  })

  // Shaped like the Snipe-IT API reference list rows (trimmed).
  const licenses = [
    { id: 1, name: 'Office Suite', seats: 40, free_seats_count: 12 },
    { id: 2, name: 'Typing Tutor', seats: 30, free_seats_count: 30 },
  ]
  const accessories = [
    { id: 1, name: 'USB-C Charger', qty: 60, remaining_qty: 18, min_qty: 10 },
    { id: 2, name: 'Wired Mouse', qty: 25, remaining_qty: 25, min_qty: 5 },
  ]
  const consumables = [{ id: 1, name: 'Toner (Black)', qty: 20, remaining: 6, min_amt: 4 }]
  const components = [
    { id: 1, name: '8GB SODIMM', qty: 10, remaining: 7, min_amt: 2 },
    { id: 2, name: '256GB SSD', qty: 5, remaining: 0, min_amt: 1 },
  ]

  it("a License's assigned seats are In use and its free seats are Free, summed across every License", async () => {
    const { snipeIt } = fleet({ licenses })
    expect(await snipeIt.dashboard(['licenses'])).toEqual({ licenses: { used: 28, available: 42 } })
  })

  it('Accessories are Checked out or Available, Consumables Used or Remaining, Components In use or Available', async () => {
    const { snipeIt } = fleet({ accessories, consumables, components })
    expect(await snipeIt.dashboard(['accessories', 'consumables', 'components'])).toEqual({
      accessories: { used: 42, available: 43 },
      consumables: { used: 14, available: 6 },
      components: { used: 8, available: 7 },
    })
  })

  it("a list without the count fields shows that kind's error rather than a wrong number", async () => {
    const { snipeIt } = fleet({ accessories: [{ id: 1, name: 'USB-C Charger', qty: 60 }], consumables })
    expect(await snipeIt.dashboard(['accessories', 'consumables'])).toEqual({
      accessories: { error: expect.stringMatching(/remaining_qty/) },
      consumables: { used: 14, available: 6 },
    })
  })

  it('an Accessory or Component of quantity 0 counts as 0, though Snipe-IT sends its qty as null', async () => {
    const { snipeIt } = fleet({
      accessories: [...accessories, { id: 3, name: 'Stylus', qty: null, remaining_qty: 0, min_qty: null }],
      components: [...components, { id: 3, name: '16GB SODIMM', qty: null, remaining: 0, min_amt: null }],
    })
    expect(await snipeIt.dashboard(['accessories', 'components'])).toEqual({
      accessories: { used: 42, available: 43 },
      components: { used: 8, available: 7 },
    })
  })

  it('a kind with nothing in it counts 0 and 0, not an error', async () => {
    const { snipeIt } = fleet({ components: [] })
    expect(await snipeIt.dashboard(['components'])).toEqual({ components: { used: 0, available: 0 } })
  })

  it('every page of Licenses is fetched when the server caps page size', async () => {
    const many = Array.from({ length: 7 }, (_, i) => ({ id: i + 1, name: `License ${i + 1}`, seats: 2, free_seats_count: 1 }))
    const { snipeIt, offsets } = fleet({ licenses: many }, 3)
    expect(await snipeIt.dashboard(['licenses'])).toEqual({ licenses: { used: 7, available: 7 } })
    expect(offsets('licenses')).toEqual([0, 3, 6])
  })

  it("Licenses refused with a permission error doesn't stop Accessories from loading", async () => {
    const { snipeIt } = fleet({ licenses: denied, accessories })
    expect(await snipeIt.dashboard(['licenses', 'accessories'])).toEqual({
      licenses: { error: 'Snipe-IT returned HTTP 403: You do not have permission to view Licenses.' },
      accessories: { used: 42, available: 43 },
    })
  })

  it('a hidden kind is never requested', async () => {
    const { snipeIt, listsAsked } = fleet({ hardware: [asset(1)], statuslabels: labels, licenses, accessories, consumables, components })
    await snipeIt.dashboard(['licenses', 'consumables'])
    expect(listsAsked()).toEqual(['consumables', 'licenses'])
  })

  it('the Asset list is fetched once for the Status Label, Category and Location charts, Overdue and Warranty expiring together', async () => {
    const { snipeIt, offsets, listsAsked } = fleet({ hardware: [asset(1)], statuslabels: labels })
    const result = await snipeIt.dashboard(['categories', 'locations', 'overdue', 'expiring'])
    expect(Object.keys(result).sort()).toEqual(['categories', 'expiring', 'locations', 'overdue'])
    expect(listsAsked()).toEqual(['hardware'])
    await snipeIt.dashboard(['assets', 'categories', 'locations', 'overdue', 'expiring'])
    expect(offsets('hardware')).toEqual([0, 0])
  })

  it('Upcoming audits: next audit dates grouped by day, today to 12 months ahead inclusive, soonest first', async () => {
    const next = (date: string | null) => ({ next_audit_date: date && { date, formatted: date } })
    const { snipeIt } = fleet({ hardware: [
      asset(1, next('2026-12-01')), asset(2, next('2026-09-24')), asset(3, next('2026-12-01')), asset(4, next('2026-09-23')),
      asset(5, next('2027-09-24')), asset(6, next('2027-09-25')), asset(7, next(null)),
    ] })
    const { audits } = await snipeIt.dashboard(['audits'])
    expect(audits).toMatchObject([
      { day: '2026-09-24', assets: [{ id: 2, assetTag: 'NOMMA-2' }] },
      { day: '2026-12-01', assets: [{ id: 1 }, { id: 3 }] },
      { day: '2027-09-24', assets: [{ id: 5 }] },
    ])
  })

  it('Upcoming audits leaves out Archived Assets, which "show archived in list" puts in the Asset list', async () => {
    const next = (date: string) => ({ next_audit_date: { date, formatted: date } })
    const archived = { status_label: { id: 4, name: 'Archived', status_meta: 'archived' }, assigned_to: null }
    const { snipeIt } = fleet({ hardware: [asset(1, next('2026-12-01')), asset(2, { ...next('2026-12-01'), ...archived }), asset(3, { ...next('2027-01-12'), ...archived })] })
    expect((await snipeIt.dashboard(['audits'])).audits).toMatchObject([{ day: '2026-12-01', assets: [{ id: 1 }] }])
  })

  it("Upcoming audits reads the Asset list only; the Audit late and Audit due totals come from the Health check", async () => {
    const { snipeIt, listsAsked } = fleet({ hardware: [asset(1)] })
    await snipeIt.dashboard(['audits', 'categories'])
    expect(listsAsked()).toEqual(['hardware'])
  })

  it('a connection failure keeps its clear message, on every piece', async () => {
    const offline = (async () => {
      throw new TypeError('fetch failed')
    }) as typeof globalThis.fetch
    const result = await createSnipeIt(config, offline, today).dashboard(['assets', 'licenses'])
    expect(result.assets).toEqual({ error: expect.stringMatching(/Can't reach Snipe-IT at https:\/\/snipe\.example\.org/) })
    expect(result.licenses).toEqual(result.assets)
  })

  // Shaped like Snipe-IT's /users rows (trimmed): per-User checked-out counts.
  const user = (id: number, counts: object = {}) => ({
    id, name: `Test User ${id}`, username: `tuser${id}`, assets_count: 0, licenses_count: 0, accessories_count: 0, consumables_count: 0, ...counts,
  })

  it('a User with an Asset, a License seat or an Accessory checked out is Holding', async () => {
    const { snipeIt } = fleet({ users: [user(1, { assets_count: 2 }), user(2, { licenses_count: 1 }), user(3, { accessories_count: 1 }), user(4)] })
    expect(await snipeIt.dashboard(['users'])).toEqual({ users: { used: 3, available: 1 } })
  })

  it('a User with only Consumables is Holding nothing', async () => {
    const { snipeIt } = fleet({ users: [user(1, { consumables_count: 5 })] })
    expect(await snipeIt.dashboard(['users'])).toEqual({ users: { used: 0, available: 1 } })
  })

  it('every page of Users is fetched when the server caps page size', async () => {
    const { snipeIt, offsets } = fleet({ users: Array.from({ length: 5 }, (_, i) => user(i + 1, { assets_count: i % 2 })) }, 2)
    expect(await snipeIt.dashboard(['users'])).toEqual({ users: { used: 2, available: 3 } })
    expect(offsets('users')).toEqual([0, 2, 4])
  })

  it('missing fields: a blank Serial counts, a missing Asset Model counts checked out or not, a Location only when not checked out', async () => {
    const { snipeIt } = fleet({
      hardware: [
        asset(1), asset(2, { serial: null }), asset(3, { serial: '', assigned_to: null, status_label: ready }), asset(4, { model: null }),
        // Checked out with no Location: found through whoever has it, so not counted.
        asset(5, { location: null }),
        asset(6, { location: null, assigned_to: null, status_label: ready }), asset(7, { location: null, assigned_to: null, status_label: repair, serial: '' }),
      ],
    })
    expect(await snipeIt.dashboard(['missing'])).toEqual({ missing: { serial: 3, model: 1, location: 2 } })
  })

  it('Licenses running out: below the Minimum quantity, or no Free seats when none is set; a minimum of 0 silences one', async () => {
    const { snipeIt } = fleet({
      licenses: [
        { id: 1, name: 'Below minimum', seats: 40, free_seats_count: 4, min_amt: 5 },
        { id: 2, name: 'At minimum', seats: 40, free_seats_count: 5, min_amt: 5 },
        { id: 3, name: 'None left, no minimum', seats: 30, free_seats_count: 0, min_amt: null },
        { id: 4, name: 'Some left, no minimum', seats: 30, free_seats_count: 1, min_amt: null },
        { id: 5, name: 'None left, silenced', seats: 10, free_seats_count: 0, min_amt: 0 },
        // An older Snipe-IT may not send min_amt at all: no minimum.
        { id: 6, name: 'None left, no field', seats: 10, free_seats_count: 0 },
      ],
    })
    expect(await snipeIt.dashboard(['runningOut'])).toEqual({ runningOut: 3 })
    const old = fleet({ licenses: [{ id: 1, name: 'Old', seats: 3 }] })
    expect(await old.snipeIt.dashboard(['runningOut'])).toEqual({ runningOut: { error: expect.stringMatching(/free_seats_count/) } })
  })

  it('the Health warnings reuse the lists the dashboard fetches, once each, and fetch them even when the bars are hidden', async () => {
    const { snipeIt, offsets, listsAsked } = fleet({ hardware: [asset(1)], statuslabels: labels, licenses })
    expect(await snipeIt.dashboard(['missing', 'runningOut'])).toEqual({ missing: { serial: 0, model: 0, location: 0 }, runningOut: 0 })
    expect(listsAsked()).toEqual(['hardware', 'licenses'])
    await snipeIt.dashboard(['assets', 'overdue', 'missing', 'licenses', 'runningOut'])
    expect(offsets('hardware')).toEqual([0, 0])
    expect(offsets('licenses')).toEqual([0, 0])
  })
})

it('tests authentication before reporting connection success and detects the version', async () => {
  const { fetch } = fakeFetch({ '/users/me': { body: { id: 1 } }, '/version': { body: { version: 'v8.3.0' } } })
  expect(await createSnipeIt(config, fetch).testConnection()).toEqual({ version: 'v8.3.0' })
  const denied = fakeFetch({ '/users/me': { status: 401, body: {} } })
  await expect(createSnipeIt(config, denied.fetch).testConnection()).rejects.toThrow('rejected your API key')
  const older = fakeFetch({ '/users/me': { body: { id: 1 } } })
  expect(await createSnipeIt(config, older.fetch).testConnection()).toEqual({ version: 'Unavailable' })
})

describe('Health warnings', () => {
  const audits = { '/hardware/audit/overdue': { body: { total: 12, rows: [] } }, '/hardware/audit/due': { body: { total: 3, rows: [] } } }

  const noneDeactivated = { '/users': { body: { total: 0, rows: [] } } }

  it('probes /version for the version, and reads both audit totals with limit=1 (Audit due latest first)', async () => {
    const { fetch, calls, queries } = fakeFetch({ '/version': { body: { version: 'v8.8.0', build_version: 'v8.8.0-12' } }, ...audits, ...noneDeactivated })
    expect(await createSnipeIt(config, fetch).health()).toEqual({ probe: { version: 'v8.8.0' }, auditLate: 12, auditDue: 3, dueThrough: null, deactivated: { assets: 0, users: 0 } })
    expect(calls.sort()).toEqual(['/hardware/audit/due', '/hardware/audit/overdue', '/users', '/version'])
    expect(queries.filter((q) => q.limit === '1')).toEqual(expect.arrayContaining([{ limit: '1' }, { limit: '1', sort: 'next_audit_date', order: 'desc' }]))
  })

  it("the Audit due check's one row is the latest Audit due date, where the timeline's Audit due shading ends", async () => {
    const latest = { '/hardware/audit/due': { body: { total: 3, rows: [{ ...chromebook, next_audit_date: { date: '2026-10-19', formatted: '2026-10-19' } }] } } }
    const { fetch } = fakeFetch({ '/version': { body: { version: 'v8.8.0' } }, ...audits, ...latest, ...noneDeactivated })
    expect(await createSnipeIt(config, fetch).health()).toMatchObject({ auditDue: 3, dueThrough: '2026-10-19' })
  })

  // Shaped like Snipe-IT's /users rows (trimmed).
  const deactivatedUser = (id: number, assets_count: number) => ({ id, name: `Test User ${id}`, activated: false, assets_count })

  it('deactivated Users holding Assets: most Assets first, counted until a User holds none', async () => {
    const { fetch, queries } = fakeFetch({ ...audits, '/users': { body: { total: 40, rows: [deactivatedUser(4, 3), deactivatedUser(9, 1), deactivatedUser(2, 1), deactivatedUser(7, 0), deactivatedUser(8, 0)] } } })
    expect((await createSnipeIt(config, fetch).health()).deactivated).toEqual({ assets: 5, users: 3 })
    expect(queries.find((q) => q.activated)).toEqual({ activated: '0', sort: 'assets_count', order: 'desc', limit: '500', offset: '0' })
  })

  it('deactivated Users: the next page only while every User so far holds Assets; a refusal is that line alone', async () => {
    const holding = Array.from({ length: 500 }, (_, i) => deactivatedUser(i + 1, 1))
    const pages: Record<string, unknown>[] = []
    const paged = (async (input: string | URL | Request) => {
      const url = new URL(String(input))
      if (url.pathname.endsWith('/users')) pages.push(Object.fromEntries(url.searchParams))
      const rows = url.searchParams.get('offset') === '0' ? holding : [deactivatedUser(501, 2), deactivatedUser(502, 0)]
      return new Response(JSON.stringify(url.pathname.endsWith('/users') ? { total: 900, rows } : { total: 0, rows: [] }))
    }) as typeof globalThis.fetch
    expect((await createSnipeIt(config, paged).health()).deactivated).toEqual({ assets: 502, users: 501 })
    expect(pages.map((p) => p.offset)).toEqual(['0', '500'])
    const denied = fakeFetch({ ...audits, '/users': { status: 403, body: { status: 'error', messages: 'You cannot view Users.' } } })
    expect(await createSnipeIt(config, denied.fetch).health()).toMatchObject({ auditLate: 12, deactivated: { error: 'Snipe-IT returned HTTP 403: You cannot view Users.' } })
  })

  it('classifies the probe: unreachable (network, timeout, 503), the key rejected (401) or refused key-wide (403)', async () => {
    const offline = (async () => { throw new TypeError('fetch failed') }) as typeof globalThis.fetch
    expect((await createSnipeIt(config, offline).health()).probe).toEqual({ warning: 'unreachable', message: expect.stringMatching(/^Can't reach Snipe-IT at https:\/\/snipe\.example\.org/) })
    const slow = (async () => { throw new DOMException('The operation was aborted due to timeout', 'TimeoutError') }) as typeof globalThis.fetch
    expect((await createSnipeIt(config, slow).health()).probe).toEqual({ warning: 'unreachable', message: expect.stringMatching(/took longer than/) })
    const proxy = fakeFetch({ '/version': { status: 503, body: {} }, ...audits })
    expect((await createSnipeIt(config, proxy.fetch).health()).probe).toMatchObject({ warning: 'unreachable' })
    const rejected = fakeFetch({ '/version': { status: 401, body: { message: 'Unauthenticated.' } }, ...audits })
    expect((await createSnipeIt(config, rejected.fetch).health()).probe).toEqual({ warning: 'key', message: expect.stringMatching(/^Snipe-IT rejected your API key\./) })
    const twoFactor = fakeFetch({ '/version': { status: 403, body: { status: 'error', messages: 'Two-factor authentication is required.' } }, ...audits })
    expect((await createSnipeIt(config, twoFactor.fetch).health()).probe).toEqual({ warning: 'key', message: 'Snipe-IT returned HTTP 403: Two-factor authentication is required.' })
  })

  it('a check that fails says why on its own, leaving the others', async () => {
    const { fetch } = fakeFetch({ '/version': { body: {} }, '/hardware/audit/overdue': { status: 403, body: { status: 'error', messages: 'No audits for you.' } }, '/hardware/audit/due': audits['/hardware/audit/due'], ...noneDeactivated })
    expect(await createSnipeIt(config, fetch).health()).toEqual({
      probe: { error: "Snipe-IT didn't say which version it runs." }, auditLate: { error: 'Snipe-IT returned HTTP 403: No audits for you.' }, auditDue: 3, dueThrough: null, deactivated: { assets: 0, users: 0 },
    })
  })

  const none = { deactivated: { assets: 0, users: 0 } }
  it('lines: hidden at 0, too old below v8.7, and a failed check on its own line only', () => {
    expect(healthLines({ probe: { version: 'v8.7.0' }, auditLate: 0, auditDue: 0, ...none })).toEqual([])
    expect(healthLines({ probe: { version: 'v9.0.1' }, auditLate: 12, auditDue: 0, ...none })).toEqual([{ warning: 'auditLate', count: 12 }])
    expect(healthLines({ probe: { version: 'v8.6.3' }, auditLate: { error: 'No audits for you.' }, auditDue: 3, ...none })).toEqual([
      { warning: 'tooOld', version: 'v8.6.3' }, { warning: 'auditLate', error: 'No audits for you.' }, { warning: 'auditDue', count: 3 },
    ])
    expect(healthLines({ probe: { version: 'nightly' }, auditLate: 0, auditDue: 1, ...none })).toEqual([
      { warning: 'tooOld', error: "Snipe-IT's version, nightly, isn't one this app can read." }, { warning: 'auditDue', count: 1 },
    ])
    expect(healthLines({ probe: { error: 'Not found' }, auditLate: 0, auditDue: 0, ...none })).toEqual([{ warning: 'tooOld', error: 'Not found' }])
  })

  it("lines: one per missing field, deactivated Users, Licenses running out, in #67's order; a list still loading adds none", () => {
    const ok = { probe: { version: 'v8.8.0' }, auditLate: 2, auditDue: 1 }
    expect(healthLines({ ...ok, deactivated: { assets: 5, users: 3 }, missing: { serial: 4, model: 0, location: 2 }, runningOut: 1 })).toEqual([
      { warning: 'auditLate', count: 2 }, { warning: 'auditDue', count: 1 },
      { warning: 'missing', field: 'serial', count: 4 }, { warning: 'missing', field: 'location', count: 2 },
      { warning: 'deactivated', assets: 5, users: 3 }, { warning: 'runningOut', count: 1 },
    ])
    expect(healthLines({ ...ok, auditLate: 0, auditDue: 0, deactivated: { error: 'No Users.' }, missing: { error: 'No Assets.' }, runningOut: { error: 'No Licenses.' } })).toEqual([
      { warning: 'missing', error: 'No Assets.' }, { warning: 'deactivated', error: 'No Users.' }, { warning: 'runningOut', error: 'No Licenses.' },
    ])
    expect(healthLines({ ...ok, auditLate: 0, auditDue: 0, ...none, missing: { serial: 0, model: 0, location: 0 }, runningOut: 0 })).toEqual([])
    expect(healthLines({ ...ok, auditLate: 0, auditDue: 0, ...none })).toEqual([])
  })

  it('lines: Temp checkouts Overdue counts the marked rows, says why it could not check, and is hidden at 0', () => {
    const fine = { probe: { version: 'v8.8.0' }, auditLate: 4, auditDue: 2, ...none } as const
    const row = (temp: boolean) => ({ temp }) as NonNullable<Exclude<Dashboard['overdue'], { error: string }>>['rows'][number]
    expect(healthLines(fine, null, { rows: [row(true), row(false), row(true)] })).toEqual([{ warning: 'auditLate', count: 4 }, { warning: 'temp', count: 2 }, { warning: 'auditDue', count: 2 }])
    expect(healthLines(fine, null, { rows: [row(false)] })).toHaveLength(2)
    expect(healthLines(fine, null, { rows: [], tempError: 'No Activity Report for you.' })).toContainEqual({ warning: 'temp', error: 'No Activity Report for you.' })
    expect(healthLines(fine, null, { error: 'No Assets for you.' })).toContainEqual({ warning: 'temp', error: 'No Assets for you.' })
    expect(healthLines(fine)).toHaveLength(2) // the Overdue list hasn't loaded yet
    // Temp checkouts Overdue is red, so it comes before the amber Newer Snipe-IT available.
    expect(healthLines(fine, { tag: 'v9.0.0', url: '' }, { rows: [row(true)] }).map((l) => l.warning)).toEqual(['auditLate', 'temp', 'newer', 'auditDue'])
  })

  it('lines: Newer Snipe-IT available for any newer release, patches included, after Audit late', () => {
    const release = (tag: string) => ({ tag, url: `https://github.com/grokability/snipe-it/releases/tag/${tag}` })
    const newer = (running: string, tag: string) => healthLines({ probe: { version: running }, auditLate: 0, auditDue: 0, ...none }, release(tag))
    expect(newer('v8.8.0', 'v8.8.1')).toEqual([{ warning: 'newer', release: release('v8.8.1'), running: 'v8.8.0' }])
    expect(newer('v8.9.1', 'v8.10.0')).toEqual([{ warning: 'newer', release: release('v8.10.0'), running: 'v8.9.1' }])
    expect(newer('v8.8', 'v8.8.1')).toEqual([{ warning: 'newer', release: release('v8.8.1'), running: 'v8.8' }])
    expect(newer('v8.7.4', 'v9.0.0')).toEqual([{ warning: 'newer', release: release('v9.0.0'), running: 'v8.7.4' }])
    for (const [running, tag] of [['v8.8.0', 'v8.8.0'], ['v8.10.0', 'v8.9.1'], ['v8.8.0 build 120 (g1a2b3c)', 'v8.8.0'], ['v9.0.0', 'v8.9.1'], ['v8.8.0', 'latest'], ['nightly', 'v8.9.1']])
      expect(newer(running, tag).filter((l) => l.warning === 'newer'), `${running} → ${tag}`).toEqual([])
    expect(healthLines({ probe: { version: 'v8.8.0' }, auditLate: 0, auditDue: 0, ...none }, null)).toEqual([])
    expect(healthLines({ probe: { error: 'Not found' }, auditLate: 0, auditDue: 0, ...none }, release('v8.9.1'))).toEqual([{ warning: 'tooOld', error: 'Not found' }])
    expect(healthLines({ probe: { version: 'v8.6.0' }, auditLate: 2, auditDue: 3, ...none }, release('v8.6.1')).map((l) => l.warning)).toEqual(['tooOld', 'auditLate', 'newer', 'auditDue'])
    const down = { warning: 'unreachable', message: "Can't reach Snipe-IT." } as const
    expect(healthLines({ probe: down, auditLate: 0, auditDue: 0, ...none }, release('v8.9.1'))).toEqual([down])
  })

  it('lines: Snipe-IT unreachable or the key failing shows only that line', () => {
    const down = { warning: 'unreachable', message: "Can't reach Snipe-IT." } as const
    expect(healthLines({ probe: down, auditLate: { error: "Can't reach Snipe-IT." }, auditDue: 4, deactivated: { error: "Can't reach Snipe-IT." }, missing: { error: "Can't reach Snipe-IT." } })).toEqual([down])
    const key = { warning: 'key', message: 'Snipe-IT rejected your API key.' } as const
    expect(healthLines({ probe: key, auditLate: 9, auditDue: 4, deactivated: { assets: 1, users: 1 }, runningOut: 2 }, null, { error: 'Snipe-IT rejected your API key.' })).toEqual([key])
  })
})

it("gets the Operator's own email from Snipe-IT, and says so when their account has none", async () => {
  expect(await createSnipeIt(config, fakeFetch({ '/users/me': { body: { id: 5, email: 'operator@nomma.net' } } }).fetch).operatorEmail()).toBe('operator@nomma.net')
  for (const email of ['', null])
    await expect(createSnipeIt(config, fakeFetch({ '/users/me': { body: { id: 5, email } } }).fetch).operatorEmail()).rejects.toThrow('no email address')
})

it('sends the selected Checkin Location to Snipe-IT', async () => {
  const { fetch, requests } = fakeFetch({ '/hardware/4812': { body: chromebook }, 'POST /hardware/4812/checkin': { body: { status: 'success' } } })
  await createSnipeIt(config, fetch).checkin(4812, { locationId: 9 })
  expect(requests.at(-1)?.body).toEqual({ status_id: 2, location_id: 9 })
})

it('loads every page of Locations for the default dropdown', async () => {
  const fetch = vi.fn(async (url: string | URL | Request) => new Response(JSON.stringify({ total: 2, rows: String(url).includes('offset=0') ? [{ id: 1, name: 'Library' }] : [{ id: 2, name: 'Office' }] })))
  expect(await createSnipeIt(config, fetch).locations()).toEqual([{ id: 1, name: 'Library' }, { id: 2, name: 'Office' }])
  expect(fetch).toHaveBeenCalledTimes(2)
})

// A List row whose available_actions say nothing: every action is allowed.
const can = { checkout: true, checkin: true, update: true, delete: true, audit: true }

describe('list', () => {
  it('asks for one page of 50 from the offset, with the search, and returns the total and rows in app vocabulary', async () => {
    const raw = { id: 311, name: 'Jordan Reyes', username: 'jreyes', email: null, department: { id: 2, name: 'Science' }, location: null, assets_count: 2 }
    const { fetch, calls, queries } = fakeFetch({ '/users': { body: { total: 120, rows: [raw] } } })
    const page = await createSnipeIt(config, fetch).list('users', { search: ' rey ', offset: 50 })
    expect(calls).toEqual(['/users'])
    expect(queries[0]).toEqual({ limit: '50', offset: '50', search: 'rey' })
    expect(page).toEqual({ total: 120, rows: [{ id: 311, name: 'Jordan Reyes', username: 'jreyes', email: '', department: 'Science', location: '', assets: 2, can }] })
  })

  it('Assets rows are full Assets, so Quick Actions know what is allowed', async () => {
    const { fetch } = fakeFetch({ '/hardware': { body: { total: 1, rows: [chromebook] } } })
    const page = await createSnipeIt(config, fetch, today).list('assets')
    expect(page.rows[0]).toMatchObject({ assetTag: 'NOMMA-004812', checkoutAllowed: false, assignee: { type: 'user', id: 311, name: 'Jordan Reyes' } })
  })

  it('filters are sent as Snipe-IT filters; "checked out to this User" becomes assigned_to and assigned_type', async () => {
    const { fetch, queries } = fakeFetch({ '/hardware': { body: { total: 0, rows: [] } } })
    await createSnipeIt(config, fetch).list('assets', { filters: { status: 'RTD', location_id: '12', model_id: '', user_id: '311' } })
    expect(queries[0]).toEqual({ limit: '50', offset: '0', status: 'RTD', location_id: '12', assigned_to: '311', assigned_type: 'App\\Models\\User' })
  })

  it("missing a Serial, Asset Model or Location asks with Snipe-IT's is:null filter; a Location only for Assets not checked out", async () => {
    const { fetch, queries } = fakeFetch({ '/hardware': { body: { total: 0, rows: [] } } })
    const snipeIt = createSnipeIt(config, fetch)
    for (const missing of ['serial', 'model', 'location']) await snipeIt.list('assets', { filters: { missing, status_id: '3' } })
    expect(queries.map((q) => [q.filter && JSON.parse(q.filter), q.status_id])).toEqual([
      [{ serial: 'is:null' }, '3'], [{ model: 'is:null' }, '3'], [{ location: 'is:null', assigned_to: 'is:null' }, '3'],
    ])
  })

  it('Snipe-IT ignores the search beside its is:null filter, so the List refuses both rather than show the wrong Assets', async () => {
    const { fetch, calls } = fakeFetch({})
    await expect(createSnipeIt(config, fetch).list('assets', { search: 'cb', filters: { missing: 'serial' } })).rejects.toThrow('Clear the search')
    expect(calls).toEqual([])
  })

  it('Users filter by activated; Licenses sort by Free seats', async () => {
    const { fetch, queries } = fakeFetch({ '/users': { body: { total: 0, rows: [] } }, '/licenses': { body: { total: 0, rows: [] } } })
    const snipeIt = createSnipeIt(config, fetch)
    await snipeIt.list('users', { filters: { activated: '0' }, sort: 'assets', order: 'desc' })
    await snipeIt.list('licenses', { sort: 'free', order: 'asc' })
    expect(queries).toEqual([
      { limit: '50', offset: '0', activated: '0', sort: 'assets_count', order: 'desc' },
      { limit: '50', offset: '0', sort: 'free_seats_count', order: 'asc' },
    ])
    await expect(snipeIt.list('users', { filters: { activated: 'no' } })).rejects.toThrow('Invalid filter')
  })

  it.each([
    ['a filter the List does not have', { department_id: '2' }],
    ['a missing field the List does not know', { missing: 'notes' }],
    ['an id that is not a positive whole number', { location_id: '12&admin=1' }],
    ['a value outside the known ones', { status: 'Deleted' }],
    ['a value that is not text', { location_id: 12 as unknown as string }],
  ])('%s is refused without asking Snipe-IT', async (_name, filters) => {
    const { fetch, calls } = fakeFetch({})
    await expect(createSnipeIt(config, fetch).list('assets', { filters })).rejects.toThrow('Invalid filter')
    expect(calls).toEqual([])
  })

  it("sorts by a row field under Snipe-IT's name for it; a field it can't sort by is left out", async () => {
    const { fetch, queries } = fakeFetch({ '/hardware': { body: { total: 0, rows: [] } } })
    const snipeIt = createSnipeIt(config, fetch)
    await snipeIt.list('assets', { sort: 'assignee', order: 'asc' })
    await snipeIt.list('assets', { sort: 'warrantyEnd', order: 'asc' })
    expect(queries[0]).toMatchObject({ sort: 'assigned_to', order: 'asc' })
    expect(queries[1]).not.toHaveProperty('sort')
  })

  it('any List can be paged in id order, so rows added meanwhile don\'t shift the pages of a "select all"', async () => {
    const { fetch, queries } = fakeFetch({ '/suppliers': { body: { total: 0, rows: [] } } })
    await createSnipeIt(config, fetch).list('suppliers', { sort: 'id', order: 'asc' })
    expect(queries[0]).toMatchObject({ sort: 'id', order: 'asc' })
  })

  it('an unknown List is refused without asking Snipe-IT', async () => {
    const { fetch, calls } = fakeFetch({})
    await expect(createSnipeIt(config, fetch).list('constructor' as 'assets')).rejects.toThrow('Unknown list')
    expect(calls).toEqual([])
  })

  it('Activity Report rows are History entries plus the item acted on', async () => {
    const { fetch, queries } = fakeFetch({ '/reports/activity': { body: activity } })
    const page = await createSnipeIt(config, fetch).list('activity', { filters: { action_type: 'checkin from' } })
    expect(queries[0]).toMatchObject({ action_type: 'checkin from' })
    expect(page.rows[1]).toEqual({
      id: 7, when: '2026-08-17 15:40', action: 'Checkin', operator: 'E. Caldwell', detail: 'from Sam Whitaker', note: '"keyboard sticky"',
      item: { type: 'asset', id: 4812, name: 'CB-LIB-012' }, can,
    })
  })

  it("a List Snipe-IT refuses is thrown as Snipe-IT's reason", async () => {
    const denied = { status: 'error', messages: 'You do not have permission.', payload: null }
    const { fetch } = fakeFetch({ '/models': { body: denied } })
    await expect(createSnipeIt(config, fetch).list('models')).rejects.toThrow('You do not have permission.')
  })
})

describe('Assets Views', () => {
  const empty = { body: { total: 0, rows: [] } }
  const labels = { body: { total: 2, rows: [{ id: 2, name: 'Deployed' }, { id: 7, name: ' damaged ' }] } }

  it.each([
    ['all', '/hardware', {}],
    ['checkedOut', '/hardware', { status: 'Deployed' }],
    ['available', '/hardware', { status: 'RTD' }],
    ['auditDue', '/hardware/audit/due', {}],
    ['auditLate', '/hardware/audit/overdue', {}],
  ] as const)('%s asks Snipe-IT for %s, narrowed by the search and filter boxes', async (view, path, fixed) => {
    const { fetch, calls, queries } = fakeFetch({ [path]: empty })
    await createSnipeIt(config, fetch).list('assets', { view, search: 'cb', filters: { location_id: '4', category_id: '3' }, offset: 50 })
    expect(calls).toEqual([path])
    expect(queries[0]).toEqual({ limit: '50', offset: '50', search: 'cb', location_id: '4', category_id: '3', ...fixed })
  })

  it('Damaged asks for the Status Label named Damaged, found by name whatever its case or spacing', async () => {
    const { fetch, calls, queries } = fakeFetch({ '/statuslabels': labels, '/hardware': empty })
    await createSnipeIt(config, fetch).list('assets', { view: 'damaged', filters: { location_id: '4' } })
    expect(calls).toEqual(['/statuslabels', '/hardware'])
    expect(queries[1]).toEqual({ limit: '50', offset: '0', location_id: '4', status_id: '7' })
  })

  it('Damaged with no Status Label of that name is an empty View that says so, without listing Assets', async () => {
    const { fetch, calls } = fakeFetch({ '/statuslabels': { body: { total: 1, rows: [{ id: 2, name: 'Deployed' }] } } })
    const page = await createSnipeIt(config, fetch).list('assets', { view: 'damaged' })
    expect(page).toEqual({ total: 0, rows: [], why: "Snipe-IT has no Status Label named Damaged, so no Asset is Damaged." })
    expect(calls).toEqual(['/statuslabels'])
  })

  it('a View can be sorted by the audit dates, and paged in id order for "Select all N matching"', async () => {
    const { fetch, calls, queries } = fakeFetch({ '/hardware/audit/overdue': empty })
    const snipeIt = createSnipeIt(config, fetch)
    await snipeIt.list('assets', { view: 'auditLate', sort: 'nextAudit', order: 'asc' })
    await snipeIt.list('assets', { view: 'auditLate', sort: 'id', order: 'asc', offset: 50 })
    expect(calls).toEqual(['/hardware/audit/overdue', '/hardware/audit/overdue'])
    expect(queries[0]).toMatchObject({ sort: 'next_audit_date', order: 'asc' })
    expect(queries[1]).toMatchObject({ sort: 'id', order: 'asc', offset: '50' })
  })

  it("Export CSV reads the open View's route", async () => {
    const { fetch, calls } = fakeFetch({ '/hardware/audit/due': empty })
    await createSnipeIt(config, fetch).exportList('assets', { view: 'auditDue' })
    expect(calls).toEqual(['/hardware/audit/due'])
  })

  it('an unknown View, or a View on another List, is refused without asking Snipe-IT', async () => {
    const { fetch, calls } = fakeFetch({})
    await expect(createSnipeIt(config, fetch).list('assets', { view: 'constructor' as 'all' })).rejects.toThrow('Unknown View')
    await expect(createSnipeIt(config, fetch).list('users', { view: 'auditLate' })).rejects.toThrow('Unknown View')
    expect(calls).toEqual([])
  })
})

describe('exportList', () => {
  // A fake Snipe-IT that pages /suppliers by limit/offset (at most pageMax a page), recording each query it was sent.
  function suppliers(count: number, pageMax = 500) {
    const queries: Record<string, string>[] = []
    const rows = Array.from({ length: count }, (_, i) => ({ id: i + 1, name: `Supplier ${i + 1}`, contact: '', phone: '', email: '', assets_count: 0 }))
    const fetch = (async (input: string | URL | Request) => {
      const url = new URL(String(input))
      queries.push(Object.fromEntries(url.searchParams))
      const limit = Math.min(Number(url.searchParams.get('limit')), pageMax)
      const offset = Number(url.searchParams.get('offset'))
      return new Response(JSON.stringify({ total: rows.length, rows: rows.slice(offset, offset + limit) }))
    }) as typeof globalThis.fetch
    return { snipeIt: createSnipeIt(config, fetch), queries }
  }

  it('fetches every page of the List, with its search, filters and sort, 500 rows a page', async () => {
    const { snipeIt, queries } = suppliers(1234)
    const out = await snipeIt.exportList('suppliers', { search: 'acme', sort: 'name', order: 'asc' })
    expect(out.capped).toBe(false)
    expect(out.rows.map((r) => r.id)).toEqual(Array.from({ length: 1234 }, (_, i) => i + 1))
    expect(queries.map((q) => q.offset)).toEqual(['0', '500', '1000'])
    expect(queries[0]).toEqual({ limit: '500', offset: '0', search: 'acme', sort: 'name', order: 'asc' })
  })

  it('a server that caps pages lower still gives every row', async () => {
    const { snipeIt, queries } = suppliers(250, 100)
    expect((await snipeIt.exportList('suppliers')).rows).toHaveLength(250)
    expect(queries.map((q) => q.offset)).toEqual(['0', '100', '200'])
  })

  it("stops at the Report row cap and says it's cut short", async () => {
    const { snipeIt } = suppliers(10_001)
    const out = await snipeIt.exportList('suppliers')
    expect(out.rows).toHaveLength(10_000)
    expect(out.capped).toBe(true)
    expect((await suppliers(10_000).snipeIt.exportList('suppliers')).capped).toBe(false)
  })

  it('a filter the List does not have is refused, as for one page', async () => {
    const { snipeIt, queries } = suppliers(3)
    await expect(snipeIt.exportList('suppliers', { filters: { status: 'RTD' } })).rejects.toThrow('Invalid filter')
    expect(queries).toEqual([])
  })
})

describe('report', () => {
  const entry = (id: number, datetime: string, type = 'asset', action_type = 'checkout') => ({
    id, action_type, created_at: { datetime }, created_by: { id: 5, name: 'E. Caldwell' }, target: { id: 311, name: 'Jordan Reyes' }, note: null, item: { id, name: `NOMMA-${id}`, type },
  })
  // Newest first, as Snipe-IT sends it, across two pages of 500.
  const log = [
    ...Array.from({ length: 500 }, (_, i) => entry(1000 - i, '2026-09-20 10:00:00')),
    entry(3, '2026-09-10 09:00:00', 'license'), entry(2, '2026-09-05 12:00:00'), entry(1, '2026-08-01 08:00:00'),
  ]
  function activityFetch(pageMax = 500) {
    const offsets: number[] = []
    const fetch = (async (input: string | URL | Request) => {
      const url = new URL(String(input))
      const offset = Number(url.searchParams.get('offset'))
      offsets.push(offset)
      return new Response(JSON.stringify({ total: log.length, rows: log.slice(offset, offset + Math.min(pageMax, Number(url.searchParams.get('limit')))) }))
    }) as typeof globalThis.fetch
    return { fetch, offsets }
  }

  it('the Activity Report keeps what happened in the date range and record type, and stops paging once past the start', async () => {
    const { fetch, offsets } = activityFetch()
    const r = await createSnipeIt(config, fetch).report('activity', { from: '2026-09-01', to: '2026-09-15', itemType: 'asset' })
    expect(r.columns).toEqual(['When', 'Action', 'Operator', 'Record type', 'Item', 'Detail', 'Note'])
    expect(r.rows).toEqual([['2026-09-05 12:00', 'Checkout', 'E. Caldwell', 'Assets', 'NOMMA-2', 'to Jordan Reyes', '']])
    expect(offsets).toEqual([0, 500])
    const licenses = await createSnipeIt(config, activityFetch().fetch).report('activity', { from: '2026-09-01', itemType: 'license' })
    expect(licenses.rows.map((row) => row[4])).toEqual(['NOMMA-3'])
  })

  it("an entry without a date is left out of a dated report without ending it early", async () => {
    const undated = { ...entry(9, ''), created_at: null }
    const rows = [entry(8, '2026-09-20 10:00:00'), undated, entry(7, '2026-09-10 10:00:00')]
    const { fetch } = fakeFetch({ '/reports/activity': { body: { total: 3, rows } } })
    expect((await createSnipeIt(config, fetch).report('activity', { from: '2026-09-01' })).rows.map((r) => r[4])).toEqual(['NOMMA-8', 'NOMMA-7'])
  })

  it('a server that caps pages below 500 is still paged through without gaps', async () => {
    const { fetch, offsets } = activityFetch(200)
    const r = await createSnipeIt(config, fetch).report('activity', { from: '2026-09-01' })
    expect(r.rows).toHaveLength(502)
    expect(offsets).toEqual([0, 200, 400])
  })

  it('the Activity Report filters by note added, which Repair intake and Incoming repair write on an Asset', async () => {
    const { fetch, queries } = fakeFetch({ '/reports/activity': { body: { total: 1, rows: [{ ...entry(5, '2026-10-10 09:00:00', 'asset', 'note added'), note: '[Incoming repair] screen replaced' }] } } })
    const r = await createSnipeIt(config, fetch).report('activity', { actionType: 'note added' })
    expect(queries[0]).toMatchObject({ action_type: 'note added' })
    expect(r.rows).toEqual([['2026-10-10 09:00', 'Note added', 'E. Caldwell', 'Assets', 'NOMMA-5', 'Jordan Reyes', '[Incoming repair] screen replaced']])
  })

  it('an unknown report, action, record type or a malformed date is refused without asking Snipe-IT', async () => {
    const { fetch, calls } = fakeFetch({})
    const snipeIt = createSnipeIt(config, fetch)
    await expect(snipeIt.report('everything' as 'activity')).rejects.toThrow('Unknown report')
    await expect(snipeIt.report('activity', { actionType: 'drop table' })).rejects.toThrow('Unknown action')
    await expect(snipeIt.report('activity', { itemType: 'App\\Models\\Asset' })).rejects.toThrow('Unknown record type')
    await expect(snipeIt.report('overdue', { from: '9/1/2026' })).rejects.toThrow('YYYY-MM-DD')
    expect(calls).toEqual([])
  })

  it('Overdue and Warranty expiring are the dashboard lists in full, with their dates, narrowed to the date range', async () => {
    const asset = (id: number, fields: object) => ({ ...chromebook, id, asset_tag: `NOMMA-${id}`, name: `CB-${id}`, expected_checkin: null, warranty_expires: null, ...fields })
    const hardware = [
      asset(1, { expected_checkin: { datetime: '2026-09-20 00:00:00' } }), asset(2, { expected_checkin: { datetime: '2026-08-01 00:00:00' } }), asset(3, { expected_checkin: { datetime: '2026-09-23 08:15:00' } }),
      asset(4, { warranty_expires: { date: '2026-10-01' } }), asset(5, { warranty_expires: { date: '2026-12-01' } }), asset(6, { warranty_expires: { date: '2026-09-01' } }),
    ]
    const { fetch } = fakeFetch({ '/hardware': { body: { total: hardware.length, rows: hardware } } })
    const snipeIt = createSnipeIt(config, fetch, today)
    expect(await snipeIt.report('overdue')).toEqual({
      columns: ['Asset Tag', 'Name', 'Assignee', 'Expected Checkin', 'How late'],
      rows: [['NOMMA-2', 'CB-2', 'Jordan Reyes', '2026-08-01', '54d'], ['NOMMA-1', 'CB-1', 'Jordan Reyes', '2026-09-20', '4d'], ['NOMMA-3', 'CB-3', 'Jordan Reyes', '2026-09-23 08:15', '1d']],
      capped: false,
    })
    expect((await snipeIt.report('overdue', { from: '2026-09-01' })).rows.map((r) => r[0])).toEqual(['NOMMA-1', 'NOMMA-3'])
    // A time of day stays within its date's range.
    expect((await snipeIt.report('overdue', { from: '2026-09-23', to: '2026-09-23' })).rows.map((r) => r[0])).toEqual(['NOMMA-3'])
    expect((await snipeIt.report('expiring')).rows).toEqual([['NOMMA-4', 'CB-4', 'Deployed', '2026-10-01', '7'], ['NOMMA-5', 'CB-5', 'Deployed', '2026-12-01', '68']])
    expect((await snipeIt.report('expiring', { to: '2026-11-01' })).rows.map((r) => r[0])).toEqual(['NOMMA-4'])
  })

  it('the Overdue Report sorts by how late to the minute, so Assets late on their due day keep their order', async () => {
    const asset = (id: number, datetime: string) => ({ ...chromebook, id, asset_tag: `NOMMA-${id}`, name: `CB-${id}`, expected_checkin: { datetime } })
    const hardware = [asset(1, '2026-09-24 15:30:00'), asset(2, '2026-09-24 14:50:00'), asset(3, '2026-09-23 00:00:00'), asset(4, '2026-09-24 16:30:00')]
    const { fetch } = fakeFetch({ '/hardware': { body: { total: hardware.length, rows: hardware } } })
    const snipeIt = createSnipeIt(config, fetch, () => new Date(2026, 8, 24, 16, 0))
    expect((await snipeIt.report('overdue')).rows.map((r) => r.slice(3))).toEqual([['2026-09-23', '1d'], ['2026-09-24 14:50', '1 h'], ['2026-09-24 15:30', '30 min']])
  })

  // Snipe-IT v8.7+ sends last_audit_date as {datetime, formatted} and next_audit_date as {date, formatted}.
  const audited = (id: number, last: string | null, next: string | null) => ({
    ...chromebook, id, asset_tag: `NOMMA-${id}`, name: `CB-${id}`,
    last_audit_date: last && { datetime: `${last} 09:15:00`, formatted: `${last} 9:15 AM` }, next_audit_date: next && { date: next, formatted: next },
  })
  const auditFetch = (path: string, hardware: object[]) => fakeFetch({ [path]: { body: { total: hardware.length, rows: hardware } } })

  it('Audit due asks Snipe-IT which Assets are due in the Location and Category, soonest next audit first', async () => {
    const { fetch, calls, queries } = auditFetch('/hardware/audit/due', [audited(1, '2025-10-20', '2026-10-20'), audited(2, null, '2026-09-30'), audited(3, '2025-10-01', '2026-10-01')])
    const r = await createSnipeIt(config, fetch, today).report('auditDue', { locationId: '9', categoryId: '3' })
    expect(calls).toEqual(['/hardware/audit/due'])
    expect(queries[0]).toMatchObject({ location_id: '9', category_id: '3' })
    expect(r).toEqual({
      columns: ['Asset Tag', 'Name', 'Asset Model', 'Category', 'Location', 'Assignee', 'Last audited', 'Next audit', 'Days left'],
      rows: [
        ['NOMMA-2', 'CB-2', 'HP Chromebook 14 G7', 'Chromebook', 'Library', 'Jordan Reyes', 'Never', '2026-09-30', '6'],
        ['NOMMA-3', 'CB-3', 'HP Chromebook 14 G7', 'Chromebook', 'Library', 'Jordan Reyes', '2025-10-01', '2026-10-01', '7'],
        ['NOMMA-1', 'CB-1', 'HP Chromebook 14 G7', 'Chromebook', 'Library', 'Jordan Reyes', '2025-10-20', '2026-10-20', '26'],
      ],
      capped: false,
    })
    // From/To only narrow the next audit date within what Snipe-IT counts as due.
    expect((await createSnipeIt(config, fetch, today).report('auditDue', { from: '2026-10-01', to: '2026-10-19' })).rows.map((row) => row[0])).toEqual(['NOMMA-3'])
    expect(queries[1]).not.toHaveProperty('location_id')
  })

  it('Audit late asks Snipe-IT which Assets are late, most days late first', async () => {
    const { fetch, calls, queries } = auditFetch('/hardware/audit/overdue', [audited(1, '2025-09-01', '2026-09-01'), audited(2, '2025-06-01', '2026-06-01')])
    const r = await createSnipeIt(config, fetch, today).report('auditLate', { locationId: '9' })
    expect(calls).toEqual(['/hardware/audit/overdue'])
    expect(queries[0]).toMatchObject({ location_id: '9' })
    expect(queries[0]).not.toHaveProperty('category_id')
    expect(r.columns).toEqual(['Asset Tag', 'Name', 'Asset Model', 'Category', 'Location', 'Assignee', 'Last audited', 'Next audit', 'Days late'])
    expect(r.rows.map((row) => [row[0], row[7], row[8]])).toEqual([['NOMMA-2', '2026-06-01', '115'], ['NOMMA-1', '2026-09-01', '23']])
    expect((await createSnipeIt(config, fetch, today).report('auditLate', { from: '2026-08-01' })).rows.map((row) => row[0])).toEqual(['NOMMA-1'])
  })

  it('Last audited lists Assets by last audit date, oldest first, with never-audited ones as Never when From is blank', async () => {
    const { fetch, calls, queries } = auditFetch('/hardware', [audited(1, '2026-05-10', '2027-05-10'), audited(2, null, null), audited(3, '2026-02-01', '2027-02-01'), audited(4, '2026-07-01', null)])
    const snipeIt = createSnipeIt(config, fetch, today)
    const r = await snipeIt.report('lastAudited', { to: '2026-06-01', categoryId: '3' })
    expect(calls).toEqual(['/hardware'])
    expect(queries[0]).toMatchObject({ category_id: '3' })
    expect(r).toEqual({
      columns: ['Asset Tag', 'Name', 'Asset Model', 'Category', 'Location', 'Last audited', 'Next audit'],
      rows: [
        ['NOMMA-2', 'CB-2', 'HP Chromebook 14 G7', 'Chromebook', 'Library', 'Never', ''],
        ['NOMMA-3', 'CB-3', 'HP Chromebook 14 G7', 'Chromebook', 'Library', '2026-02-01', '2027-02-01'],
        ['NOMMA-1', 'CB-1', 'HP Chromebook 14 G7', 'Chromebook', 'Library', '2026-05-10', '2027-05-10'],
      ],
      capped: false,
    })
    // A From date leaves out Assets that have never been audited.
    expect((await snipeIt.report('lastAudited', { from: '2026-03-01' })).rows.map((row) => row[0])).toEqual(['NOMMA-1', 'NOMMA-4'])
  })

  // Shaped like Snipe-IT's /maintenances rows (trimmed): v8.6+ names the type maintenance_type and still sends an empty
  // asset_maintenance_type; earlier versions send only asset_maintenance_type, and completion_date is when it was completed.
  const maintenance = (id: number, start: string, more: object = {}) => ({
    id, asset: { id: 4812, name: 'CB-LIB-012', asset_tag: 'NOMMA-004812' }, title: `Repair ${id}`, name: `Repair ${id}`,
    maintenance_type: 'Repair', asset_maintenance_type: '', supplier: { id: 2, name: 'EduDevices Inc.' }, is_warranty: false, cost: null,
    start_date: { date: start, formatted: start }, completed_at: null, completed_by: null, asset_maintenance_time: 0, created_by: { id: 5, name: 'E. Caldwell' }, ...more,
  })
  const maintenances = [
    maintenance(1, '2026-08-01', { completed_at: { datetime: '2026-08-15 14:00:00' }, completed_by: { id: 6, name: 'P. Tech' }, asset_maintenance_time: 14, cost: '1,234.50', is_warranty: true }),
    maintenance(2, '2026-09-20'),
    // Before v8.6: the old type field, completion_date for when it was done, no completed_at or name.
    (({ maintenance_type: _, completed_at: __, name: ___, ...old }) => old)(maintenance(3, '2026-09-01', { asset_maintenance_type: 'Upgrade', cost: '89.99', asset_maintenance_time: 3, completion_date: { date: '2026-09-04' } })),
    maintenance(4, '2026-06-30'),
    // Opened ahead of its start date: no days yet.
    maintenance(5, '2026-09-30'),
  ]

  it('Maintenances lists every Maintenance with its cost, newest first, Days so far while open', async () => {
    const { fetch, calls } = fakeFetch({ '/maintenances': { body: { total: maintenances.length, rows: maintenances } } })
    const r = await createSnipeIt(config, fetch, today).report('maintenances')
    expect(calls).toEqual(['/maintenances'])
    expect(r).toEqual({
      columns: ['Started', 'Completed', 'Days', 'Asset Tag', 'Name', 'Title', 'Type', 'Supplier', 'Warranty repair', 'Cost', 'Opened by', 'Completed by'],
      rows: [
        ['2026-09-30', 'Open', '0', 'NOMMA-004812', 'CB-LIB-012', 'Repair 5', 'Repair', 'EduDevices Inc.', 'No', '', 'E. Caldwell', ''],
        ['2026-09-20', 'Open', '4', 'NOMMA-004812', 'CB-LIB-012', 'Repair 2', 'Repair', 'EduDevices Inc.', 'No', '', 'E. Caldwell', ''],
        ['2026-09-01', '2026-09-04', '3', 'NOMMA-004812', 'CB-LIB-012', 'Repair 3', 'Upgrade', 'EduDevices Inc.', 'No', '89.99', 'E. Caldwell', ''],
        ['2026-08-01', '2026-08-15', '14', 'NOMMA-004812', 'CB-LIB-012', 'Repair 1', 'Repair', 'EduDevices Inc.', 'Yes', '1234.50', 'E. Caldwell', 'P. Tech'],
        ['2026-06-30', 'Open', '86', 'NOMMA-004812', 'CB-LIB-012', 'Repair 4', 'Repair', 'EduDevices Inc.', 'No', '', 'E. Caldwell', ''],
      ],
      capped: false,
    })
  })

  // A /hardware row with its Location, Status Label and purchase cost as Snipe-IT formats them ("1,234.56", or null).
  const hardwareRow = (id: number, fields: object) => ({ ...chromebook, id, asset_tag: `NOMMA-${id}`, name: `CB-${id}`, purchase_cost: null, ...fields })
  const status = (id: number, name: string, status_type: string) => ({ id, name, status_type, status_meta: status_type })

  it('Assets by Status Label and Location counts each pair and totals its purchase cost from the formatted text, without Archived Assets', async () => {
    const ready = status(1, 'Ready to Deploy', 'deployable')
    const hardware = [
      hardwareRow(1, { location: { id: 4, name: 'Room 204' }, status_label: ready, purchase_cost: '1,234.56' }),
      hardwareRow(2, { location: { id: 4, name: 'Room 204' }, status_label: ready, purchase_cost: '300.00' }),
      hardwareRow(3, { location: { id: 4, name: 'Room 204' }, status_label: ready }),
      hardwareRow(4, { location: { id: 9, name: 'Library' }, status_label: status(4, 'Broken', 'undeployable'), purchase_cost: '0.10' }),
      hardwareRow(5, { location: { id: 9, name: 'Library' }, status_label: status(4, 'Broken', 'undeployable'), purchase_cost: '0.20' }),
      hardwareRow(6, { location: { id: 9, name: 'Library' }, purchase_cost: '2,000.00' }),
      hardwareRow(7, { location: null, status_label: ready, purchase_cost: '' }),
      hardwareRow(8, { location: { id: 9, name: 'Library' }, status_label: status(6, 'Archived', 'archived'), purchase_cost: '9,999.00' }),
    ]
    const { fetch, calls, queries } = fakeFetch({ '/hardware': { body: { total: hardware.length, rows: hardware } } })
    const r = await createSnipeIt(config, fetch, today).report('statusLocation', { locationId: '9', categoryId: '3' })
    expect(calls).toEqual(['/hardware'])
    expect(queries[0]).toMatchObject({ location_id: '9', category_id: '3' })
    expect(r).toEqual({
      columns: ['Location', 'Status Label', 'Status type', 'Assets', 'Purchase cost (total)'],
      // By Location, then most Assets first; the total is a plain number a spreadsheet sums.
      rows: [
        ['(no Location)', 'Ready to Deploy', 'deployable', '1', '0.00'],
        ['Library', 'Broken', 'undeployable', '2', '0.30'],
        ['Library', 'Deployed', 'deployable', '1', '2000.00'],
        ['Room 204', 'Ready to Deploy', 'deployable', '3', '1534.56'],
      ],
      capped: false,
    })
    expect(toCsv(r.columns, r.rows).split('\r\n')[4]).toBe('"Room 204","Ready to Deploy","deployable","3","1534.56"')
  })

  it('Checked out per User lists what each User holds with their Employee No., leaving out Assets checked out to a Location', async () => {
    const user = (id: number, name: string, employee_number: string | null) => ({ id, name, username: name.toLowerCase(), employee_number, type: 'user' })
    const hardware = [
      hardwareRow(12, { assigned_to: user(2, 'Riley Testwell', 'E-2002'), last_checkout: { datetime: '2026-09-01 08:10:00', formatted: '09/01/2026 8:10AM' }, expected_checkin: null }),
      hardwareRow(9, { assigned_to: user(2, 'Riley Testwell', 'E-2002'), last_checkout: { datetime: '2026-08-20 14:00:00' } }),
      hardwareRow(3, { assigned_to: user(1, 'Avery Sampleton', null), last_checkout: null }),
      hardwareRow(4, { assigned_to: { id: 4, name: 'Room 204', type: 'location' } }),
      hardwareRow(5, { assigned_to: null }),
    ]
    const { fetch, queries } = fakeFetch({ '/hardware': { body: { total: hardware.length, rows: hardware } } })
    const r = await createSnipeIt(config, fetch, today).report('checkedOut', { categoryId: '3' })
    expect(queries[0]).toMatchObject({ category_id: '3' })
    expect(queries[0]).not.toHaveProperty('location_id')
    expect(r).toEqual({
      columns: ['User', 'Employee No.', 'Asset Tag', 'Name', 'Asset Model', 'Category', 'Checked out', 'Expected Checkin'],
      rows: [
        ['Avery Sampleton', '', 'NOMMA-3', 'CB-3', 'HP Chromebook 14 G7', 'Chromebook', '', '2026-09-15'],
        ['Riley Testwell', 'E-2002', 'NOMMA-9', 'CB-9', 'HP Chromebook 14 G7', 'Chromebook', '2026-08-20', '2026-09-15'],
        ['Riley Testwell', 'E-2002', 'NOMMA-12', 'CB-12', 'HP Chromebook 14 G7', 'Chromebook', '2026-09-01', ''],
      ],
      capped: false,
    })
  })

  it('Maintenances keeps those started in the date range', async () => {
    const { fetch } = fakeFetch({ '/maintenances': { body: { total: maintenances.length, rows: maintenances } } })
    const r = await createSnipeIt(config, fetch, today).report('maintenances', { from: '2026-08-01', to: '2026-09-01' })
    expect(r.rows.map((row) => row[5])).toEqual(['Repair 3', 'Repair 1'])
  })

  it('End of life lists Assets past it or reaching it within 365 days, past first, in the Location and Category, Archived left out', async () => {
    const eol = (id: number, date: string | null, fields: object = {}) => ({ ...chromebook, id, asset_tag: `NOMMA-${id}`, name: `CB-${id}`, asset_eol_date: date && { date, formatted: date }, ...fields })
    const archived = { status_label: { id: 6, name: 'Archived', status_type: 'archived', status_meta: 'archived' } }
    const hardware = [eol(1, '2027-03-01'), eol(2, '2026-06-01'), eol(3, '2027-09-25'), eol(4, null), eol(5, '2026-09-24'), eol(6, '2025-01-01', archived), eol(7, '2027-09-24')]
    const { fetch, calls, queries } = auditFetch('/hardware', hardware)
    const snipeIt = createSnipeIt(config, fetch, today)
    const r = await snipeIt.report('endOfLife', { locationId: '9', categoryId: '3' })
    expect(calls).toEqual(['/hardware'])
    expect(queries[0]).toMatchObject({ location_id: '9', category_id: '3' })
    expect(r).toEqual({
      columns: ['Asset Tag', 'Name', 'Asset Model', 'Status Label', 'Assignee', 'Location', 'Purchase date', 'End of life', 'Days left'],
      rows: [
        ['NOMMA-2', 'CB-2', 'HP Chromebook 14 G7', 'Deployed', 'Jordan Reyes', 'Library', '2023-08-01', '2026-06-01', '-115'],
        ['NOMMA-5', 'CB-5', 'HP Chromebook 14 G7', 'Deployed', 'Jordan Reyes', 'Library', '2023-08-01', '2026-09-24', '0'],
        ['NOMMA-1', 'CB-1', 'HP Chromebook 14 G7', 'Deployed', 'Jordan Reyes', 'Library', '2023-08-01', '2027-03-01', '158'],
        ['NOMMA-7', 'CB-7', 'HP Chromebook 14 G7', 'Deployed', 'Jordan Reyes', 'Library', '2023-08-01', '2027-09-24', '365'],
      ],
      capped: false,
    })
    // From/To narrow the End of life date within that window.
    expect((await snipeIt.report('endOfLife', { from: '2026-09-01', to: '2027-12-31' })).rows.map((row) => row[0])).toEqual(['NOMMA-5', 'NOMMA-1', 'NOMMA-7'])
    expect(queries[1]).not.toHaveProperty('location_id')
  })

  it('a Location or Category that is not an id is refused without asking Snipe-IT', async () => {
    const { fetch, calls } = fakeFetch({})
    const snipeIt = createSnipeIt(config, fetch)
    await expect(snipeIt.report('auditDue', { locationId: '9&category_id=1' })).rejects.toThrow('Location')
    await expect(snipeIt.report('lastAudited', { categoryId: 'chromebooks' })).rejects.toThrow('Category')
    await expect(snipeIt.report('auditLate', { locationId: '0' })).rejects.toThrow('Location')
    expect(calls).toEqual([])
  })

  it('Temp checkout history pairs each live Temp checkout with its return, wherever that falls', async () => {
    let id = 0
    const entry = (asset: number, action_type: string, datetime: string, note: string, operator = 'A. Tech') => ({
      id: ++id, action_type, created_at: { datetime: datetime.length > 16 ? datetime : `${datetime}:00` }, created_by: { id: 5, name: operator },
      target: { id: 300 + asset, name: `User ${asset}`, type: 'user' }, note, item: { id: asset, name: `CB-${asset} (NOMMA-${asset})`, type: 'asset' },
    })
    const temp = (due: string, text = '') => `[Temp checkout | due: ${due}]${text}`
    // Oldest first here, reversed below: Snipe-IT sends newest first.
    const log = [
      entry(6, 'checkout', '2026-09-19 09:00', temp('2026-09-19 15:00')), // before From: paging stops here
      entry(1, 'checkout', '2026-09-20 08:00', temp('2026-09-20 14:50')),
      entry(5, 'checkout', '2026-09-20 12:00', temp('2026-09-22 15:00')),
      entry(2, 'checkout', '2026-09-21 09:00', temp('2026-09-21 15:00', ' charger too')),
      entry(3, 'checkout', '2026-09-21 10:00', temp('2026-09-21 15:00')),
      entry(4, 'checkout', '2026-09-21 11:00', temp('2026-09-21 15:00')),
      entry(4, 'checkin from', '2026-09-21 11:01', '[Undo] Temp checkout'),
      entry(6, 'checkout', '2026-09-21 11:30', '[Bulk checkout]'),
      entry(3, 'checkin from', '2026-09-21 15:00', '[Automatic check-in]'),
      entry(2, 'checkin from', '2026-09-21 15:00:40', '', 'B. Tech'), // a web UI Checkin, 40 seconds late
      entry(5, 'checkin from', '2026-09-22 08:00', '[Bulk return]'),
      entry(5, 'checkout', '2026-09-22 08:05', '[Undo] Bulk return [Temp checkout | due: 2026-09-22 15:00]'),
      entry(1, 'checkin from', '2026-09-23 10:00', '[Bulk return]', 'B. Tech'), // after To
      entry(2, 'checkout', '2026-09-23 13:00', temp('2026-09-24 15:00')),
    ].reverse()
    const hardware = [1, 2, 3, 4, 5, 6].map((n) => ({ ...chromebook, id: n, asset_tag: `NOMMA-${n}`, name: `CB-${n}` }))
    const { fetch, queries } = fakeFetch({ '/reports/activity': { body: { total: log.length, rows: log } }, '/hardware': { body: { total: hardware.length, rows: hardware } } })
    const snipeIt = createSnipeIt(config, fetch, () => new Date(2026, 8, 24, 16, 0))
    const r = await snipeIt.report('tempHistory', { from: '2026-09-20', to: '2026-09-21' })
    expect(queries[0]).toMatchObject({ sort: 'created_at', order: 'desc' })
    expect(r).toEqual({
      columns: ['Checked out', 'Asset Tag', 'Name', 'User', 'Operator', 'Due', 'Returned', 'Returned by', 'Late by'],
      rows: [
        ['2026-09-21 10:00', 'NOMMA-3', 'CB-3', 'User 3', 'A. Tech', '2026-09-21 15:00', '2026-09-21 15:00', 'Automatic check-in', ''],
        ['2026-09-21 09:00', 'NOMMA-2', 'CB-2', 'User 2', 'A. Tech', '2026-09-21 15:00', '2026-09-21 15:00', 'B. Tech', '1 min'],
        // Returned, then the return undone: still out, and late since the due time.
        ['2026-09-20 12:00', 'NOMMA-5', 'CB-5', 'User 5', 'A. Tech', '2026-09-22 15:00', 'Still out', '', '2d'],
        ['2026-09-20 08:00', 'NOMMA-1', 'CB-1', 'User 1', 'A. Tech', '2026-09-20 14:50', '2026-09-23 10:00', 'B. Tech', '3d'],
      ],
      capped: false,
    })
    // Without To, the one still out from today shows too, late by the hour on its due day.
    expect((await snipeIt.report('tempHistory', { from: '2026-09-20' })).rows[0]).toEqual(['2026-09-23 13:00', 'NOMMA-2', 'CB-2', 'User 2', 'A. Tech', '2026-09-24 15:00', 'Still out', '', '1 h'])
    // Out, back and out again within a minute: the later Checkout still comes first.
    const again = [entry(6, 'checkout', '2026-09-24 09:00:10', temp('2026-09-24 12:00')), entry(6, 'checkin from', '2026-09-24 09:00:30', ''), entry(6, 'checkout', '2026-09-24 09:00:50', temp('2026-09-24 18:00'))]
    log.unshift(...again.reverse())
    expect((await snipeIt.report('tempHistory', { from: '2026-09-24' })).rows.map((row) => row.slice(5, 7))).toEqual([['2026-09-24 18:00', 'Still out'], ['2026-09-24 12:00', '2026-09-24 09:00']])
  })

  // #69 §3. Shaped like Snipe-IT v8.7+: a Maintenance names its Asset and its type; Repair intake's Activity entries carry its Workflow note.
  describe('Damaged', () => {
    const damagedAsset = (id: number) => ({ ...chromebook, id, asset_tag: `NOMMA-${id}`, name: `CB-${id}`, assigned_to: null, status_label: { id: 6, name: 'Damaged', status_meta: 'undeployable' } })
    const maintenance = (id: number, assetId: number, start: string, type = 'Repair') =>
      ({ id, asset: { id: assetId, asset_tag: `NOMMA-${assetId}` }, maintenance_type: type, asset_maintenance_type: '', start_date: { date: start, formatted: start }, completed_at: null })
    const intake = (id: number, assetId: number, datetime: string, note: string, from: string | null, action_type = from ? 'checkin from' : 'note added') => ({
      id, action_type, created_at: { datetime }, created_by: { id: 900, name: 'Demo Operator' }, target: from && { id: 311, name: from, type: 'user' }, note, item: { id: assetId, name: `NOMMA-${assetId}`, type: 'asset' },
    })
    // Answers each Asset's Activity search from logs; hold keeps those answers back until released, to count how many are open at once.
    function damagedFetch(hardware: object[], maintenances: object[], logs: Record<number, object[]>, hold = false) {
      const { fetch: base, calls, queries } = fakeFetch({
        '/statuslabels': { body: { total: 2, rows: [{ id: 2, name: 'Deployed' }, { id: 6, name: 'damaged' }] } },
        '/hardware': { body: { total: hardware.length, rows: hardware } },
        '/maintenances': { body: { total: maintenances.length, rows: maintenances } },
      })
      const activity: Record<string, string>[] = []
      const waiting: (() => void)[] = []
      let open = 0
      let most = 0
      const fetch = async (input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(String(input))
        if (!url.pathname.endsWith('/reports/activity')) return base(input, init)
        const q = Object.fromEntries(url.searchParams)
        activity.push(q)
        most = Math.max(most, ++open)
        if (hold) await new Promise<void>((done) => waiting.push(done))
        open--
        // Snipe-IT's search is a case-insensitive substring match, here on the note.
        const rows = (logs[Number(q.item_id)] ?? []).filter((r) => String((r as { note: unknown }).note).toLowerCase().includes(q.search.toLowerCase()))
        return new Response(JSON.stringify({ total: rows.length, rows }))
      }
      const release = () => waiting.splice(0).forEach((done) => done())
      return { fetch: fetch as typeof globalThis.fetch, calls, queries, activity, release, most: () => most }
    }

    it('lists each Damaged Asset with since when, from whom and what happened, longest Damaged first and Not recorded last', async () => {
      const { fetch, calls, queries, activity } = damagedFetch([damagedAsset(1), damagedAsset(2), damagedAsset(3), damagedAsset(4)], [
        maintenance(10, 1, '2026-09-01'),
        // Not a repair: Damaged since falls back to the Repair intake.
        maintenance(11, 2, '2026-08-01', 'Upgrade'),
        maintenance(12, 99, '2026-07-01'),
      ], {
        1: [
          // Opening the Maintenance logs the same note on the Maintenance, with the Asset as its target; Snipe-IT's item_id
          // filter matches targets too.
          { ...intake(101, 1, '2026-09-01 10:01:00', '[Repair intake] cracked screen', null, 'create'), created_by: { id: 901, name: 'Other Operator' },
            item: { id: 10, name: 'NOMMA-1 damaged', type: 'maintenance' }, target: { id: 1, name: 'NOMMA-1', type: 'asset' } },
          intake(100, 1, '2026-09-01 10:00:00', '[Repair intake] cracked screen', 'Avery Testwell'),
        ],
        // Newest first, as Snipe-IT sends it; an Asset that wasn't checked out has no one it was taken in from.
        2: [intake(201, 2, '2026-09-20 13:00:00', 'Repair intake form signed', null), intake(200, 2, '2026-09-20 12:30:00', '[Repair intake] won’t power on', null)],
        // The search also matched something that isn't a Workflow note: Damaged by hand in the web UI.
        3: [intake(300, 3, '2026-09-22 09:00:00', 'Checked for the Repair intake desk', 'Blake Sampleton', 'checkout')],
        // The newer Repair intake was undone, so the older one stands.
        4: [
          intake(402, 4, '2026-09-12 10:05:00', '[Undo] Repair intake', 'Casey Mockford', 'checkout'),
          intake(401, 4, '2026-09-12 10:00:00', '[Repair intake] wrong Asset scanned', 'Casey Mockford'),
          intake(400, 4, '2026-09-05 08:00:00', '[repair intake] keyboard missing keys', 'Devon Demoski'),
        ],
      })
      const r = await createSnipeIt(config, fetch, today).report('damaged')
      expect(r).toEqual({
        columns: ['Asset Tag', 'Name', 'Asset Model', 'Damaged since', 'Days Damaged', 'Taken in from', 'Operator', 'What happened', 'Maintenance'],
        rows: [
          ['NOMMA-1', 'CB-1', 'HP Chromebook 14 G7', '2026-09-01', '23', 'Avery Testwell', 'Demo Operator', 'cracked screen', 'Open'],
          ['NOMMA-4', 'CB-4', 'HP Chromebook 14 G7', '2026-09-05', '19', 'Devon Demoski', 'Demo Operator', 'keyboard missing keys', 'None'],
          ['NOMMA-2', 'CB-2', 'HP Chromebook 14 G7', '2026-09-20', '4', '', 'Demo Operator', 'won’t power on', 'None'],
          ['NOMMA-3', 'CB-3', 'HP Chromebook 14 G7', 'Not recorded', 'Not recorded', '', '', '', 'None'],
        ],
        capped: false,
      })
      // The Damaged Status Label is found by name, then its Assets and every open Maintenance, one list each.
      expect(calls.slice(0, 3)).toEqual(['/statuslabels', '/hardware', '/maintenances'])
      expect(queries[1]).toMatchObject({ status_id: '6' })
      expect(queries[2]).toMatchObject({ completed: 'false' })
      expect(activity.map((q) => q.item_id)).toEqual(['1', '2', '3', '4'])
      expect(activity[0]).toMatchObject({ item_type: 'asset', search: 'repair', order: 'desc', limit: '20' })
    })

    it('an undo typed by hand with odd spacing still cancels its Repair intake', async () => {
      const { fetch } = damagedFetch([damagedAsset(1)], [], { 1: [
        intake(101, 1, '2026-09-12 10:05:00', '[undo]  Repair   intake', null),
        intake(100, 1, '2026-09-12 10:00:00', '[Repair intake] wrong Asset scanned', null),
      ] })
      expect((await createSnipeIt(config, fetch, today).report('damaged')).rows[0].slice(3)).toEqual(['Not recorded', 'Not recorded', '', '', '', 'None'])
    })

    it('the open Repair Maintenance’s start date wins over the Repair intake’s date', async () => {
      const { fetch } = damagedFetch([damagedAsset(1)], [maintenance(10, 1, '2026-09-03')], { 1: [intake(100, 1, '2026-09-10 10:00:00', '[Repair intake] cracked screen', null)] })
      expect((await createSnipeIt(config, fetch, today).report('damaged')).rows[0].slice(3, 5)).toEqual(['2026-09-03', '21'])
    })

    it('a Repair intake from before a finished Incoming repair doesn’t count when the Asset is set Damaged again by hand', async () => {
      const { fetch } = damagedFetch([damagedAsset(1), damagedAsset(2)], [], {
        1: [
          intake(101, 1, '2026-09-15 09:00:00', '[Incoming repair | supplier: Demo Repairs] screen replaced', null),
          intake(100, 1, '2026-09-01 10:00:00', '[Repair intake] cracked screen', 'Avery Testwell'),
        ],
        // An undone Incoming repair leaves the Repair intake standing.
        2: [
          intake(202, 2, '2026-09-15 09:05:00', '[Undo] Incoming repair', null),
          intake(201, 2, '2026-09-15 09:00:00', '[Incoming repair] wrong Asset scanned', null),
          intake(200, 2, '2026-09-02 10:00:00', '[Repair intake] won’t power on', null),
        ],
      })
      expect((await createSnipeIt(config, fetch, today).report('damaged')).rows.map((r) => r.slice(0, 1).concat(r.slice(3, 8)))).toEqual([
        ['NOMMA-2', '2026-09-02', '22', '', 'Demo Operator', 'won’t power on'],
        ['NOMMA-1', 'Not recorded', 'Not recorded', '', '', ''],
      ])
    })

    it('Days Damaged is 0, not negative, when the Repair Maintenance starts in the future', async () => {
      const { fetch } = damagedFetch([damagedAsset(1)], [maintenance(10, 1, '2026-10-01')], {})
      expect((await createSnipeIt(config, fetch, today).report('damaged')).rows[0].slice(3, 5)).toEqual(['2026-10-01', '0'])
    })

    it('searches each Damaged Asset’s Activity four at a time', async () => {
      const { fetch, activity, release, most } = damagedFetch([1, 2, 3, 4, 5, 6].map(damagedAsset), [], {}, true)
      const r = createSnipeIt(config, fetch, today).report('damaged')
      await vi.waitFor(() => expect(activity).toHaveLength(4))
      release()
      await vi.waitFor(() => expect(activity).toHaveLength(6))
      release()
      expect((await r).rows).toHaveLength(6)
      expect(most()).toBe(4)
    })

    it('says so when Snipe-IT has no Damaged Status Label', async () => {
      const { fetch } = fakeFetch({ '/statuslabels': { body: { total: 1, rows: [{ id: 2, name: 'Deployed' }] } } })
      await expect(createSnipeIt(config, fetch).report('damaged')).rejects.toThrow('Damaged')
    })
  })
})

describe('audit, End of life and cost', () => {
  it('an Asset reads its last audited and next audit dates from the v8.7+ shape', async () => {
    const asset = await snipeItWith({ ...chromebook, last_audit_date: { datetime: '2026-03-02 09:15:00', formatted: '03/02/2026 9:15AM' }, next_audit_date: { date: '2027-03-02', formatted: '03/02/2027' } }).getAsset(4812)
    expect(asset).toMatchObject({ lastAudited: '2026-03-02', nextAudit: '2027-03-02' })
    expect(await snipeItWith({ ...chromebook, last_audit_date: null, next_audit_date: null }).getAsset(4812)).toMatchObject({ lastAudited: null, nextAudit: null })
  })
  it('an Asset reads its End of life date and its purchase cost as a plain number', async () => {
    expect(await snipeItWith({ ...chromebook, asset_eol_date: { date: '2029-08-01', formatted: '08/01/2029' }, purchase_cost: '1,234.56' }).getAsset(4812))
      .toMatchObject({ endOfLife: '2029-08-01', purchaseCost: '1234.56' })
    expect(await snipeItWith({ ...chromebook, asset_eol_date: null, purchase_cost: null }).getAsset(4812)).toMatchObject({ endOfLife: null, purchaseCost: null })
  })
})

describe('the other record kinds', () => {
  it('Lists of Licenses, stocked kinds and Departments come back in app vocabulary', async () => {
    const { fetch, calls } = fakeFetch({
      '/licenses': { body: { total: 1, rows: [{ id: 3, name: 'Office Suite', manufacturer: { id: 1, name: 'Contoso' }, category: null, seats: 300, free_seats_count: 42, expiration_date: { date: '2027-06-30', formatted: 'Jun 30, 2027' } }] } },
      '/accessories': { body: { total: 1, rows: [{ id: 5, name: 'USB-C Charger', category: { id: 2, name: 'Chargers' }, manufacturer: null, location: { id: 9, name: 'Library' }, qty: 80, remaining_qty: 23 }] } },
      '/components': { body: { total: 1, rows: [{ id: 6, name: 'SSD', category: null, location: null, qty: null, remaining: 0 }] } },
      '/departments': { body: { total: 1, rows: [{ id: 2, name: 'Science', company: null, manager: { id: 7, name: 'Morgan Lee' }, location: { id: 9, name: 'Library' }, users_count: 13 }] } },
    })
    const snipeIt = createSnipeIt(config, fetch)
    expect((await snipeIt.list('licenses')).rows).toEqual([{ id: 3, name: 'Office Suite', manufacturer: 'Contoso', category: '', seats: 300, free: 42, expires: '2027-06-30', can }])
    expect((await snipeIt.list('accessories')).rows).toEqual([{ id: 5, name: 'USB-C Charger', category: 'Chargers', manufacturer: '', location: 'Library', qty: 80, remaining: 23, can }])
    expect((await snipeIt.list('components')).rows).toEqual([{ id: 6, name: 'SSD', category: '', manufacturer: '', location: '', qty: 0, remaining: 0, can }])
    expect((await snipeIt.list('departments')).rows).toEqual([{ id: 2, name: 'Science', company: '', manager: 'Morgan Lee', location: 'Library', users: 13, can }])
    expect(calls).toEqual(['/licenses', '/accessories', '/components', '/departments'])
  })

  it("a record's page has every field it sent: related records link to theirs, dates as Snipe-IT formats them, notes as text", async () => {
    const location = {
      id: 12, name: 'Room 204', parent: { id: 1, name: 'Main Campus' }, manager: { id: 7, name: 'Morgan Lee' }, city: 'Springfield', assets_count: 34,
      ldap_ou: null, currency: '', created_at: { datetime: '2023-08-01 09:00:00', formatted: 'Aug 1, 2023 9:00AM' }, notes: '<p>Back <em>door</em> sticks</p>',
      children: [{ id: 30, name: 'Closet' }], available_actions: { update: true }, image: 'https://snipe.example.org/img.png', active: true,
      opened: { date: '2020-08-17' }, tags: ['north', 'ground floor'], empty: [], budget: { amount: 100, currency: 'USD', note: null },
      // A { total, rows } list reads one field per row; a User's groups are the same shape but shown in their own section, not as fields.
      zones: { total: 2, rows: [{ id: 1, name: 'North wing' }, { id: 2, name: 'South wing' }] }, groups: { total: 1, rows: [{ id: 1, name: 'Facilities' }] },
    }
    const { fetch } = fakeFetch({ '/locations/12': { body: location } })
    expect(await createSnipeIt(config, fetch).record('locations', 12)).toEqual({
      kind: 'locations', id: 12, name: 'Room 204', can: { checkout: true, checkin: true, update: true, delete: true, audit: true },
      fields: [
        { label: 'Parent', value: 'Main Campus', link: { kind: 'locations', id: 1 } },
        { label: 'Manager', value: 'Morgan Lee', link: { kind: 'users', id: 7 } },
        { label: 'City', value: 'Springfield' },
        { label: 'Assets', value: '34' },
        { label: 'Created at', value: 'Aug 1, 2023 9:00AM' },
        { label: 'Notes', value: 'Back door sticks' },
        { label: 'Children', value: 'Closet', link: { kind: 'locations', id: 30 } },
        { label: 'Active', value: 'Yes' },
        { label: 'Opened', value: '2020-08-17' },
        { label: 'Tags', value: 'north, ground floor' },
        { label: 'Budget', value: 'amount: 100, currency: USD' },
        { label: 'Zones', value: 'North wing' },
        { label: 'Zones', value: 'South wing' },
      ],
    })
  })

  it("an Asset's fields include its custom fields and link its Assignee by kind", async () => {
    const withCustom = { ...chromebook, supplier: { id: 2, name: 'EduDevices Inc.' }, custom_fields: { 'MAC Address': { field: '_snipeit_mac_1', value: '00:1A:2B:3C:4D:5E' }, 'Empty': { field: '_snipeit_e_2', value: null } } }
    const { fields } = await snipeItWith(withCustom).getAsset(4812)
    expect(fields).toContainEqual({ label: 'Assignee', value: 'Jordan Reyes', link: { kind: 'users', id: 311 } })
    expect(fields).toContainEqual({ label: 'Asset Model', value: 'HP Chromebook 14 G7', link: { kind: 'models', id: 7 } })
    expect(fields).toContainEqual({ label: 'Supplier', value: 'EduDevices Inc.', link: { kind: 'suppliers', id: 2 } })
    expect(fields.at(-1)).toEqual({ label: 'MAC Address', value: '00:1A:2B:3C:4D:5E' })
    expect(fields.some((f) => f.label === 'Empty')).toBe(false)
  })

  it("a Category says what it holds, so its page links to that List; those Lists filter by Category", async () => {
    const { fetch, queries } = fakeFetch({ '/categories/8': { body: { id: 8, name: 'Toner', category_type: 'consumable' } }, '/consumables': { body: { total: 0, rows: [] } } })
    const snipeIt = createSnipeIt(config, fetch)
    expect(await snipeIt.record('categories', 8)).toMatchObject({ name: 'Toner', categoryType: 'consumable' })
    await snipeIt.list('consumables', { filters: { category_id: '8' } })
    expect(queries.at(-1)).toMatchObject({ category_id: '8' })
  })

  it("a Category's items are counted by its own type when Snipe-IT sends no item_count", async () => {
    const { fetch } = fakeFetch({ '/categories': { body: { total: 2, rows: [
      { id: 1, name: 'Toner', category_type: 'consumable', assets_count: 0, consumables_count: 12 },
      { id: 2, name: 'Chargers', category_type: 'accessory', assets_count: 0, accessories_count: 7 },
      { id: 3, name: 'Laptops', category_type: 'asset', item_count: 40, assets_count: 3 },
    ] } } })
    expect((await createSnipeIt(config, fetch).list('categories')).rows.map((r) => r.items)).toEqual([12, 7, 40])
  })

  it.each(['activity', 'assets', 'hardware'])('a record of kind %s is refused without asking Snipe-IT', async (kind) => {
    const { fetch, calls } = fakeFetch({})
    await expect(createSnipeIt(config, fetch).record(kind as 'users', 1)).rejects.toThrow('Unknown record')
    expect(calls).toEqual([])
  })

  it("a Manufacturer's, Supplier's or Company's Assets are asked for with Snipe-IT's filter", async () => {
    const { fetch, queries } = fakeFetch({ '/hardware': { body: { total: 0, rows: [] } } })
    await createSnipeIt(config, fetch).list('assets', { filters: { manufacturer_id: '4', supplier_id: '2', company_id: '1' } })
    expect(queries[0]).toEqual({ limit: '50', offset: '0', manufacturer_id: '4', supplier_id: '2', company_id: '1' })
  })
})

describe('create, edit and delete', () => {
  // Snipe-IT sends a Fieldset's Custom Fields with the Fieldset; its /fields endpoint answers only a POST, so a GET there gets the 404.
  const fieldset = { id: 3, name: 'Chromebooks', fields: { total: 3, rows: [{ name: 'MAC Address', db_column_name: '_snipeit_mac_1', type: 'text', format: 'MAC', required: 1, field_values_array: null }, { name: 'Cart', db_column_name: '_snipeit_cart_2', type: 'listbox', format: 'ANY', required: 0, field_values_array: ['A', 'B'] },
    { name: 'Chargers', db_column_name: '_snipeit_chargers_3', type: 'checkbox', format: 'ANY', required: 0, field_values_array: ['USB-C', 'Barrel'] }] } }
  const editable = { ...chromebook, rtd_location: { id: 4, name: 'IT Office' }, purchase_cost: '1,200.50', warranty_months: '36 months', notes: '<p>Spare</p>', name: 'Cart <B>', supplier: null, company: null,
    custom_fields: { 'MAC Address': { field: '_snipeit_mac_1', value: '00:1A:2B:3C:4D:5E' } } }

  it("editing an Asset fills its form from what Snipe-IT sent, with its Asset Model's custom fields", async () => {
    const { fetch } = fakeFetch({ '/hardware/4812': { body: editable }, '/models/7': { body: { id: 7, fieldset: { id: 3, name: 'Chromebooks' } } },
      '/fieldsets/3': { body: fieldset }, 'POST /fieldsets/3/fields': { body: fieldset.fields } })
    const snipeIt = createSnipeIt(config, fetch)
    const { fields, values } = await snipeIt.form('assets', 4812)
    // Choosing that Asset Model on the form loads the same fields.
    expect(await snipeIt.customFields(7)).toEqual(fields.slice(-3))
    expect(fields.slice(-3)).toEqual([
      { key: '_snipeit_mac_1', label: 'MAC Address', required: true, type: 'text' },
      { key: '_snipeit_cart_2', label: 'Cart', required: false, type: 'choice', options: ['A', 'B'] },
      { key: '_snipeit_chargers_3', label: 'Chargers', required: false, type: 'choices', options: ['USB-C', 'Barrel'] },
    ])
    expect(values).toMatchObject({ asset_tag: 'NOMMA-004812', model_id: '7', status_id: '2', rtd_location_id: '4', supplier_id: '', purchase_date: '2023-08-01',
      purchase_cost: '1200.50', warranty_months: '36', notes: 'Spare', name: 'Cart <B>', _snipeit_mac_1: '00:1A:2B:3C:4D:5E', _snipeit_cart_2: '' })
  })

  it('Edit Asset fills in Expected Checkin as Snipe-IT v8.7+ sends it, with a time of day, and as older servers do', async () => {
    const formFor = async (expected_checkin: object) => {
      const { fetch } = fakeFetch({ '/hardware/4812': { body: { ...editable, expected_checkin } }, '/models/7': { body: { id: 7, fieldset: null } } })
      return (await createSnipeIt(config, fetch).form('assets', 4812)).values.expected_checkin
    }
    expect(await formFor({ datetime: '2026-10-10 14:50:00', formatted: '2026-10-10 2:50 PM' })).toBe('2026-10-10')
    expect(await formFor({ date: '2026-10-01', formatted: '10/01/2026' })).toBe('2026-10-01')
  })

  it('Edit Asset has Next audit date, filled in as Snipe-IT sends it and saved back, or cleared, so a mistaken Audit can be put back', async () => {
    const { fetch, requests } = fakeFetch({ '/hardware/4812': { body: { ...editable, next_audit_date: { date: '2026-10-01', formatted: '2026-10-01' } } }, '/models/7': { body: { id: 7, fieldset: null } },
      'PATCH /hardware/4812': { body: { status: 'success', messages: 'Updated.' } } })
    const snipeIt = createSnipeIt(config, fetch)
    const { fields, values } = await snipeIt.form('assets', 4812)
    expect(fields.find((f) => f.key === 'next_audit_date')).toEqual({ key: 'next_audit_date', label: 'Next audit date', type: 'date' })
    expect(values.next_audit_date).toBe('2026-10-01')
    await snipeIt.save('assets', 4812, { next_audit_date: '2026-10-01' })
    await snipeIt.save('assets', 4812, { next_audit_date: '' })
    expect(requests.filter((r) => r.method === 'PATCH').map((r) => r.body)).toEqual([{ next_audit_date: '2026-10-01' }, { next_audit_date: null }])
  })

  it("a note Snipe-IT sends rendered comes back as Markdown, so editing it keeps its links and emphasis", () => {
    expect(markdownOf('<p>Screen <strong>cracked</strong>, see <a href="https://help.example.org/t/12" rel="nofollow">ticket 12</a><br />Use <em>only</em> the <code>USB-C</code> charger</p>'))
      .toBe('Screen **cracked**, see [ticket 12](https://help.example.org/t/12)\nUse *only* the `USB-C` charger')
  })

  it("an Accessory's minimum is read from min_qty, as Snipe-IT sends it, and saved as min_amt", async () => {
    const { fetch, requests } = fakeFetch({ '/accessories/5': { body: { id: 5, name: 'Charger', qty: 60, min_qty: 10, category: { id: 2, name: 'Chargers' } } }, 'PATCH /accessories/5': { body: { status: 'success' } } })
    const snipeIt = createSnipeIt(config, fetch)
    expect((await snipeIt.form('accessories', 5)).values).toMatchObject({ min_amt: '10', category_id: '2', qty: '60' })
    await snipeIt.save('accessories', 5, { min_amt: '12' })
    expect(requests.at(-1)).toMatchObject({ method: 'PATCH', body: { min_amt: '12' } })
  })

  it("a License's Minimum quantity: a blank one is sent as none, never 0, so none set and 0 stay different", async () => {
    const { fetch, requests } = fakeFetch({ '/licenses/3': { body: { id: 3, name: 'Typing Tutor', seats: 30, min_amt: 5 } }, 'PATCH /licenses/3': { body: { status: 'success' } } })
    const snipeIt = createSnipeIt(config, fetch)
    expect((await snipeIt.form('licenses', 3)).values).toMatchObject({ min_amt: '5', seats: '30' })
    await snipeIt.save('licenses', 3, { min_amt: '' })
    expect(requests.at(-1)?.body).toEqual({ min_amt: null })
    await snipeIt.save('licenses', 3, { min_amt: '0' })
    expect(requests.at(-1)?.body).toEqual({ min_amt: '0' })
  })

  it('a new User asks for a password; editing one does not', async () => {
    const snipeIt = createSnipeIt(config, fakeFetch({ '/users/311': { body: { id: 311, first_name: 'Jordan', username: 'jreyes' } } }).fetch)
    expect((await snipeIt.form('users')).fields.map((f) => f.key)).toContain('password_confirmation')
    expect((await snipeIt.form('users', 311)).fields.map((f) => f.key)).not.toContain('password')
  })

  it('creating sends the form to Snipe-IT, a blank choice or date as none, and returns the new id', async () => {
    const { fetch, requests } = fakeFetch({ 'POST /hardware': { body: { status: 'success', messages: 'Created.', payload: { id: 5001 } } } })
    const result = await createSnipeIt(config, fetch).save('assets', null, { asset_tag: 'NOMMA-5001', model_id: '7', status_id: '1', name: '', supplier_id: '', purchase_date: '', _snipeit_mac_1: '00:11:22:33:44:55' })
    expect(result).toEqual({ ok: true, id: 5001 })
    expect(requests.at(-1)).toEqual({ method: 'POST', path: '/hardware', body: { asset_tag: 'NOMMA-5001', model_id: '7', status_id: '1', name: '', supplier_id: null, purchase_date: null, _snipeit_mac_1: '00:11:22:33:44:55' } })
  })

  it("Snipe-IT's reasons come back beside the field they're about; others as one line", async () => {
    const refusal = { status: 'error', messages: { asset_tag: ['The asset tag must be unique.'], model_id: ['The model id field is required.'], image: ['Too big.'] }, payload: null }
    const { fetch } = fakeFetch({ 'PATCH /hardware/4812': { body: refusal } })
    expect(await createSnipeIt(config, fetch).save('assets', 4812, { asset_tag: 'NOMMA-1', model_id: '' })).toEqual({
      ok: false, message: 'Too big.', errors: { asset_tag: 'The asset tag must be unique.', model_id: 'The model id field is required.', image: 'Too big.' },
    })
    const whole = fakeFetch({ 'POST /users': { status: 422, body: { message: 'The given data was invalid.', errors: { username: ['The username has already been taken.'] } } } })
    expect(await createSnipeIt(config, whole.fetch).save('users', null, { first_name: 'A', username: 'jreyes' }))
      .toEqual({ ok: false, message: "Snipe-IT didn't save it: see the fields marked below.", errors: { username: 'The username has already been taken.' } })
  })

  it('editing PATCHes only the form, leaving out a new-only password; a field the form lacks is refused', async () => {
    const { fetch, requests, calls } = fakeFetch({ 'PATCH /users/311': { body: { status: 'success', payload: { id: 311 } } } })
    const snipeIt = createSnipeIt(config, fetch)
    expect(await snipeIt.save('users', 311, { first_name: 'Jordan', password: 'x', department_id: '' })).toEqual({ ok: true, id: 311 })
    expect(requests.at(-1)).toEqual({ method: 'PATCH', path: '/users/311', body: { first_name: 'Jordan', department_id: null } })
    await expect(snipeIt.save('users', 311, { permissions: '{"superuser":"1"}' })).rejects.toThrow('Invalid field: permissions')
    await expect(snipeIt.save('users', 311, { _snipeit_mac_1: 'x' })).rejects.toThrow('Invalid field')
    expect(calls).toHaveLength(1)
  })

  it("deleting DELETEs the record; Snipe-IT's refusal is thrown as its reason", async () => {
    const { fetch, requests } = fakeFetch({
      'DELETE /locations/12': { body: { status: 'success', messages: 'Deleted.' } },
      'DELETE /hardware/4812': { body: { status: 'error', messages: 'This asset is currently checked out, and cannot be deleted.' } },
    })
    const snipeIt = createSnipeIt(config, fetch)
    await snipeIt.remove('locations', 12)
    expect(requests.at(-1)).toMatchObject({ method: 'DELETE', path: '/locations/12' })
    await expect(snipeIt.remove('assets', 4812)).rejects.toThrow('currently checked out')
    await expect(snipeIt.remove('activity' as 'assets', 1)).rejects.toThrow('Unknown record')
  })

  it('a Bulk Action deletes with one DELETE per Record, the kinds the app does not edit too', async () => {
    const { fetch, requests } = fakeFetch(Object.fromEntries(
      ['/suppliers/3', '/suppliers/4', '/models/7', '/categories/2', '/manufacturers/5', '/departments/6', '/companies/8', '/statuslabels/9']
        .map((p) => [`DELETE ${p}`, { body: { status: 'success', messages: 'Deleted.' } }])))
    const snipeIt = createSnipeIt(config, fetch)
    for (const [kind, id] of [['suppliers', 3], ['suppliers', 4], ['models', 7], ['categories', 2], ['manufacturers', 5], ['departments', 6], ['companies', 8], ['statuslabels', 9]] as const)
      await snipeIt.remove(kind, id)
    expect(requests.map((r) => `${r.method} ${r.path}`)).toEqual(['DELETE /suppliers/3', 'DELETE /suppliers/4', 'DELETE /models/7', 'DELETE /categories/2', 'DELETE /manufacturers/5', 'DELETE /departments/6', 'DELETE /companies/8', 'DELETE /statuslabels/9'])
  })

  it("a User with items checked out isn't deleted: Snipe-IT's refusal is thrown as its reason", async () => {
    const { fetch } = fakeFetch({ 'DELETE /users/311': { body: { status: 'error', messages: 'This user has items assigned and could not be deleted.' } } })
    await expect(createSnipeIt(config, fetch).remove('users', 311)).rejects.toThrow('This user has items assigned and could not be deleted.')
  })

  it("a bulk edit offers the fields an Asset's own form does but its Asset Tag and Serial, and a User's Department, Location and Company", () => {
    expect(BULK_FORMS.assets.map((f) => f.key)).toEqual(['model_id', 'status_id', 'expected_checkin', 'next_audit_date', 'name', 'rtd_location_id', 'supplier_id', 'company_id', 'order_number',
      'purchase_date', 'purchase_cost', 'warranty_months', 'notes'])
    expect(BULK_FORMS.users.map((f) => f.key)).toEqual(['department_id', 'location_id', 'company_id'])
    // Left blank, a field is left as each Record has it, so none is required.
    expect([...BULK_FORMS.assets, ...BULK_FORMS.users].some((f) => f.required)).toBe(false)
  })

  it('a bulk edit sends one PATCH per Record with only the fields the Operator filled in', async () => {
    const { fetch, requests } = fakeFetch(Object.fromEntries(['/hardware/1', '/hardware/2', '/users/311', '/users/312']
      .map((p) => [`PATCH ${p}`, { body: { status: 'success', messages: 'Updated.' } }])))
    const snipeIt = createSnipeIt(config, fetch)
    const shared = filled({ status_id: '4', expected_checkin: '2026-10-15', name: '', supplier_id: '', notes: '  ' })
    for (const id of [1, 2]) await snipeIt.save('assets', id, shared)
    for (const id of [311, 312]) await snipeIt.save('users', id, filled({ department_id: '', location_id: '9', company_id: '' }))
    expect(requests).toEqual([
      { method: 'PATCH', path: '/hardware/1', body: { status_id: '4', expected_checkin: '2026-10-15' } },
      { method: 'PATCH', path: '/hardware/2', body: { status_id: '4', expected_checkin: '2026-10-15' } },
      { method: 'PATCH', path: '/users/311', body: { location_id: '9' } },
      { method: 'PATCH', path: '/users/312', body: { location_id: '9' } },
    ])
  })

  it("every List row says whether the Operator may delete it, from Snipe-IT's available_actions", async () => {
    const { fetch } = fakeFetch({ '/suppliers': { body: { total: 2, rows: [{ id: 3, name: 'CDW', available_actions: { update: true, delete: false } }, { id: 4, name: 'Dell' }] } } })
    const page = await createSnipeIt(config, fetch).list('suppliers')
    expect(page.rows.map((r) => r.can.delete)).toEqual([false, true])
  })
})

describe('permissions', () => {
  it("what an Asset's key may do comes from Snipe-IT's available_actions; an older Snipe-IT that doesn't say allows it", async () => {
    const limited = { ...chromebook, available_actions: { checkout: true, checkin: false, update: false, delete: false, audit: false } }
    expect((await snipeItWith(limited).getAsset(4812)).can).toEqual({ checkout: true, checkin: false, update: false, delete: false, audit: false })
    expect((await snipeItWith(chromebook).getAsset(4812)).can).toEqual({ checkout: true, checkin: true, update: true, delete: true, audit: true })
  })

  it('only an account Snipe-IT lets read groups (a superuser) can manage permissions; other failures still say what went wrong', async () => {
    const superuser = fakeFetch({ '/groups': { body: { total: 2, rows: [{ id: 1, name: 'IT Staff' }] } } })
    expect(await createSnipeIt(config, superuser.fetch).canManagePermissions()).toBe(true)
    const operator = fakeFetch({ '/groups': { status: 403, body: { status: 'error', messages: 'You do not have permission to access this area.' } } })
    expect(await createSnipeIt(config, operator.fetch).canManagePermissions()).toBe(false)
    const offline = (async () => { throw new TypeError('fetch failed') }) as typeof globalThis.fetch
    await expect(createSnipeIt(config, offline).canManagePermissions()).rejects.toThrow("Can't reach Snipe-IT")
    const oldServer = fakeFetch({})
    await expect(createSnipeIt(config, oldServer.fetch).canManagePermissions()).rejects.toThrow('Not found')
    const refused = fakeFetch({ '/groups': { body: { status: 'error', messages: 'Something else went wrong.' } } })
    await expect(createSnipeIt(config, refused.fetch).canManagePermissions()).rejects.toThrow('Something else went wrong.')
  })

  it("a User's own permissions (granted or denied, not inherited) and their groups", async () => {
    const user = { id: 311, name: 'Jordan Reyes', permissions: { 'reports.view': '1', 'assets.delete': '-1', 'users.view': '0' }, groups: { total: 1, rows: [{ id: 2, name: 'Library Aides' }] } }
    const { fetch } = fakeFetch({ '/users/311': { body: user } })
    expect(await createSnipeIt(config, fetch).userAccess(311)).toEqual({ permissions: { 'reports.view': '1', 'assets.delete': '-1' }, groups: [{ id: 2, name: 'Library Aides' }] })
    const none = fakeFetch({ '/users/5': { body: { id: 5, name: 'New', permissions: null, groups: null } } })
    expect(await createSnipeIt(config, none.fetch).userAccess(5)).toEqual({ permissions: {}, groups: [] })
    const text = fakeFetch({ '/users/6': { body: { id: 6, name: 'Old', permissions: '{"admin":"1"}', groups: null } }, '/groups/3': { body: { id: 3, name: 'G', permissions: '{"assets.view":"1"}' } } })
    expect((await createSnipeIt(config, text.fetch).userAccess(6)).permissions).toEqual({ admin: '1' })
    expect((await createSnipeIt(config, text.fetch).group(3)).permissions).toEqual({ 'assets.view': '1' })
  })

  it("a User's groups are set all at once; a group id that isn't a whole number is refused", async () => {
    const { fetch, requests, calls } = fakeFetch({ 'PATCH /users/311': { body: { status: 'success' } } })
    const snipeIt = createSnipeIt(config, fetch)
    await snipeIt.setUserGroups(311, [1, 2])
    expect(requests.at(-1)).toEqual({ method: 'PATCH', path: '/users/311', body: { groups: [1, 2] } })
    await expect(snipeIt.setUserGroups(311, ['1; drop' as unknown as number])).rejects.toThrow('Invalid group id')
    expect(calls).toHaveLength(1)
  })

  it("a group's permissions are read as granted or not, and saved as Snipe-IT's JSON; only permission keys are sent", async () => {
    const { fetch, requests } = fakeFetch({
      '/groups/2': { body: { id: 2, name: 'Library Aides', permissions: { 'assets.view': '1', 'assets.checkout': 1, 'assets.delete': '0' } } },
      'PATCH /groups/2': { body: { status: 'success' } },
    })
    const snipeIt = createSnipeIt(config, fetch)
    expect(await snipeIt.group(2)).toEqual({ id: 2, name: 'Library Aides', permissions: { 'assets.view': '1', 'assets.checkout': '1', 'assets.delete': '0' } })
    await snipeIt.saveGroup(2, 'Library Aides', { 'assets.view': '1', 'assets.checkin': '1' })
    expect(requests.at(-1)).toEqual({ method: 'PATCH', path: '/groups/2', body: { name: 'Library Aides', permissions: '{"assets.view":"1","assets.checkin":"1"}' } })
    await expect(snipeIt.saveGroup(2, 'x', { 'assets.view"}': '1' })).rejects.toThrow('Invalid permission')
    await expect(snipeIt.saveGroup(2, 'x', { superuser: 'yes' })).rejects.toThrow('Invalid permission')
  })

  it("a group Snipe-IT refuses to save says why, beside the field", async () => {
    const { fetch } = fakeFetch({ 'PATCH /groups/2': { body: { status: 'error', messages: { name: ['The name field is required.'] } } } })
    expect(await createSnipeIt(config, fetch).saveGroup(2, '', {})).toEqual({ ok: false, message: "Snipe-IT didn't save it: see the fields marked below.", errors: { name: 'The name field is required.' } })
  })
})

describe('updateStatus', () => {
  it('PATCHes only the new status onto the Asset', async () => {
    const { fetch, requests } = fakeFetch({ 'PATCH /hardware/4812': { body: { status: 'success', messages: 'Asset updated.' } } })
    await createSnipeIt(config, fetch).updateStatus(4812, 3)
    expect(requests).toEqual([{ method: 'PATCH', path: '/hardware/4812', body: { status_id: 3 } }])
  })

  it("a status Snipe-IT refuses is thrown as Snipe-IT's reason", async () => {
    const refused = { status: 'error', messages: { status_id: ['That status is not deployable.'] }, payload: null }
    const { fetch } = fakeFetch({ 'PATCH /hardware/4812': { body: refused } })
    await expect(createSnipeIt(config, fetch).updateStatus(4812, 3)).rejects.toThrow('That status is not deployable.')
  })
})

describe('Repair intake', () => {
  const denied = { status: 403, body: { status: 'error', messages: 'This action is unauthorized.' } }
  const repairType = { id: 4, name: 'Repair', tag_color: null }

  it('"(by <Operator>)" is the display name, else the name, else the username, from /users/me', async () => {
    const me = (body: object) => createSnipeIt(config, fakeFetch({ '/users/me': { body: { id: 900, username: 'dtech', ...body } } }).fetch).operatorName()
    expect(await me({ display_name: 'D. Tech', name: 'Demo Tech' })).toBe('D. Tech')
    expect(await me({ display_name: null, name: 'Demo Tech' })).toBe('Demo Tech')
    expect(await me({ display_name: '', name: '' })).toBe('dtech')
    await expect(me({ display_name: null, name: '', username: '' })).rejects.toThrow("couldn't read your name from Snipe-IT")
  })

  describe('the Maintenance type for repairs', () => {
    it("is Snipe-IT's Repair type when the key can read Maintenance types", async () => {
      const { fetch, calls, queries } = fakeFetch({ '/maintenance-types': { body: { total: 2, rows: [{ id: 3, name: 'Repairable parts' }, { id: 4, name: 'repair' }] } } })
      expect(await createSnipeIt(config, fetch).repairTypeId(9)).toBe(4)
      expect(calls).toEqual(['/maintenance-types'])
      expect(queries[0]).toMatchObject({ search: 'Repair' })
    })

    it("on a 403 or no match, any existing Repair Maintenance's type", async () => {
      const found = { body: { total: 2, rows: [{ id: 50, maintenance_type_details: { id: 2, name: 'Upgrade' } }, { id: 51, maintenance_type_details: repairType }] } }
      for (const types of [denied, { body: { total: 0, rows: [] } }]) {
        const { fetch, calls, queries } = fakeFetch({ '/maintenance-types': types, '/maintenances': found })
        expect(await createSnipeIt(config, fetch).repairTypeId(9)).toBe(4)
        expect(calls).toEqual(['/maintenance-types', '/maintenances'])
        expect(queries[1]).toMatchObject({ search: 'Repair' })
      }
    })

    it('otherwise the Settings id; with none of them, null', async () => {
      const { fetch, calls } = fakeFetch({ '/maintenance-types': denied, '/maintenances': { body: { total: 0, rows: [] } } })
      expect(await createSnipeIt(config, fetch).repairTypeId(9)).toBe(9)
      expect(calls).toEqual(['/maintenance-types', '/maintenances'])
      expect(await createSnipeIt(config, fetch).repairTypeId(null)).toBeNull()
    })
  })

  it("an Asset's open Maintenances, each with its type", async () => {
    const { fetch, queries } = fakeFetch({ '/maintenances': { body: { total: 2, rows: [{ id: 51, maintenance_type_details: repairType }, { id: 52, maintenance_type_details: null }] } } })
    expect(await createSnipeIt(config, fetch).openMaintenances(4812)).toEqual([{ id: 51, type: { id: 4, name: 'Repair' } }, { id: 52, type: null }])
    expect(queries[0]).toMatchObject({ asset_id: '4812', completed: 'false' })
  })

  it('opens a Maintenance and gives back its id', async () => {
    const { fetch, requests } = fakeFetch({ 'POST /maintenances': { body: { status: 'success', messages: 'Created.', payload: { id: 61 } } } })
    const input = { assetId: 4812, typeId: 4, name: 'NOMMA-004812 damaged', startDate: '2026-10-11', notes: '[Repair intake] cracked screen' }
    expect(await createSnipeIt(config, fetch).createMaintenance(input)).toBe(61)
    expect(requests).toEqual([{ method: 'POST', path: '/maintenances', body: { asset_id: 4812, maintenance_type_id: 4, name: 'NOMMA-004812 damaged', start_date: '2026-10-11', notes: '[Repair intake] cracked screen' } }])
    const refused = fakeFetch({ 'POST /maintenances': { body: { status: 'error', messages: { maintenance_type_id: ['The selected maintenance type id is invalid.'] }, payload: null } } })
    await expect(createSnipeIt(config, refused.fetch).createMaintenance(input)).rejects.toThrow('The selected maintenance type id is invalid.')
  })

  it('deletes a Maintenance', async () => {
    const { fetch, requests } = fakeFetch({ 'DELETE /maintenances/61': { body: { status: 'success', messages: 'Deleted.', payload: null } } })
    await createSnipeIt(config, fetch).deleteMaintenance(61)
    expect(requests).toEqual([{ method: 'DELETE', path: '/maintenances/61', body: {} }])
    await expect(createSnipeIt(config, fetch).deleteMaintenance(Number.NaN)).rejects.toThrow(/Invalid Maintenance id/)
  })

  it("adds a note to an Asset's History", async () => {
    const { fetch, requests } = fakeFetch({ 'POST /notes/4812/store': { body: { status: 'success', messages: 'Note added', payload: { note: 'x', item_id: 4812 } } } })
    await createSnipeIt(config, fetch).addAssetNote(4812, '[Repair intake] cracked screen')
    expect(requests).toEqual([{ method: 'POST', path: '/notes/4812/store', body: { note: '[Repair intake] cracked screen' } }])
  })

  describe("the User notes line: a safe read-modify-write of the User's notes", () => {
    const line = userNotesLine('2026-10-11', 'NOMMA-004812', 'cracked screen', 'D. Tech')
    // A User whose notes the server keeps between calls; patch() can change them as another Operator would.
    function user(notes: string | null, patch = (sent: string) => sent) {
      let kept = notes
      const fake = fakeFetch({
        '/users/311': { body: () => ({ id: 311, name: 'Avery Testwell', notes: kept }) },
        'PATCH /users/311': { body: () => (kept = patch((fake.requests.at(-1)!.body as { notes: string }).notes), { status: 'success', messages: 'Updated.', payload: {} }) },
      })
      return fake
    }

    it('reads the notes, writes them back with the line after, and re-reads to check', async () => {
      const { fetch, requests } = user('Loaner agreement on file.\n[2026-09-02] [NOMMA-000777] damaged – bent hinge (by D. Tech)')
      await createSnipeIt(config, fetch).appendUserNotes(311, line)
      expect(requests.map((r) => `${r.method} ${r.path}`)).toEqual(['GET /users/311', 'PATCH /users/311', 'GET /users/311'])
      expect(requests[1].body).toEqual({ notes: `Loaner agreement on file.\n[2026-09-02] [NOMMA-000777] damaged – bent hinge (by D. Tech)\n${line}` })
    })

    it('empty notes become just the line', async () => {
      const { fetch, requests } = user(null)
      await createSnipeIt(config, fetch).appendUserNotes(311, line)
      expect(requests[1].body).toEqual({ notes: line })
    })

    it('refuses notes holding markup Snipe-IT rendered, without writing', async () => {
      for (const notes of ['See <a href="https://example.org/form">the form</a>', 'Asked <em>twice</em>', 'one<br />two']) {
        const { fetch, requests } = user(notes)
        await expect(createSnipeIt(config, fetch).appendUserNotes(311, line)).rejects.toThrow("the User's notes have formatting the app can't keep")
        expect(requests.map((r) => r.method)).toEqual(['GET'])
      }
    })

    it("a key that can't edit Users (403) is refused once, never retried", async () => {
      const { fetch, requests } = fakeFetch({ '/users/311': { body: { id: 311, notes: '' } }, 'PATCH /users/311': denied })
      await expect(createSnipeIt(config, fetch).appendUserNotes(311, line)).rejects.toThrow("your Snipe-IT account can't edit Users")
      expect(requests.map((r) => r.method)).toEqual(['GET', 'PATCH'])
    })

    it('a re-read that no longer starts with the old notes and ends with the line is reported, never retried', async () => {
      for (const other of [(sent: string) => sent.replace('Loaner', 'Returned'), (sent: string) => `${sent}\nCalled home`]) {
        const { fetch, requests } = user('Loaner agreement on file.', other)
        await expect(createSnipeIt(config, fetch).appendUserNotes(311, line)).rejects.toThrow("someone else changed the User's notes at the same time; check them for the line")
        expect(requests.map((r) => r.method)).toEqual(['GET', 'PATCH', 'GET'])
      }
    })

    describe('taking the line off again (Undo last)', () => {
      it('writes the notes back without it when they still end with exactly that line', async () => {
        for (const [notes, left] of [[`Loaner agreement on file.\n${line}\n`, 'Loaner agreement on file.'], [line, '']]) {
          const { fetch, requests } = user(notes)
          await createSnipeIt(config, fetch).removeUserNotesLine(311, line)
          expect(requests.map((r) => `${r.method} ${r.path}`)).toEqual(['GET /users/311', 'PATCH /users/311'])
          expect(requests[1].body).toEqual({ notes: left })
        }
      })

      it('leaves notes that changed since alone: another line after it, or the line edited', async () => {
        for (const notes of [`${line}\nCalled home`, line.replace('cracked', 'chipped'), `Old note ${line}`]) {
          const { fetch, requests } = user(notes)
          await expect(createSnipeIt(config, fetch).removeUserNotesLine(311, line)).rejects.toThrow(/^changed since$/)
          expect(requests.map((r) => r.method)).toEqual(['GET'])
        }
      })

      it("refuses markup, and a key that can't edit Users, like adding it", async () => {
        const marked = user(`See <a href="https://example.org/form">the form</a>\n${line}`)
        await expect(createSnipeIt(config, marked.fetch).removeUserNotesLine(311, line)).rejects.toThrow("the User's notes have formatting the app can't keep")
        const { fetch } = fakeFetch({ '/users/311': { body: { id: 311, notes: line } }, 'PATCH /users/311': denied })
        await expect(createSnipeIt(config, fetch).removeUserNotesLine(311, line)).rejects.toThrow("your Snipe-IT account can't edit Users")
      })
    })
  })
})

describe('labelPdf', () => {
  // A PDF's first bytes, base64: what Snipe-IT's payload.pdf starts with.
  const pdf = btoa('%PDF-1.7 label')

  it("POSTs the Asset Tag to Snipe-IT's label endpoint and returns its Label PDF, base64", async () => {
    const { fetch, requests } = fakeFetch({ 'POST /hardware/labels': { body: { status: 'success', messages: 'Labels were successfully generated.', payload: { pdf } } } })
    await expect(createSnipeIt(config, fetch).labelPdf(['NOMMA-004812'])).resolves.toBe(pdf)
    expect(requests).toEqual([{ method: 'POST', path: '/hardware/labels', body: { asset_tags: ['NOMMA-004812'] } }])
  })

  it('asks for one Label PDF covering every Asset Tag', async () => {
    const { fetch, requests } = fakeFetch({ 'POST /hardware/labels': { body: { status: 'success', messages: 'Labels were successfully generated.', payload: { pdf } } } })
    await expect(createSnipeIt(config, fetch).labelPdf(['NOMMA-004812', 'NOMMA-001003', 'NOMMA-000007'])).resolves.toBe(pdf)
    expect(requests).toEqual([{ method: 'POST', path: '/hardware/labels', body: { asset_tags: ['NOMMA-004812', 'NOMMA-001003', 'NOMMA-000007'] } }])
  })

  it('refuses no Asset Tags, or ones that are not text, without asking Snipe-IT', async () => {
    const { fetch, requests } = fakeFetch({})
    const snipeIt = createSnipeIt(config, fetch)
    for (const tags of [[], [''], ['NOMMA-004812', 7], 'NOMMA-004812', null])
      await expect(snipeIt.labelPdf(tags as string[])).rejects.toThrow(/Invalid Asset Tag/)
    expect(requests).toEqual([])
  })

  it('is null on a Snipe-IT without the label endpoint, so the app prints its own Label', async () => {
    // Snipe-IT's catch-all 404; one where GET /hardware/{id} holds the path answers 405 instead.
    await expect(createSnipeIt(config, fakeFetch({}).fetch).labelPdf(['NOMMA-004812'])).resolves.toBeNull()
    const notAllowed = { status: 405, body: { status: 'error', messages: 'Method not allowed', payload: null } }
    await expect(createSnipeIt(config, fakeFetch({ 'POST /hardware/labels': notAllowed }).fetch).labelPdf(['NOMMA-004812'])).resolves.toBeNull()
  })

  it("is null when Snipe-IT can't make Labels over the API (legacy label settings)", async () => {
    const legacy = { status: 500, body: { status: 'error', messages: 'Error while generating labels.', payload: { error_message: 'Enable the New Label Engine to load labels via the API' } } }
    await expect(createSnipeIt(config, fakeFetch({ 'POST /hardware/labels': legacy }).fetch).labelPdf(['NOMMA-004812'])).resolves.toBeNull()
    // Success, but no PDF in it.
    const empty = { body: { status: 'success', messages: '', payload: { pdf: '' } } }
    await expect(createSnipeIt(config, fakeFetch({ 'POST /hardware/labels': empty }).fetch).labelPdf(['NOMMA-004812'])).resolves.toBeNull()
  })

  it('a rejected API key or an unreachable Snipe-IT still says so', async () => {
    const rejected = { status: 401, body: { message: 'Unauthenticated.' } }
    await expect(createSnipeIt(config, fakeFetch({ 'POST /hardware/labels': rejected }).fetch).labelPdf(['NOMMA-004812'])).rejects.toThrow(/rejected your API key/)
    const offline = (async () => { throw new TypeError('fetch failed') }) as typeof globalThis.fetch
    await expect(createSnipeIt(config, offline).labelPdf(['NOMMA-004812'])).rejects.toThrow(/Can't reach Snipe-IT/)
  })
})

describe('Import', () => {
  // Shaped like Snipe-IT's ImportsTransformer: never imported yet, so no type or mapping.
  const upload = {
    id: 12, file_path: '2026-10-01-093015-chromebooks.csv', filesize: '1.2 KB', name: '', import_type: '', created_at: '2 minutes ago',
    header_row: ['Asset Tag', 'Serial', 'Model'], first_row: ['NOMMA-5000', '5CD2381KQX', 'HP Chromebook 14 G7'], field_map: null,
  }
  const file = {
    id: 12, name: '2026-10-01-093015-chromebooks.csv', size: '1.2 KB', uploaded: '2 minutes ago', type: '',
    headers: ['Asset Tag', 'Serial', 'Model'], firstRow: ['NOMMA-5000', '5CD2381KQX', 'HP Chromebook 14 G7'], mapping: {},
  }

  it('lists the CSVs uploaded before, with how each was last imported', async () => {
    const imported = { ...upload, id: 9, import_type: 'user', field_map: { 'First': 'first_name', 'Login': 'username' } }
    const { fetch } = fakeFetch({ '/imports': { body: [upload, imported] } })
    expect(await createSnipeIt(config, fetch).imports()).toEqual([file, { ...file, id: 9, type: 'user', mapping: { First: 'first_name', Login: 'username' } }])
  })

  it("uploads a CSV as Snipe-IT's importer takes it (multipart files[]) and returns it with its headings", async () => {
    const { fetch, requests } = fakeFetch({ 'POST /imports': { body: { files: [upload] } } })
    expect(await createSnipeIt(config, fetch).uploadImport('chromebooks.csv', 'Asset Tag,Serial,Model\r\nNOMMA-5000,5CD2381KQX,HP Chromebook 14 G7\r\n')).toEqual(file)
    expect(requests.map((r) => [r.method, r.path])).toEqual([['POST', '/imports']])
    const sent = (requests[0].body as FormData).get('files[]') as File
    expect(sent.name).toBe('chromebooks.csv')
    expect(await sent.text()).toBe('Asset Tag,Serial,Model\r\nNOMMA-5000,5CD2381KQX,HP Chromebook 14 G7\r\n')
  })

  it("an upload Snipe-IT refuses says why", async () => {
    const refused = { status: 422, body: { status: 'error', messages: "Duplicate header 'Serial' detected, first at column: 2, repeats at column: 3", payload: null } }
    await expect(createSnipeIt(config, fakeFetch({ 'POST /imports': refused }).fetch).uploadImport('x.csv', 'a,Serial,Serial')).rejects.toThrow("Duplicate header 'Serial'")
  })

  it('processes it as the chosen type, with each column matched to a field; unmatched columns are left out', async () => {
    const { fetch, requests } = fakeFetch({ 'POST /imports/process/12': { body: { status: 'success', messages: 'Your file has been imported', payload: null } } })
    const snipeIt = createSnipeIt(config, fetch)
    expect(await snipeIt.processImport(12, 'asset', { 'Asset Tag': 'asset_tag', Model: 'asset_model', Serial: '' }, false)).toEqual({ ok: true })
    // Matching Records are skipped: an older Snipe-IT updates when import-update is sent at all, so it isn't.
    expect(requests[0]).toEqual({ method: 'POST', path: '/imports/process/12', body: { 'import-type': 'asset', 'column-mappings': { 'Asset Tag': 'asset_tag', Model: 'asset_model' } } })
    await snipeIt.processImport(12, 'user', { First: 'first_name' }, true)
    expect(requests[1].body).toEqual({ 'import-type': 'user', 'import-update': true, 'column-mappings': { First: 'first_name' } })
  })

  it("passes on Snipe-IT's errors for each row that failed, as it sent them", async () => {
    const messages = {
      'CB-LIB-099': { asset: { asset_tag: ['The asset tag must be unique.'] } },
      'NOMMA-5001': { asset_model: { asset_model: ['Asset Model is required.'] } },
    }
    const failed = { status: 500, body: { status: 'import-errors', messages, payload: null } }
    expect(await createSnipeIt(config, fakeFetch({ 'POST /imports/process/12': failed }).fetch).processImport(12, 'asset', {}, false)).toEqual({ ok: false, errors: messages })
  })

  it("any other refusal is one message, not rows", async () => {
    const invalid = { status: 422, body: { status: 'error', messages: { 'import-type': ['The import-type field is required.'] }, payload: null } }
    await expect(createSnipeIt(config, fakeFetch({ 'POST /imports/process/12': invalid }).fetch).processImport(12, 'asset', {}, false)).rejects.toThrow('The import-type field is required.')
    const busy = { status: 409, body: { status: 'error', messages: 'This import is already being processed.', payload: null } }
    await expect(createSnipeIt(config, fakeFetch({ 'POST /imports/process/12': busy }).fetch).processImport(12, 'asset', {}, false)).rejects.toThrow('already being processed')
  })

  it("refuses an unknown import type, a field the type doesn't have, or a bad id, without asking Snipe-IT", async () => {
    const { fetch, requests } = fakeFetch({})
    const snipeIt = createSnipeIt(config, fetch)
    await expect(snipeIt.processImport(12, 'assetHistory' as 'asset', {}, false)).rejects.toThrow('Unknown import type')
    await expect(snipeIt.processImport(12, 'location', { Name: 'asset_tag' }, false)).rejects.toThrow('Invalid field: asset_tag')
    await expect(snipeIt.processImport(1.5, 'asset', {}, false)).rejects.toThrow('Invalid import id')
    await expect(snipeIt.deleteImport(NaN)).rejects.toThrow('Invalid import id')
    await expect(snipeIt.uploadImport('x.csv', 7 as unknown as string)).rejects.toThrow('Invalid CSV')
    expect(requests).toEqual([])
  })

  it("deletes an upload; one Snipe-IT won't delete (another Operator's) says why", async () => {
    const { fetch, requests } = fakeFetch({ 'DELETE /imports/12': { body: { status: 'success', messages: 'File successfully deleted', payload: null } } })
    await createSnipeIt(config, fetch).deleteImport(12)
    expect(requests.map((r) => [r.method, r.path])).toEqual([['DELETE', '/imports/12']])
    const warning = { body: { status: 'warning', messages: 'File could not be deleted.', payload: null } }
    await expect(createSnipeIt(config, fakeFetch({ 'DELETE /imports/12': warning }).fetch).deleteImport(12)).rejects.toThrow('File could not be deleted.')
  })

  it("only an account with Snipe-IT's import permission can import", async () => {
    expect(await createSnipeIt(config, fakeFetch({ '/imports': { body: [] } }).fetch).canImport()).toBe(true)
    const operator = fakeFetch({ '/imports': { status: 403, body: { status: 'error', messages: 'You do not have permission to access this area.' } } })
    expect(await createSnipeIt(config, operator.fetch).canImport()).toBe(false)
  })
})
