import { describe, expect, it, vi } from 'vitest'
import type { Asset, CheckinOptions, CheckoutOptions, StatusLabel } from '../../main/snipeit'
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
  const checkouts: [number, CheckoutOptions][] = []
  const bridge = {
    assetByTag: vi.fn(async (tag: string) => (calls.push(`bytag ${tag}`), assets.find((a) => a.assetTag === tag) ?? null)),
    checkin: vi.fn(async (id: number, o: CheckinOptions) => { calls.push(`checkin ${id}`); checkins.push([id, o]) }),
    checkout: vi.fn(async (id: number, o: CheckoutOptions) => { calls.push(`checkout ${id}`); checkouts.push([id, o]) }),
    statusLabels: vi.fn(async () => (calls.push('statusLabels'), LABELS)),
  }
  return { bridge, calls, checkins, checkouts }
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

describe('Undo last', () => {
  // A Workflow whose step does nothing, and whose undo records the Asset it re-read (or throws what it found).
  function undoable(assets: Asset[], refuse?: (now: Asset) => string) {
    const fake = fakeBridge(assets)
    const undone: Asset[] = []
    const failed = vi.fn()
    const runner = createRunner<null>(fake.bridge, async (a) => {
      if (a.assetTag === 'NOMMA-9') throw new Error('Snipe-IT said no')
      return {
        text: 'Done',
        undo: { says: `${a.assetTag} done`, run: async (now: Asset) => { if (refuse?.(now)) throw new Error(refuse(now)); undone.push(now) } },
      }
    }, { changed: () => {}, failed }, undefined, 0)
    return { ...fake, runner, undone, failed }
  }
  const settled = async (runner: { pending: number }) => vi.waitFor(() => expect(runner.pending).toBe(0))

  it('each row records the Asset as the lookup found it', async () => {
    const one = asset('NOMMA-1', { expectedCheckin: '2026-10-09 14:50', overdueDays: 1 })
    const { runner } = undoable([one])
    runner.scan('NOMMA-1', null)
    await settled(runner)
    expect(runner.rows[0].before).toEqual(one)
  })

  it('acts on the newest done row only, only after its confirm, and only once', async () => {
    const { runner, undone, calls } = undoable([asset('NOMMA-1'), asset('NOMMA-2'), asset('NOMMA-9')])
    expect(runner.askUndo()).toBe('Nothing to undo')
    for (const tag of ['NOMMA-1', 'NOMMA-2', 'NOMMA-9']) runner.scan(tag, null)
    await settled(runner)
    expect(runner.confirm).toBeNull()
    // A refused row after it doesn't stop NOMMA-2 being the newest done row.
    expect(runner.askUndo()).toBe('')
    expect(runner.confirm).toBe('Undo: NOMMA-2 done? Enter to undo, Esc to cancel.')
    expect(undone).toEqual([])
    await runner.undo()
    expect(calls.slice(-1)).toEqual(['bytag NOMMA-2'])
    expect(undone.map((a) => a.assetTag)).toEqual(['NOMMA-2'])
    expect(runner.rows.map((r) => [r.tag, r.result.state])).toEqual([['NOMMA-9', 'failed'], ['NOMMA-2', 'undone'], ['NOMMA-1', 'done']])
    expect(runner.confirm).toBeNull()
    // Not a stack: NOMMA-1 can't be undone from the list now.
    expect(runner.askUndo()).toBe('Nothing to undo')
    await runner.undo()
    expect(undone).toHaveLength(1)
  })

  it('Esc cancels the confirm and nothing is written', async () => {
    const { runner, undone } = undoable([asset('NOMMA-1')])
    runner.scan('NOMMA-1', null)
    await settled(runner)
    runner.askUndo()
    expect(runner.undoBlocked).toBe('Undo is waiting for Enter or Esc')
    runner.cancelUndo()
    expect(runner.confirm).toBeNull()
    await runner.undo()
    expect(undone).toEqual([])
    expect(runner.rows[0].result.state).toBe('done')
  })

  it("is off while anything is waiting or working, and a scan closes an open confirm", async () => {
    const { runner, undone } = undoable([asset('NOMMA-1'), asset('NOMMA-2')])
    runner.scan('NOMMA-1', null)
    expect(runner.askUndo()).toBe('Undo waits until nothing is waiting or working')
    await settled(runner)
    runner.askUndo()
    runner.scan('NOMMA-2', null)
    expect(runner.confirm).toBeNull()
    await runner.undo()
    expect(undone).toEqual([])
    await settled(runner)
    expect(runner.rows.map((r) => r.result.state)).toEqual(['done', 'done'])
  })

  it('refuses an Asset that is no longer as the Workflow left it, says what it found, and keeps the row done', async () => {
    const { runner, undone, failed } = undoable([asset('NOMMA-1')], (now) => `${now.assetTag} is checked out to ${now.assignee!.name} now`)
    runner.scan('NOMMA-1', null)
    await settled(runner)
    runner.askUndo()
    await runner.undo()
    expect(undone).toEqual([])
    expect(runner.rows[0]).toMatchObject({ result: { state: 'done', text: 'Done' }, undoFailed: 'NOMMA-1 is checked out to Avery Testwell now' })
    expect(failed).toHaveBeenCalledTimes(1)
    expect(runner.announce).toBe('NOMMA-1: NOMMA-1 is checked out to Avery Testwell now')
  })

  it('a scan made while an undo is in flight waits for it', async () => {
    const order: string[] = []
    let release = () => {}
    const { bridge } = fakeBridge([asset('NOMMA-1'), asset('NOMMA-2')])
    const runner = createRunner<null>(bridge, async (a) => (order.push(`act ${a.assetTag}`), {
      text: 'Done', undo: { says: '', run: () => new Promise<void>((r) => { release = () => (order.push('undo'), r()) }) },
    }), { changed: () => {} }, undefined, 0)
    runner.scan('NOMMA-1', null)
    await settled(runner)
    runner.askUndo()
    const undoing = runner.undo()
    await vi.waitFor(() => expect(bridge.assetByTag).toHaveBeenCalledTimes(2))
    expect(runner.clearBlocked).toBe('Waits until nothing is waiting or working')
    runner.scan('NOMMA-2', null)
    await flush()
    expect(order).toEqual(['act NOMMA-1'])
    release()
    await undoing
    await settled(runner)
    expect(order).toEqual(['act NOMMA-1', 'undo', 'act NOMMA-2'])
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

  describe('Undo last', () => {
    const ZOE = { type: 'user' as const, id: 7, name: 'Avery Testwell' }
    async function returned(one: Asset) {
      const fake = await started([one])
      fake.bridge.checkin.mockImplementation(async () => { one.assignee = null })
      fake.flow.scan(one.assetTag)
      await vi.waitFor(() => expect(fake.flow.runner.pending).toBe(0))
      expect(fake.flow.runner.askUndo()).toBe('')
      return fake
    }

    it.each([
      ['a User', ZOE],
      ['a Location', { type: 'location' as const, id: 4, name: 'Room 204' }],
      ['an Asset', { type: 'asset' as const, id: 77, name: 'Cart 3' }],
    ])('checks the Asset back out to %s with its old Status Label and Expected Checkin, and [Undo] Bulk return', async (_, assignee) => {
      const one = asset('NOMMA-1', { assignee, statusId: 2, expectedCheckin: '2026-10-13' })
      const { flow, checkouts } = await returned(one)
      expect(flow.runner.confirm).toBe(`Undo: NOMMA-1 checked in from ${assignee.type === 'asset' ? 'Asset ' : ''}${assignee.name}? Enter to undo, Esc to cancel.`)
      await flow.runner.undo()
      expect(checkouts).toEqual([[1, { targetType: assignee.type, targetId: assignee.id, statusId: 2, expectedCheckin: '2026-10-13', note: '[Undo] Bulk return' }]])
      expect(flow.runner.rows[0].result.state).toBe('undone')
    })

    it('carries the Temp checkout tag when the Expected Checkin had a time of day', async () => {
      const { flow, checkouts } = await returned(asset('NOMMA-1', { expectedCheckin: '2026-10-13 14:50' }))
      await flow.runner.undo()
      expect(checkouts[0][1]).toMatchObject({ expectedCheckin: '2026-10-13 14:50', note: '[Undo] Bulk return [Temp checkout | due: 2026-10-13 14:50]' })
    })

    it('sends no Expected Checkin when it had none', async () => {
      const { flow, checkouts } = await returned(asset('NOMMA-1'))
      await flow.runner.undo()
      expect(checkouts[0][1]).toEqual({ targetType: 'user', targetId: 7, statusId: 2, expectedCheckin: undefined, note: '[Undo] Bulk return' })
    })

    it("offers no undo for a kept Status Label, which Snipe-IT won't check out, and says why", async () => {
      const fake = await started([asset('NOMMA-1', { status: 'Pending', statusId: 5, statusType: 'pending' })])
      fake.flow.scan('NOMMA-1')
      await vi.waitFor(() => expect(fake.flow.runner.pending).toBe(0))
      const why = "Snipe-IT can't check out an Asset with status 'Pending'. Open NOMMA-1 to put it back by hand."
      expect(fake.flow.runner.undoBlocked).toBe(why)
      expect(fake.flow.runner.askUndo()).toBe(why)
      expect(fake.flow.runner.confirm).toBeNull()
    })

    it('refuses when the Asset is checked out again, and writes nothing', async () => {
      const one = asset('NOMMA-1')
      const { flow, checkouts } = await returned(one)
      one.assignee = { type: 'user', id: 9, name: 'Blake Sampleton' }
      await flow.runner.undo()
      expect(checkouts).toEqual([])
      expect(flow.runner.rows[0]).toMatchObject({ result: { state: 'done' }, undoFailed: 'NOMMA-1 is checked out to Blake Sampleton now' })
    })
  })
})
