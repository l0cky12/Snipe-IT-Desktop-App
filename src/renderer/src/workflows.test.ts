import { describe, expect, it, vi } from 'vitest'
import type { Asset, CheckinOptions, StatusLabel } from '../../main/snipeit'
import { cleanTag, createBulkReturn, createRunner, NOT_ALLOWED } from './workflows'

// A fake Snipe-IT behind the Workflow bridge: fictional Assets, and every call recorded.
const asset = (tag: string, more: Partial<Asset> = {}): Asset => ({
  id: Number(tag.replace(/\D/g, '')), assetTag: tag, name: `CB-${tag.slice(-3)}`, model: 'HP Chromebook 14 G7', status: 'Deployed', statusId: 2, statusMeta: 'deployed', statusType: 'deployable',
  assignee: { type: 'user', id: 7, name: 'Avery Testwell' }, checkoutAllowed: false, location: 'Library', category: 'Chromebook', serial: '', purchaseDate: null,
  warrantyEnd: null, expectedCheckin: null, overdueDays: null, warranty: null, can: { checkout: true, checkin: true, update: true, delete: true }, ...more,
})
const flush = () => new Promise((r) => setTimeout(r, 0))
const ITOFFICE: StatusLabel = { id: 8, name: 'IT Office' }
const ROOM204: StatusLabel = { id: 4, name: 'Room 204' }
const LABELS: StatusLabel[] = [{ id: 1, name: 'Ready to Deploy' }, { id: 2, name: 'Deployed' }, { id: 5, name: 'Pending' }]

function fakeBridge(assets: Asset[]) {
  const calls: string[] = []
  const checkins: [number, CheckinOptions][] = []
  const bridge = {
    assetByTag: vi.fn(async (tag: string) => (calls.push(`bytag ${tag}`), assets.find((a) => a.assetTag === tag) ?? null)),
    checkin: vi.fn(async (id: number, o: CheckinOptions) => { calls.push(`checkin ${id}`); checkins.push([id, o]) }),
    statusLabels: vi.fn(async () => (calls.push('statusLabels'), LABELS)),
  }
  return { bridge, calls, checkins }
}

