import { describe, expect, it, vi } from 'vitest'
import { createSnipeIt, type CheckoutOptions } from './snipeit'

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
  expected_checkin: { date: '2026-09-15', formatted: '09/15/2026' },
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
const snipeItWith = (hardware: object, history: { status?: number; body: unknown } = { body: { total: 0, rows: [] } }) =>
  createSnipeIt(config, fakeFetch({ '/hardware/4812': { body: hardware }, '/reports/activity': history }).fetch, today)

const notFound = { status: 'error', messages: 'Asset does not exist.', payload: null }

// A fake fetch that answers from a path → JSON map and records the paths it was asked for,
// plus every request as Snipe-IT would receive it (method, path, parsed JSON body).
type FakeRequest = { method: string; path: string; body: unknown }
function fakeFetch(routes: Record<string, { status?: number; body: unknown }>) {
  const calls: string[] = []
  const requests: FakeRequest[] = []
  const fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const path = new URL(String(input)).pathname.replace('/api/v1', '')
    calls.push(path)
    requests.push({ method: init?.method ?? 'GET', path, body: init?.body ? JSON.parse(String(init.body)) : undefined })
    const route = routes[path] ?? { status: 404, body: notFound }
    return new Response(JSON.stringify(route.body), { status: route.status ?? 200 })
  }
  return { fetch: fetch as typeof globalThis.fetch, calls, requests }
}

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
        assignee: { type: 'user', id: 311, name: 'Jordan Reyes' },
      },
    ])
  })

  it('nothing matching the tag or the text search finds no Assets', async () => {
    const { fetch } = fakeFetch({ '/hardware': { body: { total: 0, rows: [] } } })
    const result = await createSnipeIt(config, fetch).lookup('NOPE-1')
    expect(result).toEqual({ exact: false, assets: [] })
  })

  it("a text search Snipe-IT rejects is thrown as Snipe-IT's message", async () => {
    const denied = { status: 'error', messages: 'You do not have permission.', payload: null }
    const { fetch } = fakeFetch({ '/hardware': { body: denied } })
    await expect(createSnipeIt(config, fetch).lookup('cb-lib')).rejects.toThrow('You do not have permission.')
  })

  it('a blank query finds nothing without asking Snipe-IT', async () => {
    const { fetch, calls } = fakeFetch({})
    const result = await createSnipeIt(config, fetch).lookup('   ')
    expect(result).toEqual({ exact: false, assets: [] })
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
    await expect(error).rejects.toThrow(/generate a new personal API key/)
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

  it("field-by-field messages from Snipe-IT are joined into one readable reason", async () => {
    const invalid = { status: 'error', messages: { asset_tag: ['The asset tag field is required.'], name: ['Too long.'] } }
    const { fetch } = fakeFetch({ '/hardware': { body: invalid } })
    await expect(createSnipeIt(config, fetch).lookup('cb')).rejects.toThrow('The asset tag field is required. Too long.')
  })
})

