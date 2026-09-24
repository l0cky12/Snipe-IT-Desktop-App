import { describe, expect, it } from 'vitest'
import { createSnipeIt } from './snipeit'

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

// A fake fetch that answers from a path → JSON map and records the paths it was asked for.
function fakeFetch(routes: Record<string, { status?: number; body: unknown }>) {
  const calls: string[] = []
  const fetch = async (input: string | URL | Request) => {
    const path = new URL(String(input)).pathname.replace('/api/v1', '')
    calls.push(path)
    const route = routes[path] ?? { status: 404, body: notFound }
    return new Response(JSON.stringify(route.body), { status: route.status ?? 200 })
  }
  return { fetch: fetch as typeof globalThis.fetch, calls }
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
    expect(asset.historyError).toBe('Snipe-IT returned HTTP 403')
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
