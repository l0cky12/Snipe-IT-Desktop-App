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
}

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

  it('an unknown Asset Tag is not an exact match', async () => {
    const { fetch } = fakeFetch({})
    const result = await createSnipeIt(config, fetch).lookup('NOPE-1')
    expect(result).toEqual({ exact: false, assets: [] })
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
    const { fetch } = fakeFetch({ '/hardware/4812': { body: chromebook } })
    const asset = await createSnipeIt(config, fetch).getAsset(4812)
    expect(asset).toEqual({
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
    })
  })

  it('an Asset in inventory has no Assignee and missing dates are null', async () => {
    const inStorage = { ...chromebook, assigned_to: null, purchase_date: null, warranty_expires: null, location: null }
    const { fetch } = fakeFetch({ '/hardware/4812': { body: inStorage } })
    const asset = await createSnipeIt(config, fetch).getAsset(4812)
    expect(asset).toMatchObject({ assignee: null, purchaseDate: null, warrantyEnd: null, location: '' })
  })

  it("a 200 with status error is thrown as Snipe-IT's message", async () => {
    const denied = { status: 'error', messages: 'You do not have permission.', payload: null }
    const { fetch } = fakeFetch({ '/hardware/4812': { body: denied } })
    await expect(createSnipeIt(config, fetch).getAsset(4812)).rejects.toThrow('You do not have permission.')
  })
})