describe('Workflow runner', () => {
  it('queues scans and runs them one at a time, in order; the newest row is first', async () => {
    let open = 0, most = 0
    const done: string[] = []
    const { bridge } = fakeBridge([asset('NOMMA-1'), asset('NOMMA-2'), asset('NOMMA-3')])
    const runner = createRunner<null>(bridge, async (a) => {
      most = Math.max(most, ++open)
      await flush()
      open--
      done.push(a.assetTag)
      return { text: 'Done' }
    }, { changed: () => {} }, undefined, 0)
    for (const tag of ['NOMMA-1', 'NOMMA-2', 'NOMMA-3']) expect(runner.scan(tag, null)).toBe('')
    expect(runner.rows.map((r) => [r.tag, r.result.state])).toEqual([['NOMMA-3', 'waiting'], ['NOMMA-2', 'waiting'], ['NOMMA-1', 'working']])
    expect(runner.pending).toBe(3)
    await vi.waitFor(() => expect(runner.pending).toBe(0))
    expect(done).toEqual(['NOMMA-1', 'NOMMA-2', 'NOMMA-3'])
    expect(most).toBe(1)
    expect(runner.rows[0]).toMatchObject({ tag: 'NOMMA-3', name: 'CB-A-3', result: { state: 'done', text: 'Done' } })
  })

  it("paces queued Assets so a fast scanner stays inside Snipe-IT's request limit", async () => {
    const starts: number[] = []
    const { bridge } = fakeBridge([asset('NOMMA-1'), asset('NOMMA-2'), asset('NOMMA-3')])
    const runner = createRunner<null>(bridge, async () => (starts.push(Date.now()), { text: 'Done' }), { changed: () => {} }, undefined, 40)
    for (const tag of ['NOMMA-1', 'NOMMA-2', 'NOMMA-3']) runner.scan(tag, null)
    await vi.waitFor(() => expect(runner.pending).toBe(0))
    expect(starts[1] - starts[0]).toBeGreaterThanOrEqual(35)
    expect(starts[2] - starts[1]).toBeGreaterThanOrEqual(35)
  })

  it("a tag already waiting or working is a double read: ignored, with \"X is already scanned\"", async () => {
    const { bridge } = fakeBridge([asset('NOMMA-1')])
    const runner = createRunner<null>(bridge, async () => ({ text: 'Done' }), { changed: () => {} }, undefined, 0)
    runner.scan('NOMMA-1', null)
    expect(runner.scan(' nomma-1\r', null)).toBe('NOMMA-1 is already scanned')
    expect(runner.rows).toHaveLength(1)
    await vi.waitFor(() => expect(runner.pending).toBe(0))
    // Once it's done, scanning it again is a new scan.
    expect(runner.scan('NOMMA-1', null)).toBe('')
    expect(runner.rows).toHaveLength(2)
  })

  it('an unknown tag, or a refusal or failure, is a red row with its reason and the error sound; the next scan still runs', async () => {
    const failed = vi.fn()
    const { bridge, calls } = fakeBridge([asset('NOMMA-2'), asset('NOMMA-3')])
    const runner = createRunner<null>(bridge, async (a) => {
      if (a.assetTag === 'NOMMA-2') throw new Error('Snipe-IT said no')
      return { text: 'Done', what: 'From Avery Testwell' }
    }, { changed: () => {}, failed }, undefined, 0)
    runner.scan('NOMMA-9', null)
    runner.scan('NOMMA-2', null)
    runner.scan('NOMMA-3', null)
    await vi.waitFor(() => expect(runner.pending).toBe(0))
    expect(runner.rows.map((r) => r.result)).toEqual([
      { state: 'done', text: 'Done' }, { state: 'failed', reason: 'Snipe-IT said no' }, { state: 'failed', reason: 'No Asset with tag NOMMA-9' },
    ])
    expect(runner.rows[0].what).toBe('From Avery Testwell')
    expect(calls).toEqual(['bytag NOMMA-9', 'bytag NOMMA-2', 'bytag NOMMA-3'])
    expect(failed).toHaveBeenCalledTimes(2)
    expect(runner.announce).toBe('NOMMA-3: Done')
  })

  it('strips whitespace and control characters a scanner adds, and ignores an empty scan', () => {
    expect(cleanTag('\u0002 NOMMA-1\t\r\n')).toBe('NOMMA-1')
    const { bridge } = fakeBridge([])
    const runner = createRunner<null>(bridge, async () => ({ text: 'Done' }), { changed: () => {} }, undefined, 0)
    expect(runner.scan(' \r\n', null)).toBe('')
    expect(runner.rows).toEqual([])
  })

  it('Clear empties the Running list only when nothing is waiting or working', async () => {
    const { bridge } = fakeBridge([asset('NOMMA-1')])
    const runner = createRunner<null>(bridge, async () => ({ text: 'Done' }), { changed: () => {} }, undefined, 0)
    runner.scan('NOMMA-1', null)
    runner.clear()
    expect(runner.rows).toHaveLength(1)
    await vi.waitFor(() => expect(runner.pending).toBe(0))
    runner.clear()
    expect(runner.rows).toEqual([])
  })

  it('reset (Settings pointing at another server) drops the queue, and a result still in flight never lands', async () => {
    let release = () => {}
    const { bridge } = fakeBridge([asset('NOMMA-1'), asset('NOMMA-2')])
    const act = vi.fn(() => new Promise<{ text: string }>((r) => { release = () => r({ text: 'Done' }) }))
    const runner = createRunner<null>(bridge, act, { changed: () => {} }, undefined, 0)
    runner.scan('NOMMA-1', null)
    runner.scan('NOMMA-2', null)
    await vi.waitFor(() => expect(act).toHaveBeenCalledTimes(1))
    runner.reset()
    release()
    await flush()
    expect(runner.rows).toEqual([])
    expect(act).toHaveBeenCalledTimes(1)
  })
})