describe('Overdue (today is 2026-09-24)', () => {
  it('an Asset whose Expected Checkin was yesterday is Overdue by 1 day', async () => {
    const asset = await snipeItWith({ ...chromebook, expected_checkin: { date: '2026-09-23' } }).getAsset(4812)
    expect(asset.overdueDays).toBe(1)
  })

  it('an Asset due back today is not Overdue', async () => {
    const asset = await snipeItWith({ ...chromebook, expected_checkin: { date: '2026-09-24' } }).getAsset(4812)
    expect(asset.overdueDays).toBeNull()
  })

  it('an Asset without an Expected Checkin is never Overdue', async () => {
    const asset = await snipeItWith({ ...chromebook, expected_checkin: null }).getAsset(4812)
    expect(asset.overdueDays).toBeNull()
  })

  it('an Asset with no Assignee is not Overdue even with a past Expected Checkin', async () => {
    const asset = await snipeItWith({ ...chromebook, assigned_to: null }).getAsset(4812)
    expect(asset.overdueDays).toBeNull()
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
    fakeFetch({ '/hardware/4812': { body: hardware }, '/hardware/4812/checkin': reply })
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

  it("a Checkin Snipe-IT rejects is thrown as Snipe-IT's reason", async () => {
    const refused = { status: 'error', messages: 'That asset is already checked in.', payload: null }
    const { fetch } = checkinWith(chromebook, { body: refused })
    await expect(createSnipeIt(config, fetch).checkin(4812, {})).rejects.toThrow('That asset is already checked in.')
  })
})

describe('Checkout targets', () => {
  it('searching Users returns each User by id and name, with their username to tell namesakes apart', async () => {
    const users = { total: 1, rows: [{ id: 311, name: 'Jordan Reyes', first_name: 'Jordan', last_name: 'Reyes', username: 'jreyes' }] }
    const { fetch } = fakeFetch({ '/users': { body: users } })
    expect(await createSnipeIt(config, fetch).searchUsers('reyes')).toEqual([{ id: 311, name: 'Jordan Reyes', detail: 'jreyes' }])
  })

  it('searching Locations returns each Location by id and name', async () => {
    const locations = { total: 1, rows: [{ id: 12, name: 'Room 204', address: null }] }
    const { fetch } = fakeFetch({ '/locations': { body: locations } })
    expect(await createSnipeIt(config, fetch).searchLocations(' 204 ')).toEqual([{ id: 12, name: 'Room 204', detail: '' }])
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
    fakeFetch({ '/hardware/4812': { body: hardware }, '/hardware/4812/checkout': reply })
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

  it('Checkout to another Asset is refused', async () => {
    const { fetch, requests } = checkoutWith(ready)
    const toAsset = { targetType: 'asset', targetId: 77 } as unknown as CheckoutOptions
    await expect(createSnipeIt(config, fetch).checkout(4812, toAsset)).rejects.toThrow(/User or a Location/)
    expect(posted(requests)).toEqual([])
  })

  it("a Checkout Snipe-IT rejects is thrown as Snipe-IT's reason", async () => {
    const refused = { status: 'error', messages: { assigned_user: ['The selected assigned user is invalid.'] }, payload: null }
    const { fetch } = checkoutWith(ready, { body: refused })
    await expect(createSnipeIt(config, fetch).checkout(4812, { targetType: 'user', targetId: 999 })).rejects.toThrow(
      'The selected assigned user is invalid.',
    )
  })
})

describe('dashboard (today is 2026-09-24)', () => {
  // A fake /hardware that pages through `assets` by limit/offset, like Snipe-IT; records each page's offset.
  function fleet(assets: object[], pageMax = 500) {
    const offsets: number[] = []
    const fetch = (async (input: string | URL | Request) => {
      const url = new URL(String(input))
      if (url.pathname !== '/api/v1/hardware') return new Response(JSON.stringify(notFound), { status: 404 })
      const limit = Math.min(Number(url.searchParams.get('limit') ?? 50), pageMax)
      const offset = Number(url.searchParams.get('offset') ?? 0)
      offsets.push(offset)
      return new Response(JSON.stringify({ total: assets.length, rows: assets.slice(offset, offset + limit) }))
    }) as typeof globalThis.fetch
    return { snipeIt: createSnipeIt(config, fetch, today), offsets }
  }
  const asset = (id: number, fields: object = {}) => ({
    ...chromebook, id, asset_tag: `NOMMA-${id}`, expected_checkin: null, warranty_expires: null, ...fields,
  })
  const ready = { id: 1, name: 'Ready to Deploy', status_meta: 'deployable' }
  const repair = { id: 3, name: 'Out for Repair', status_meta: 'undeployable' }

  it('pages through every Asset, 500 at a time', async () => {
    const assets = Array.from({ length: 1234 }, (_, i) => asset(i + 1))
    const { snipeIt, offsets } = fleet(assets)
    const { counts } = await snipeIt.dashboard()
    expect(offsets).toEqual([0, 500, 1000])
    expect(counts).toEqual([{ status: 'Deployed', statusMeta: 'deployed', count: 1234 }])
  })

  it('still gets every Asset when the server caps pages below 500', async () => {
    const { snipeIt, offsets } = fleet(Array.from({ length: 250 }, (_, i) => asset(i + 1)), 100)
    const { counts } = await snipeIt.dashboard()
    expect(offsets).toEqual([0, 100, 200])
    expect(counts[0].count).toBe(250)
  })

  it('counts Assets by status, most first', async () => {
    const { snipeIt } = fleet([
      asset(1), asset(2, { status_label: ready, assigned_to: null }), asset(3),
      asset(4, { status_label: repair, assigned_to: null }), asset(5, { status_label: ready, assigned_to: null }), asset(6),
    ])
    expect((await snipeIt.dashboard()).counts).toEqual([
      { status: 'Deployed', statusMeta: 'deployed', count: 3 },
      { status: 'Ready to Deploy', statusMeta: 'deployable', count: 2 },
      { status: 'Out for Repair', statusMeta: 'undeployable', count: 1 },
    ])
  })

  it('lists every Overdue Asset with its Assignee and days late, most late first', async () => {
    const { snipeIt } = fleet([
      asset(1, { expected_checkin: { date: '2026-09-23' } }),
      asset(2, { expected_checkin: { date: '2026-09-24' } }), // due today: not Overdue
      asset(3, { expected_checkin: { date: '2026-09-01' } }),
      asset(4, { expected_checkin: { date: '2026-09-01' }, assigned_to: null }), // no Assignee: not Overdue
      asset(5), // no Expected Checkin: never Overdue
    ])
    const { overdue } = await snipeIt.dashboard()
    expect(overdue.map((a) => [a.assetTag, a.overdueDays])).toEqual([['NOMMA-3', 23], ['NOMMA-1', 1]])
    expect(overdue[0]).toMatchObject({ id: 3, name: 'CB-LIB-012', assignee: { type: 'user', id: 311, name: 'Jordan Reyes' } })
  })

  it('lists Expiring Warranties in the next 90 days, soonest first, leaving out expired ones', async () => {
    const { snipeIt } = fleet([
      asset(1, { warranty_expires: { date: '2026-12-23' } }), // 90 days
      asset(2, { warranty_expires: { date: '2026-12-24' } }), // 91 days: not Expiring
      asset(3, { warranty_expires: { date: '2026-09-24' } }), // today
      asset(4, { warranty_expires: { date: '2026-09-23' } }), // expired
      asset(5, { warranty_expires: { date: '2026-10-01' } }),
    ])
    const { expiring } = await snipeIt.dashboard()
    expect(expiring.map((a) => [a.assetTag, a.daysLeft])).toEqual([['NOMMA-3', 0], ['NOMMA-5', 7], ['NOMMA-1', 90]])
  })

  it("an Asset list Snipe-IT refuses is thrown as Snipe-IT's message", async () => {
    const denied = { status: 'error', messages: 'You do not have permission.', payload: null }
    const { fetch } = fakeFetch({ '/hardware': { body: denied } })
    await expect(createSnipeIt(config, fetch).dashboard()).rejects.toThrow('You do not have permission.')
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

it('sends the selected Checkin Location to Snipe-IT', async () => {
  const { fetch, requests } = fakeFetch({ '/hardware/4812': { body: chromebook }, '/hardware/4812/checkin': { body: { status: 'success' } } })
  await createSnipeIt(config, fetch).checkin(4812, { locationId: 9 })
  expect(requests.at(-1)?.body).toEqual({ status_id: 2, location_id: 9 })
})

it('loads every page of Locations for the default dropdown', async () => {
  const fetch = vi.fn(async (url: string | URL | Request) => new Response(JSON.stringify({ total: 2, rows: String(url).includes('offset=0') ? [{ id: 1, name: 'Library' }] : [{ id: 2, name: 'Office' }] })))
  expect(await createSnipeIt(config, fetch).locations()).toEqual([{ id: 1, name: 'Library' }, { id: 2, name: 'Office' }])
  expect(fetch).toHaveBeenCalledTimes(2)
})