describe('Bulk return', () => {
  async function started(assets: Asset[], location = ITOFFICE) {
    const fake = fakeBridge(assets)
    const flow = createBulkReturn(fake.bridge, { changed: () => {} }, undefined, 0)
    expect(await flow.start(location)).toBe('')
    return { ...fake, flow }
  }

  it("checks each scanned Asset in at once with the session's Location, Ready to Deploy and the [Bulk return] note", async () => {
    const { flow, checkins } = await started([asset('NOMMA-1'), asset('NOMMA-2', { assignee: { type: 'location', id: 4, name: 'Room 204' } })])
    expect(flow.step).toEqual({ step: 'scan', location: ITOFFICE })
    flow.scan('NOMMA-1')
    flow.scan('NOMMA-2')
    await vi.waitFor(() => expect(flow.runner.pending).toBe(0))
    expect(checkins).toEqual([[1, { statusId: 1, locationId: 8, note: '[Bulk return]' }], [2, { statusId: 1, locationId: 8, note: '[Bulk return]' }]])
    expect(flow.runner.rows.map((r) => [r.what, r.result])).toEqual([
      ['From Room 204', { state: 'done', text: 'Checked in' }], ['From Avery Testwell', { state: 'done', text: 'Checked in' }],
    ])
  })

  it("keeps a Status Label that isn't deployable, and flags the row", async () => {
    const { flow, checkins } = await started([asset('NOMMA-1', { status: 'Pending', statusId: 5, statusType: 'pending' })])
    flow.scan('NOMMA-1')
    await vi.waitFor(() => expect(flow.runner.pending).toBe(0))
    expect(checkins).toEqual([[1, { statusId: undefined, locationId: 8, note: '[Bulk return]' }]])
    expect(flow.runner.rows[0].result).toEqual({ state: 'done', text: "Kept status 'Pending'" })
  })

  it("refuses an Asset that isn't checked out, or that the key can't check in, and changes nothing", async () => {
    const { flow, checkins } = await started([
      asset('NOMMA-1', { assignee: null, status: 'Broken', statusMeta: 'undeployable', statusType: 'undeployable' }), asset('NOMMA-2', { can: { checkout: true, checkin: false, update: true, delete: true } }),
    ])
    flow.scan('NOMMA-1')
    flow.scan('NOMMA-2')
    flow.scan('NOMMA-3')
    await vi.waitFor(() => expect(flow.runner.pending).toBe(0))
    expect(checkins).toEqual([])
    expect(flow.runner.rows.map((r) => r.result)).toEqual([
      { state: 'failed', reason: 'No Asset with tag NOMMA-3' }, { state: 'failed', reason: NOT_ALLOWED },
      { state: 'failed', reason: "NOMMA-1 isn't checked out (status: Broken). Nothing changed." },
    ])
  })

  it('an Asset this session already checked in says when', async () => {
    const one = asset('NOMMA-1')
    const fake = fakeBridge([one])
    fake.bridge.checkin.mockImplementation(async () => { one.assignee = null })
    const flow = createBulkReturn(fake.bridge, { changed: () => {} }, () => new Date(2026, 9, 10, 10, 42), 0)
    await flow.start(ITOFFICE)
    flow.scan('NOMMA-1')
    await vi.waitFor(() => expect(flow.runner.pending).toBe(0))
    flow.scan('NOMMA-1')
    await vi.waitFor(() => expect(flow.runner.pending).toBe(0))
    expect(flow.runner.rows[0].result).toEqual({ state: 'failed', reason: 'Already checked in at 10:42' })
  })

  it('a scan keeps the Location it was made under, even after Change Location', async () => {
    const { flow, checkins } = await started([asset('NOMMA-1'), asset('NOMMA-2')])
    flow.scan('NOMMA-1')
    flow.done()
    expect(flow.scan('NOMMA-2')).toBe('Pick the Location first')
    await flow.start(ROOM204)
    flow.scan('NOMMA-2')
    await vi.waitFor(() => expect(flow.runner.pending).toBe(0))
    expect(checkins.map(([id, o]) => [id, o.locationId])).toEqual([[1, 8], [2, 4]])
    expect(flow.runner.rows.map((r) => r.ctx.name)).toEqual(['Room 204', 'IT Office'])
  })

  it('finds "Ready to Deploy" once per session, and won\'t start step 2 without it', async () => {
    const { flow, calls } = await started([])
    flow.done()
    await flow.start(ITOFFICE)
    expect(calls.filter((c) => c === 'statusLabels')).toHaveLength(1)

    const fake = fakeBridge([])
    fake.bridge.statusLabels.mockResolvedValue([{ id: 2, name: 'Deployed' }, { id: 9, name: 'Ready to deploy (old)' }])
    const missing = createBulkReturn(fake.bridge, { changed: () => {} }, undefined, 0)
    expect(await missing.start(ITOFFICE)).toBe("No Status Label named 'Ready to Deploy' in Snipe-IT")
    expect(missing.step).toEqual({ step: 'location' })
  })

  it('only the newest Location pick lands, and none after Done, while "Ready to Deploy" is still being found', async () => {
    const fake = fakeBridge([])
    let answer = (_: StatusLabel[]) => {}
    fake.bridge.statusLabels.mockImplementation(() => new Promise((r) => { answer = r }))
    const flow = createBulkReturn(fake.bridge, { changed: () => {} }, undefined, 0)
    const first = flow.start(ITOFFICE)
    const firstAnswer = answer
    const second = flow.start(ROOM204)
    answer(LABELS)
    await second
    firstAnswer(LABELS)
    await first
    expect(flow.step).toEqual({ step: 'scan', location: ROOM204 })

    flow.done()
    const again = createBulkReturn(fake.bridge, { changed: () => {} }, undefined, 0)
    const pending = again.start(ITOFFICE)
    again.done()
    answer(LABELS)
    await pending
    expect(again.step).toEqual({ step: 'location' })
  })

  it('Done goes back to picking a Location, keeps the Running list, and remembers the last Location', async () => {
    const { flow } = await started([asset('NOMMA-1')])
    flow.scan('NOMMA-1')
    await vi.waitFor(() => expect(flow.runner.pending).toBe(0))
    flow.done()
    expect(flow.step).toEqual({ step: 'location' })
    expect(flow.last).toEqual(ITOFFICE)
    expect(flow.runner.rows).toHaveLength(1)
    flow.reset()
    expect(flow.last).toBeNull()
    expect(flow.runner.rows).toEqual([])
  })
})
