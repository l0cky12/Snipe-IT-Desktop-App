import { describe, expect, it, vi, type Mock } from 'vitest'
import type { Asset, CheckinOptions, CheckoutOptions, StatusLabel, UserCard } from '../../main/snipeit'
import { cleanTag, createBulkCheckout, createBulkReturn, createRunner, fieldKey, NOT_ALLOWED, NOT_SENT, pauseSays } from './workflows'

// A fake Snipe-IT behind the Workflow bridge: fictional Assets, and every call recorded.
const asset = (tag: string, more: Partial<Asset> = {}): Asset => ({
  id: Number(tag.replace(/\D/g, '')), assetTag: tag, name: `CB-${tag.slice(-3)}`, model: 'HP Chromebook 14 G7', status: 'Deployed', statusId: 2, statusMeta: 'deployed', statusType: 'deployable',
  assignee: { type: 'user', id: 7, name: 'Avery Testwell' }, checkoutAllowed: false, location: 'Library', defaultLocation: '', locationId: 3, category: 'Chromebook', serial: '', purchaseDate: null,
  warrantyEnd: null, expectedCheckin: null, lastCheckout: null, lastAudited: null, nextAudit: null, endOfLife: null, purchaseCost: null, overdue: null, warranty: null, can: { checkout: true, checkin: true, update: true, delete: true }, ...more,
})
const flush = () => new Promise((r) => setTimeout(r, 0))
const ITOFFICE: StatusLabel = { id: 8, name: 'IT Office' }
const ROOM204: StatusLabel = { id: 4, name: 'Room 204' }
const AVERY: UserCard = { id: 7, name: 'Avery Testwell', username: 'atestwell', employeeNum: '20417', assets: 2 }
const LABELS: StatusLabel[] = [{ id: 1, name: 'Ready to Deploy' }, { id: 2, name: 'Deployed' }, { id: 5, name: 'Pending' }]

function fakeBridge(assets: Asset[]) {
  const calls: string[] = []
  const checkins: [number, CheckinOptions][] = []
  const checkouts: [number, CheckoutOptions][] = []
  // Each Asset's History, newest first: the action and note of each entry.
  const history: Record<number, { action: string; note: string }[]> = {}
  const bridge = {
    assetByTag: vi.fn(async (tag: string) => (calls.push(`bytag ${tag}`), assets.find((a) => a.assetTag === tag) ?? null)),
    keyRefused: vi.fn(async () => (calls.push('version'), false)),
    checkin: vi.fn(async (id: number, o: CheckinOptions) => {
      calls.push(`checkin ${id}`)
      // Like Snipe-IT's checkin(): refuses when its own read finds another Assignee or Status Label than expected.
      const now = assets.find((a) => a.id === id)
      if (o.fromAssignee && (now?.assignee?.type !== o.fromAssignee.type || now.assignee.id !== o.fromAssignee.id)) throw new Error(`${now?.assetTag} is checked out to ${now?.assignee?.name} now`)
      if (o.fromStatusId !== undefined && now?.statusId !== o.fromStatusId) throw new Error(`${now?.assetTag} is '${now?.status}' now`)
      if (o.noDefaultLocation && now?.defaultLocation) throw new Error(`${now.assetTag} has a Default Location now, ${now.defaultLocation}; a Checkin would move it there`)
      checkins.push([id, o])
    }),
    checkout: vi.fn(async (id: number, o: CheckoutOptions) => {
      calls.push(`checkout ${id}`)
      // Like Snipe-IT's checkout(): refuses when its own read finds another Status Label than fromStatusId.
      const now = assets.find((a) => a.id === id)!
      if (o.fromStatusId !== undefined && now.statusId !== o.fromStatusId) throw new Error(`${now.assetTag} is '${now.status}' now`)
      if (o.fromLocationId !== undefined && now.locationId !== o.fromLocationId) throw new Error(`${now.assetTag} is at ${now.location || 'no Location'} now`)
      checkouts.push([id, o])
    }),
    statusLabels: vi.fn(async () => (calls.push('statusLabels'), LABELS)),
    getAsset: vi.fn(async (id: number) => {
      calls.push(`getAsset ${id}`)
      return { ...assets.find((a) => a.id === id)!, fields: [], history: (history[id] ?? []).map((h) => ({ when: '', operator: '', detail: '', ...h })) }
    }),
    exactUsers: vi.fn(async (text: string): Promise<UserCard[]> => (calls.push(`exact ${text}`), [])),
    userSelectlist: vi.fn(async (text: string): Promise<StatusLabel[]> => (calls.push(`selectlist ${text}`), [])),
    userCard: vi.fn(async (id: number): Promise<UserCard> => (calls.push(`user ${id}`), { ...AVERY, id })),
  }
  return { bridge, calls, checkins, checkouts, history }
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

describe('Confirm step', () => {
  // A Workflow whose step asks for a confirm (with required text, if needs is given), and whose write records what it wrote.
  function confirmable(assets: Asset[], needs?: string) {
    const fake = fakeBridge(assets)
    const written: [string, string][] = []
    const failed = vi.fn()
    const runner = createRunner<null>(fake.bridge, async (a) => ({
      what: 'To Avery Testwell',
      confirm: { needs, write: async (now: Asset, text: string) => (written.push([now.assetTag, text]), { text: 'Checked out' }) },
    }), { changed: () => {}, failed }, undefined, 0)
    return { ...fake, runner, written, failed }
  }
  const opened = async (runner: { open: unknown }) => vi.waitFor(() => expect(runner.open).not.toBeNull())
  const settled = async (runner: { pending: number }) => vi.waitFor(() => expect(runner.pending).toBe(0))

  it('opens after the checks and writes nothing until Enter confirms; the write re-reads the Asset first', async () => {
    const { runner, written, calls } = confirmable([asset('NOMMA-1')])
    runner.scan('NOMMA-1', null)
    await opened(runner)
    expect(runner.open!.row).toMatchObject({ tag: 'NOMMA-1', what: 'To Avery Testwell', result: { state: 'confirm' } })
    await flush()
    expect(written).toEqual([])
    expect(runner.confirmOpen()).toBe('')
    expect(runner.open).toBeNull()
    await settled(runner)
    expect(written).toEqual([['NOMMA-1', '']])
    expect(calls).toEqual(['bytag NOMMA-1', 'bytag NOMMA-1'])
    expect(runner.rows[0]).toMatchObject({ result: { state: 'done', text: 'Checked out' }, what: 'To Avery Testwell' })
  })

  it('a rescan of the same tag confirms', async () => {
    const { runner, written } = confirmable([asset('NOMMA-1')])
    runner.scan('NOMMA-1', null)
    await opened(runner)
    expect(runner.scan(' nomma-1\r', null)).toBe('')
    expect(runner.rows).toHaveLength(1)
    await settled(runner)
    expect(written).toEqual([['NOMMA-1', '']])
  })

  it('Esc cancels: "Skipped: not confirmed", nothing written, no error sound', async () => {
    const { runner, written, failed } = confirmable([asset('NOMMA-1')])
    runner.scan('NOMMA-1', null)
    await opened(runner)
    runner.cancelOpen()
    expect(runner.open).toBeNull()
    expect(runner.rows[0].result).toEqual({ state: 'neutral', text: 'Skipped: not confirmed' })
    expect(runner.confirmOpen()).toBe('')
    await flush()
    expect(written).toEqual([])
    expect(failed).not.toHaveBeenCalled()
  })

  it('a different tag skips the waiting Asset without writing it, and gets its own checks and confirm', async () => {
    const { runner, written } = confirmable([asset('NOMMA-1'), asset('NOMMA-2')])
    runner.scan('NOMMA-1', null)
    await opened(runner)
    runner.scan('NOMMA-2', null)
    expect(runner.rows[1]).toMatchObject({ tag: 'NOMMA-1', result: { state: 'neutral', text: 'Skipped: not confirmed' } })
    await vi.waitFor(() => expect(runner.open?.row.tag).toBe('NOMMA-2'))
    runner.confirmOpen()
    await settled(runner)
    expect(written).toEqual([['NOMMA-2', '']])
  })

  it('at most one is open at a time: a newer one skips the older; already-confirmed Assets keep moving', async () => {
    const { runner, written } = confirmable([asset('NOMMA-1'), asset('NOMMA-2'), asset('NOMMA-3')])
    runner.scan('NOMMA-1', null)
    await opened(runner)
    runner.confirmOpen()
    // Both scanned before either confirm opened: the second to open skips the first.
    runner.scan('NOMMA-2', null)
    runner.scan('NOMMA-3', null)
    await vi.waitFor(() => expect(runner.open?.row.tag).toBe('NOMMA-3'))
    expect(runner.rows.map((r) => [r.tag, r.result.state])).toEqual([['NOMMA-3', 'confirm'], ['NOMMA-2', 'neutral'], ['NOMMA-1', 'done']])
    expect(written).toEqual([['NOMMA-1', '']])
  })

  it('a tag that is waiting or working is still a double read while a confirm is open', async () => {
    const { runner, bridge } = confirmable([asset('NOMMA-1'), asset('NOMMA-2')])
    runner.scan('NOMMA-1', null)
    await opened(runner)
    let release = () => {}
    bridge.assetByTag.mockImplementationOnce((tag) => new Promise((r) => { release = () => r(asset(tag)) }))
    runner.scan('NOMMA-2', null)
    await vi.waitFor(() => expect(runner.rows[0].result.state).toBe('working'))
    expect(runner.scan('NOMMA-2', null)).toBe('NOMMA-2 is already scanned')
    release()
    await opened(runner)
  })

  it('required text: Enter or a rescan with it empty does not confirm, and says what is missing', async () => {
    const { runner, written } = confirmable([asset('NOMMA-1')], 'what happened')
    runner.scan('NOMMA-1', null)
    await opened(runner)
    expect(runner.open!.needs).toBe('what happened')
    expect(runner.confirmOpen()).toBe('Type what happened first')
    runner.setText('   ')
    expect(runner.scan('NOMMA-1', null)).toBe('Type what happened first')
    expect(runner.open).not.toBeNull()
    runner.setText('cracked screen')
    expect(runner.scan('NOMMA-1', null)).toBe('')
    await settled(runner)
    expect(written).toEqual([['NOMMA-1', 'cracked screen']])
  })

  it("Enter in the text field confirms with what was typed; a one-word entry that is an Asset Tag is a scan of it", async () => {
    const { runner, written, calls } = confirmable([asset('NOMMA-1'), asset('NOMMA-2')], 'what happened')
    runner.scan('NOMMA-1', null)
    await opened(runner)
    // A scan landing in the text field: a different tag skips the waiting Asset.
    expect(await runner.submitText('NOMMA-2', null)).toBe('')
    expect(calls.slice(-2)).toEqual(['bytag NOMMA-2', 'bytag NOMMA-2'])
    await vi.waitFor(() => expect(runner.open?.row.tag).toBe('NOMMA-2'))
    expect(runner.rows[1].result).toEqual({ state: 'neutral', text: 'Skipped: not confirmed' })
    // One word that isn't a tag is the text.
    expect(await runner.submitText('dropped', null)).toBe('')
    await settled(runner)
    expect(written).toEqual([['NOMMA-2', 'dropped']])
    runner.scan('NOMMA-1', null)
    await opened(runner)
    // Several words are never looked up.
    const asked = calls.length
    expect(await runner.submitText('cracked screen', null)).toBe('')
    await settled(runner)
    // Only the write's own re-read.
    expect(calls.slice(asked)).toEqual(['bytag NOMMA-1'])
    expect(written.at(-1)).toEqual(['NOMMA-1', 'cracked screen'])
  })

  it('the write refuses when the tag is gone or belongs to another Asset now', async () => {
    const { runner, written, bridge } = confirmable([asset('NOMMA-1')])
    runner.scan('NOMMA-1', null)
    await opened(runner)
    bridge.assetByTag.mockResolvedValueOnce({ ...asset('NOMMA-1'), id: 99 })
    runner.confirmOpen()
    await settled(runner)
    expect(runner.rows[0].result).toEqual({ state: 'failed', reason: "NOMMA-1 is another Asset's tag now" })
    expect(written).toEqual([])
  })

  it('leaving skips an open confirm, and one that opens while away is skipped too; coming back works as before', async () => {
    const { runner, written, bridge } = confirmable([asset('NOMMA-1'), asset('NOMMA-2'), asset('NOMMA-3')])
    runner.scan('NOMMA-1', null)
    await opened(runner)
    let release = () => {}
    bridge.assetByTag.mockImplementationOnce((tag) => new Promise((r) => { release = () => r(asset(tag)) }))
    runner.scan('NOMMA-2', null)
    runner.leave()
    expect(runner.rows[1].result).toEqual({ state: 'neutral', text: 'Skipped: not confirmed' })
    release()
    await settled(runner)
    expect(runner.open).toBeNull()
    expect(runner.rows[0].result).toEqual({ state: 'neutral', text: 'Skipped: not confirmed' })
    runner.enter()
    runner.scan('NOMMA-3', null)
    await opened(runner)
    runner.confirmOpen()
    await settled(runner)
    expect(written).toEqual([['NOMMA-3', '']])
  })

  it('Undo last and Clear wait while a confirm is open', async () => {
    const { runner } = confirmable([asset('NOMMA-1')])
    runner.scan('NOMMA-1', null)
    await opened(runner)
    expect(runner.pending).toBe(0)
    expect(runner.undoBlocked).toBe('Undo waits for the open confirm')
    expect(runner.clearBlocked).toBe('Waits until nothing is waiting or working')
  })

  it('a neutral result is a row with nothing written and no sound; a line row is never undone', async () => {
    const failed = vi.fn()
    const { bridge } = fakeBridge([asset('NOMMA-1')])
    const runner = createRunner<null>(bridge, async () => ({ neutral: 'Already theirs', what: 'To Avery Testwell' }), { changed: () => {}, failed }, undefined, 0)
    runner.scan('NOMMA-1', null)
    await settled(runner)
    expect(runner.rows[0]).toMatchObject({ what: 'To Avery Testwell', result: { state: 'neutral', text: 'Already theirs' } })
    expect(runner.announce).toBe('NOMMA-1: Already theirs')
    runner.addLine(null)
    expect(runner.rows[0]).toMatchObject({ line: true, tag: '' })
    expect(runner.askUndo()).toBe('Nothing to undo')
    expect(failed).not.toHaveBeenCalled()
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
    const one = asset('NOMMA-1', { expectedCheckin: '2026-10-09 14:50', overdue: { days: 1, minutes: 1440 } })
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

  it('refuses when the tag is gone or belongs to another Asset now', async () => {
    const one = asset('NOMMA-1')
    const { runner, undone, bridge } = undoable([one])
    runner.scan('NOMMA-1', null)
    await settled(runner)
    bridge.assetByTag.mockResolvedValueOnce({ ...one, id: 99 })
    runner.askUndo()
    await runner.undo()
    expect(runner.rows[0].undoFailed).toBe("NOMMA-1 is another Asset's tag now")
    bridge.assetByTag.mockResolvedValueOnce(null)
    runner.askUndo()
    await runner.undo()
    expect(runner.rows[0].undoFailed).toBe('No Asset with tag NOMMA-1 now')
    expect(undone).toEqual([])
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
      // Checked in as Snipe-IT leaves it: no Assignee, Ready to Deploy.
      fake.bridge.checkin.mockImplementation(async () => { Object.assign(one, { assignee: null, status: 'Ready to Deploy', statusId: 1 }) })
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
      expect(checkouts).toEqual([[1, { targetType: assignee.type, targetId: assignee.id, statusId: 2, fromStatusId: 1, expectedCheckin: '2026-10-13', note: '[Undo] Bulk return' }]])
      expect(flow.runner.rows[0].result.state).toBe('undone')
    })

    it.each([
      ['a Temp checkout', '[Temp checkout | due: 2026-10-13 14:50]'],
      ['an undo that put one back', '[Undo] Bulk return [Temp checkout | due: 2026-10-13 14:50]'],
    ])('carries the Temp checkout tag when the Checkout it puts back was %s', async (_, note) => {
      const one = asset('NOMMA-1', { expectedCheckin: '2026-10-13 14:50' })
      const fake = await returned(one)
      fake.history[one.id] = [{ action: 'Checkin', note: '[Bulk return]' }, { action: 'Checkout', note }, { action: 'Checkout', note: '' }]
      await fake.flow.runner.undo()
      expect(fake.checkouts[0][1]).toMatchObject({ expectedCheckin: '2026-10-13 14:50', note: '[Undo] Bulk return [Temp checkout | due: 2026-10-13 14:50]' })
    })

    it('puts back an ordinary Checkout with a time of day, or one whose History cannot be read, without the Temp checkout tag', async () => {
      const one = asset('NOMMA-1', { expectedCheckin: '2026-10-13 14:50' })
      const fake = await returned(one)
      fake.history[one.id] = [{ action: 'Checkin', note: '[Bulk return]' }, { action: 'Checkout', note: '[Bulk checkout]' }, { action: 'Checkout', note: '[Temp checkout | due: 2026-10-01 14:50]' }]
      await fake.flow.runner.undo()
      expect(fake.checkouts[0][1]).toMatchObject({ expectedCheckin: '2026-10-13 14:50', note: '[Undo] Bulk return' })
      const unread = await returned(asset('NOMMA-2', { expectedCheckin: '2026-10-13 14:50' }))
      await unread.flow.runner.undo()
      expect(unread.checkouts[0][1]).toMatchObject({ expectedCheckin: '2026-10-13 14:50', note: '[Undo] Bulk return' })
    })

    it('reads no History for a date-only Expected Checkin', async () => {
      const { flow, calls } = await returned(asset('NOMMA-1', { expectedCheckin: '2026-10-13' }))
      await flow.runner.undo()
      expect(calls.filter((c) => c.startsWith('getAsset'))).toEqual([])
    })

    it('sends no Expected Checkin when it had none', async () => {
      const { flow, checkouts } = await returned(asset('NOMMA-1'))
      await flow.runner.undo()
      expect(checkouts[0][1]).toEqual({ targetType: 'user', targetId: 7, statusId: 2, fromStatusId: 1, expectedCheckin: undefined, note: '[Undo] Bulk return' })
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

    it('refuses when the Status Label was changed since the return, and writes nothing', async () => {
      const one = asset('NOMMA-1')
      const { flow, checkouts } = await returned(one)
      Object.assign(one, { status: 'Deployed', statusId: 2 })
      await flow.runner.undo()
      expect(checkouts).toEqual([])
      expect(flow.runner.rows[0]).toMatchObject({ result: { state: 'done' }, undoFailed: "NOMMA-1 is 'Deployed' now" })
    })

    it('refuses when the Status Label changed while History was being read, and writes nothing', async () => {
      const one = asset('NOMMA-1', { expectedCheckin: '2026-10-13 14:50' })
      const fake = await returned(one)
      fake.history[one.id] = [{ action: 'Checkout', note: '[Temp checkout | due: 2026-10-13 14:50]' }]
      const read = fake.bridge.getAsset.getMockImplementation()!
      fake.bridge.getAsset.mockImplementationOnce(async (id: number) => (Object.assign(one, { status: 'Deployed', statusId: 2 }), read(id)))
      await fake.flow.runner.undo()
      expect(fake.checkouts).toEqual([])
      expect(fake.flow.runner.rows[0]).toMatchObject({ result: { state: 'done' }, undoFailed: "NOMMA-1 is 'Deployed' now" })
    })

    it('writes nothing when Settings points at another server while History is being read', async () => {
      const one = asset('NOMMA-1', { expectedCheckin: '2026-10-13 14:50' })
      const fake = await returned(one)
      const read = fake.bridge.getAsset.getMockImplementation()!
      let release = () => {}
      fake.bridge.getAsset.mockImplementationOnce((id: number) => new Promise((r) => { release = () => r(read(id)) }))
      const undoing = fake.flow.runner.undo()
      await vi.waitFor(() => expect(fake.bridge.getAsset).toHaveBeenCalled())
      fake.flow.reset()
      release()
      await undoing
      expect(fake.checkouts).toEqual([])
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

describe('Bulk checkout', () => {
  // Ready to Deploy, in the Library, checked out to no one.
  const ready = (tag: string, more: Partial<Asset> = {}) =>
    asset(tag, { assignee: null, status: 'Ready to Deploy', statusId: 1, statusMeta: 'deployable', checkoutAllowed: true, ...more })
  async function finding(assets: Asset[]) {
    const fake = fakeBridge(assets)
    const failed = vi.fn()
    const flow = createBulkCheckout(fake.bridge, { changed: () => {}, failed }, undefined, 0)
    return { ...fake, flow, failed }
  }
  async function scanning(assets: Asset[], options?: { expectedCheckin: string; note: string }) {
    const f = await finding(assets)
    if (options) expect(f.flow.setOptions(options)).toBe('')
    f.bridge.exactUsers.mockResolvedValueOnce([AVERY])
    await f.flow.find('atestwell')
    expect(f.flow.step).toEqual({ step: 'scan', user: AVERY, round: 1 })
    return f
  }
  const opened = async (flow: { runner: { open: unknown } }) => vi.waitFor(() => expect(flow.runner.open).not.toBeNull())
  const settled = async (flow: { runner: { pending: number } }) => vi.waitFor(() => expect(flow.runner.pending).toBe(0))

  describe('finding the User', () => {
    it('an employee number or email goes to the exact match first, and a single hit goes straight to step 2', async () => {
      const { flow, bridge, calls } = await finding([])
      bridge.exactUsers.mockResolvedValueOnce([AVERY])
      expect(await flow.find(' 20417 ')).toEqual({ status: '' })
      expect(flow.step).toEqual({ step: 'scan', user: AVERY, round: 1 })
      flow.done()
      bridge.exactUsers.mockResolvedValueOnce([AVERY])
      await flow.find('avery.testwell@example.org')
      expect(bridge.exactUsers.mock.calls).toEqual([['20417'], ['avery.testwell@example.org']])
      expect(calls).toEqual([])
      expect(flow.step).toMatchObject({ step: 'scan', round: 2 })
    })

    it("without a single exact hit, falls back to Snipe-IT's User picker list: one row is picked, several are listed", async () => {
      const { flow, bridge, calls } = await finding([])
      bridge.userSelectlist.mockResolvedValueOnce([{ id: 7, name: 'Testwell, Avery (atestwell) - #20417' }])
      expect(await flow.find('avery')).toEqual({ status: '' })
      expect(calls).toEqual(['exact avery', 'user 7'])
      expect(bridge.userSelectlist.mock.calls).toEqual([['avery']])
      expect(flow.step).toMatchObject({ step: 'scan', user: { id: 7 } })
      flow.done()
      const two = [{ id: 7, name: 'Testwell, Avery (atestwell) - #20417' }, { id: 9, name: 'Testwell, Avery (atestwell9) - #20533' }]
      bridge.userSelectlist.mockResolvedValueOnce(two)
      expect(await flow.find('avery')).toEqual({ users: two, status: "2 Users match 'avery'. Pick one." })
      expect(flow.step).toEqual({ step: 'user' })
    })

    it('Enter on a list the Operator has already seen picks its highlighted row, after the exact match', async () => {
      const { flow, calls } = await finding([])
      const two = [{ id: 7, name: 'Avery' }, { id: 9, name: 'Avery 9' }]
      expect(await flow.find('avery', two, 1)).toEqual({ status: '' })
      expect(calls).toEqual(['exact avery', 'user 9'])
      expect(flow.step).toMatchObject({ user: { id: 9 } })
    })

    it("says no User matches, and that a scanned tag needs a User first, without checking it's a tag", async () => {
      const { flow, calls } = await finding([])
      expect(await flow.find('Avery Testwel')).toEqual({ users: [], status: "No User matches 'Avery Testwel'" })
      expect(await flow.find('NOMMA-001234')).toEqual({ users: [], status: "No User matches 'NOMMA-001234'. Find the User first, then scan Assets." })
      expect(calls.some((c) => c.startsWith('bytag'))).toBe(false)
      expect(flow.step).toEqual({ step: 'user' })
      expect(flow.scan('NOMMA-001234')).toBe('Find the User first')
    })

    it('a find still waiting when the text changes never lands', async () => {
      const { flow, bridge } = await finding([])
      let release = () => {}
      bridge.exactUsers.mockImplementationOnce(() => new Promise((r) => { release = () => r([AVERY]) }))
      const slow = flow.find('atestwell')
      flow.stopFinding()
      release()
      await slow
      expect(flow.step).toEqual({ step: 'user' })
    })

    it('a slower find never lands after Done or a newer pick', async () => {
      const { flow, bridge } = await finding([])
      let release = () => {}
      bridge.exactUsers.mockImplementationOnce(() => new Promise((r) => { release = () => r([AVERY]) }))
      const slow = flow.find('atestwell')
      flow.done()
      release()
      await slow
      expect(flow.step).toEqual({ step: 'user' })
    })
  })

  describe('scanning', () => {
    it("refuses before any confirm: unknown tag, a Status Label that can't be checked out, a key that may not, someone else's Asset", async () => {
      const { flow, checkouts, failed } = await scanning([
        ready('NOMMA-2', { status: 'Broken', statusId: 6, statusMeta: 'undeployable', statusType: 'undeployable' }),
        ready('NOMMA-3', { can: { checkout: false, checkin: true, update: true, delete: true } }),
        asset('NOMMA-4', { assignee: { type: 'location', id: 4, name: 'Room 204' } }),
        asset('NOMMA-5', { assignee: { type: 'user', id: 8, name: 'Blake Sampleton' } }),
      ])
      for (const tag of ['NOMMA-9', 'NOMMA-2', 'NOMMA-3', 'NOMMA-4', 'NOMMA-5']) flow.scan(tag)
      await settled(flow)
      expect(flow.runner.open).toBeNull()
      expect(flow.runner.rows.map((r) => r.result)).toEqual([
        { state: 'failed', reason: 'Checked out to Blake Sampleton' },
        { state: 'failed', reason: 'Checked out to Room 204' },
        { state: 'failed', reason: NOT_ALLOWED },
        { state: 'failed', reason: '"NOMMA-2" is "Broken", which can\'t be checked out' },
        { state: 'failed', reason: 'No Asset with tag NOMMA-9' },
      ])
      expect(failed).toHaveBeenCalledTimes(5)
      expect(checkouts).toEqual([])
    })

    it('an Asset already checked out to this User is a neutral "Already theirs" row: nothing written, no sound', async () => {
      const { flow, checkouts, failed } = await scanning([asset('NOMMA-1')])
      flow.scan('NOMMA-1')
      await settled(flow)
      expect(flow.runner.rows[0]).toMatchObject({ what: 'To Avery Testwell', result: { state: 'neutral', text: 'Already theirs' } })
      expect(checkouts).toEqual([])
      expect(failed).not.toHaveBeenCalled()
    })

    it("checks out to the User once confirmed, with the session's Expected Checkin and the [Bulk checkout] note", async () => {
      const { flow, checkouts, calls } = await scanning([ready('NOMMA-1'), ready('NOMMA-2')], { expectedCheckin: '2027-06-04', note: 'start of year' })
      flow.scan('NOMMA-1')
      await opened(flow)
      expect(flow.runner.open!.row).toMatchObject({ tag: 'NOMMA-1', what: 'To Avery Testwell' })
      expect(checkouts).toEqual([])
      flow.runner.confirmOpen()
      await settled(flow)
      expect(checkouts).toEqual([[1, { targetType: 'user', targetId: 7, fromStatusId: 1, fromLocationId: 3, expectedCheckin: '2027-06-04', note: '[Bulk checkout] start of year' }]])
      expect(calls.slice(-3)).toEqual(['bytag NOMMA-1', 'bytag NOMMA-1', 'checkout 1'])
      expect(flow.runner.rows[0].result).toEqual({ state: 'done', text: 'Checked out' })
      // Without options: no Expected Checkin, just the tag.
      flow.setOptions({ expectedCheckin: '', note: '' })
      flow.scan('NOMMA-2')
      await opened(flow)
      flow.runner.confirmOpen()
      await settled(flow)
      expect(checkouts[1]).toEqual([2, { targetType: 'user', targetId: 7, fromStatusId: 1, fromLocationId: 3, expectedCheckin: undefined, note: '[Bulk checkout]' }])
    })

    it("options are checked when set: a note can't hold a link", async () => {
      const { flow } = await finding([])
      expect(flow.setOptions({ expectedCheckin: '', note: 'see https://example.org' })).toBe('Notes can’t contain links (http:// or https://).')
      expect(flow.options).toEqual({ expectedCheckin: '', note: '' })
    })

    it('the write re-reads and refuses when the Asset changed since the scan', async () => {
      const { flow, bridge, checkouts } = await scanning([ready('NOMMA-1')])
      flow.scan('NOMMA-1')
      await opened(flow)
      bridge.assetByTag.mockResolvedValueOnce(ready('NOMMA-1', { location: 'Room 204', locationId: 4 }))
      flow.runner.confirmOpen()
      await settled(flow)
      expect(flow.runner.rows[0].result).toEqual({ state: 'failed', reason: 'NOMMA-1 changed since it was scanned' })
      expect(checkouts).toEqual([])
    })

    it("Checkout's own last read refuses a Status Label or Location changed since the write's re-read", async () => {
      const assets = [ready('NOMMA-1'), ready('NOMMA-2')]
      const { flow, bridge, checkouts } = await scanning(assets)
      for (const [i, changed, reason] of [[0, { status: 'Loaner Pool', statusId: 3 }, "NOMMA-1 is 'Loaner Pool' now"], [1, { location: 'Room 204', locationId: 4 }, 'NOMMA-2 is at Room 204 now']] as const) {
        const tag = `NOMMA-${i + 1}`
        flow.scan(tag)
        await opened(flow)
        bridge.assetByTag.mockResolvedValueOnce(ready(tag))
        assets[i] = ready(tag, changed)
        flow.runner.confirmOpen()
        await settled(flow)
        expect(flow.runner.rows[0].result).toEqual({ state: 'failed', reason })
      }
      expect(checkouts).toEqual([])
      expect(flow.step).toMatchObject({ user: { assets: AVERY.assets } })
    })

    it('latest wins: a slow lookup never opens its confirm after a newer scan, even one that was refused', async () => {
      const { flow, bridge, checkouts } = await scanning([ready('NOMMA-1')])
      let release = () => {}
      bridge.assetByTag.mockImplementationOnce((tag) => new Promise((r) => { release = () => r(ready(tag)) }))
      flow.scan('NOMMA-1')
      await vi.waitFor(() => expect(flow.runner.rows[0].result.state).toBe('working'))
      flow.scan('NOMMA-9')
      release()
      await settled(flow)
      expect(flow.runner.open).toBeNull()
      expect(flow.runner.rows.map((r) => [r.tag, r.result])).toEqual([
        ['NOMMA-9', { state: 'failed', reason: 'No Asset with tag NOMMA-9' }],
        ['NOMMA-1', { state: 'neutral', text: 'Skipped: not confirmed' }],
      ])
      expect(flow.runner.confirmOpen()).toBe('')
      await settled(flow)
      expect(checkouts).toEqual([])
    })

    it('a Checkout still in flight when the server changes never counts toward a same-id User there', async () => {
      const { flow, bridge } = await scanning([ready('NOMMA-1')])
      let release = () => {}
      bridge.checkout.mockImplementationOnce(() => new Promise<void>((r) => { release = r }))
      flow.scan('NOMMA-1')
      await opened(flow)
      flow.runner.confirmOpen()
      await vi.waitFor(() => expect(bridge.checkout).toHaveBeenCalled())
      flow.reset()
      bridge.exactUsers.mockResolvedValueOnce([AVERY])
      await flow.find('atestwell')
      release()
      await flush()
      expect(flow.step).toMatchObject({ step: 'scan', user: { assets: AVERY.assets } })
    })

    it('a lookup that lands after Done never opens a confirm for the ended round', async () => {
      const { flow, bridge, checkouts } = await scanning([ready('NOMMA-1')])
      let release = () => {}
      bridge.assetByTag.mockImplementationOnce((tag) => new Promise((r) => { release = () => r(ready(tag)) }))
      flow.scan('NOMMA-1')
      await vi.waitFor(() => expect(flow.runner.rows[0].result.state).toBe('working'))
      flow.done()
      bridge.exactUsers.mockResolvedValueOnce([{ ...AVERY, id: 8, name: 'Blake Sampleton' }])
      await flow.find('bsampleton')
      release()
      await settled(flow)
      expect(flow.runner.open).toBeNull()
      expect(flow.runner.rows.find((r) => r.tag === 'NOMMA-1')!.result).toEqual({ state: 'neutral', text: 'Skipped: not confirmed' })
      // Rescanning it now is a new scan for the new User.
      flow.scan('NOMMA-1')
      await opened(flow)
      expect(flow.runner.open!.row.ctx.user.name).toBe('Blake Sampleton')
      expect(checkouts).toEqual([])
    })

    it('Done skips an open confirm, adds "Checked out N Assets to <User>" and goes back to finding a User', async () => {
      const { flow, checkouts } = await scanning([ready('NOMMA-1'), ready('NOMMA-2'), asset('NOMMA-3')])
      flow.scan('NOMMA-3')
      flow.scan('NOMMA-1')
      await opened(flow)
      flow.runner.confirmOpen()
      flow.scan('NOMMA-2')
      await vi.waitFor(() => expect(flow.runner.open?.row.tag).toBe('NOMMA-2'))
      flow.done()
      expect(flow.step).toEqual({ step: 'user' })
      await settled(flow)
      const [line, skipped] = flow.runner.rows
      expect(skipped.result).toEqual({ state: 'neutral', text: 'Skipped: not confirmed' })
      expect(line.line).toBe(true)
      // Counts this User's done rows, including writes that finish after Done.
      expect(flow.summary(line)).toBe('Checked out 1 Asset to Avery Testwell')
      expect(checkouts.map(([id]) => id)).toEqual([1])
      // A User with nothing scanned still gets their line.
      await flow.find('atestwell', [{ id: 7, name: 'Avery' }])
      flow.done()
      expect(flow.summary(flow.runner.rows[0])).toBe('Checked out 0 Assets to Avery Testwell')
    })
  })

  describe('Undo last', () => {
    const now = (more: Partial<Asset> = {}) => ready('NOMMA-1', { assignee: { type: 'user', id: 7, name: 'Avery Testwell' }, statusMeta: 'deployed', location: 'Room 204', locationId: 4, ...more })
    async function checkedOut(more: Partial<Asset> = {}) {
      const assets = [ready('NOMMA-1', more)]
      const f = await scanning(assets)
      f.flow.scan('NOMMA-1')
      await opened(f.flow)
      f.flow.runner.confirmOpen()
      await settled(f.flow)
      // What Checkin's own last read finds: checked out to Avery.
      assets[0] = now()
      return { ...f, assets }
    }

    it('checks it in, putting back the Status Label and Location it had, with the [Undo] note', async () => {
      const { flow, bridge, checkins } = await checkedOut()
      bridge.assetByTag.mockResolvedValueOnce(now())
      expect(flow.runner.askUndo()).toBe('')
      expect(flow.runner.confirm).toBe('Undo: NOMMA-1 → Avery Testwell? Enter to undo, Esc to cancel.')
      await flow.runner.undo()
      expect(checkins).toEqual([[1, { statusId: 1, locationId: 3, note: '[Undo] Bulk checkout', fromAssignee: { type: 'user', id: 7 }, fromStatusId: 1, noDefaultLocation: false }]])
      expect(flow.runner.rows[0].result).toEqual({ state: 'undone' })
    })

    it("the User's Asset count goes up with the Checkout and back down with its Undo", async () => {
      const { flow, bridge } = await checkedOut()
      expect(flow.step).toMatchObject({ user: { assets: AVERY.assets + 1 } })
      bridge.assetByTag.mockResolvedValueOnce(now())
      flow.runner.askUndo()
      await flow.runner.undo()
      expect(flow.step).toMatchObject({ user: { assets: AVERY.assets } })
    })

    it("keeps the field's key through the count changing, so a tag being typed isn't cleared, and changes it on Done", async () => {
      const { flow, bridge } = await checkedOut()
      const key = fieldKey(flow.step)
      bridge.assetByTag.mockResolvedValueOnce(now())
      flow.runner.askUndo()
      await flow.runner.undo()
      expect(fieldKey(flow.step)).toBe(key)
      flow.done()
      expect(fieldKey(flow.step)).not.toBe(key)
    })

    it('refuses a newer Checkout to the same User (another Expected Checkin), and writes nothing', async () => {
      const { flow, bridge, checkins } = await checkedOut()
      bridge.assetByTag.mockResolvedValueOnce(now({ expectedCheckin: '2026-11-02' }))
      flow.runner.askUndo()
      await flow.runner.undo()
      expect(checkins).toEqual([])
      expect(flow.runner.rows[0]).toMatchObject({ result: { state: 'done' }, undoFailed: 'NOMMA-1 is due back 2026-11-02 now' })
    })

    it("is by hand for an Asset that had no Location but has a Default Location: Snipe-IT's Checkin would send it there", async () => {
      const f = await scanning([ready('NOMMA-1', { location: '', locationId: null, defaultLocation: 'IT Office' })])
      f.flow.scan('NOMMA-1')
      await opened(f.flow)
      f.flow.runner.confirmOpen()
      await settled(f.flow)
      expect(f.flow.runner.undoBlocked).toMatch(/^Snipe-IT would check NOMMA-1 in to its Default Location, IT Office/)
    })

    it('refuses when it is no longer checked out to this User, or its Status Label changed, and writes nothing', async () => {
      const { flow, bridge, checkins } = await checkedOut()
      bridge.assetByTag.mockResolvedValueOnce(now({ assignee: { type: 'user', id: 8, name: 'Blake Sampleton' } }))
      flow.runner.askUndo()
      await flow.runner.undo()
      expect(flow.runner.rows[0].undoFailed).toBe('NOMMA-1 is no longer checked out to Avery Testwell')
      bridge.assetByTag.mockResolvedValueOnce(now({ assignee: null }))
      flow.runner.askUndo()
      await flow.runner.undo()
      expect(flow.runner.rows[0].undoFailed).toBe('NOMMA-1 is no longer checked out to Avery Testwell')
      bridge.assetByTag.mockResolvedValueOnce(now({ status: 'Deployed', statusId: 2 }))
      flow.runner.askUndo()
      await flow.runner.undo()
      expect(flow.runner.rows[0].undoFailed).toBe("NOMMA-1 is 'Deployed' now")
      expect(checkins).toEqual([])
      expect(flow.runner.rows[0].result.state).toBe('done')
    })

    it("Checkin's own last read refuses an Asset reassigned or relabelled since Undo's read, and writes nothing", async () => {
      const { flow, bridge, checkins, assets } = await checkedOut()
      bridge.assetByTag.mockResolvedValueOnce(now())
      assets[0] = now({ assignee: { type: 'user', id: 8, name: 'Blake Sampleton' } })
      flow.runner.askUndo()
      await flow.runner.undo()
      expect(flow.runner.rows[0].undoFailed).toBe('NOMMA-1 is checked out to Blake Sampleton now')
      bridge.assetByTag.mockResolvedValueOnce(now())
      assets[0] = now({ status: 'Deployed', statusId: 2 })
      flow.runner.askUndo()
      await flow.runner.undo()
      expect(flow.runner.rows[0].undoFailed).toBe("NOMMA-1 is 'Deployed' now")
      expect(checkins).toEqual([])
      expect(flow.step).toMatchObject({ user: { assets: AVERY.assets + 1 } })
    })

    // Snipe-IT's Checkin moves an Asset sent with no Location to its Default Location (#72), so "no Location" only comes back when it has none.
    // One that had a Default Location already at the Checkout is by hand from the start (below).
    it('refuses for an Asset that had no Location and has been given a Default Location since, since a Checkin would move it there', async () => {
      const { flow, bridge, checkins } = await checkedOut({ location: '', locationId: null, defaultLocation: '' })
      bridge.assetByTag.mockResolvedValueOnce(now({ defaultLocation: 'IT Office' }))
      flow.runner.askUndo()
      await flow.runner.undo()
      expect(flow.runner.rows[0].undoFailed).toBe('NOMMA-1 had no Location; a Checkin would move it to its Default Location, IT Office')
      expect(checkins).toEqual([])
    })

    it("Checkin's own last read refuses an Asset that had no Location and has been given a Default Location since Undo's read", async () => {
      const { flow, bridge, checkins, assets } = await checkedOut({ location: '', locationId: null, defaultLocation: '' })
      bridge.assetByTag.mockResolvedValueOnce(now())
      assets[0] = now({ defaultLocation: 'IT Office' })
      flow.runner.askUndo()
      await flow.runner.undo()
      expect(flow.runner.rows[0].undoFailed).toBe('NOMMA-1 has a Default Location now, IT Office; a Checkin would move it there')
      expect(checkins).toEqual([])
    })

    it('checks in with no Location an Asset that had none and has no Default Location', async () => {
      const { flow, bridge, checkins } = await checkedOut({ location: '', locationId: null, defaultLocation: '' })
      bridge.assetByTag.mockResolvedValueOnce(now())
      flow.runner.askUndo()
      await flow.runner.undo()
      expect(checkins).toEqual([[1, { statusId: 1, locationId: undefined, note: '[Undo] Bulk checkout', fromAssignee: { type: 'user', id: 7 }, fromStatusId: 1, noDefaultLocation: true }]])
      expect(flow.runner.rows[0].result).toEqual({ state: 'undone' })
    })
  })

  it('reset (another server) forgets the User, the options and the Running list', async () => {
    const { flow } = await scanning([asset('NOMMA-1')], { expectedCheckin: '2027-06-04', note: 'x' })
    flow.scan('NOMMA-1')
    await settled(flow)
    flow.reset()
    expect(flow.step).toEqual({ step: 'user' })
    expect(flow.options).toEqual({ expectedCheckin: '', note: '' })
    expect(flow.runner.rows).toEqual([])
  })
})

describe('Pause (#73)', () => {
  // A failure as the window receives it from the bridge (Failure), by kind.
  const failure = (kind: string, more: object = {}) => ({ message: `Snipe-IT failed: ${kind}`, kind, ...more })
  const settled = async (runner: { pending: number }) => vi.waitFor(() => expect(runner.pending).toBe(0))
  // The fake's call is recorded (and a write counted as sent) as usual, then it fails with e.
  function failOnce<A extends unknown[], R>(fn: Mock<(...args: A) => Promise<R>>, e: unknown) {
    const usual = fn.getMockImplementation()!
    fn.mockImplementationOnce(async (...args: A) => { await usual(...args); throw e })
  }
  // A Workflow whose step writes at once (like Bulk return), recording each write.
  function direct(assets: Asset[]) {
    const fake = fakeBridge(assets)
    const failed = vi.fn()
    const written: string[] = []
    const runner = createRunner<null>(fake.bridge, async (a) => ({ send: { write: async () => (written.push(a.assetTag), { text: 'Done' }) } }), { changed: () => {}, failed }, undefined, 0)
    return { ...fake, runner, failed, written }
  }

  it.each([
    ['unreachable', failure('unreachable'), 'unreachable'],
    ['timeout', failure('timeout'), 'unreachable'],
    ['key (401)', failure('key'), 'key'],
    ['rateLimited (429)', failure('rateLimited', { retryAfter: 23 }), 'rateLimited'],
    ['forbidden (403) when /version is refused too', failure('forbidden'), 'key'],
  ])('%s pauses: the scan goes back to the front, later scans wait unlooked-up, one error sound', async (_name, e, kind) => {
    const { runner, bridge, calls, failed, written } = direct([asset('NOMMA-1'), asset('NOMMA-2')])
    bridge.keyRefused.mockResolvedValueOnce(true)
    failOnce(bridge.assetByTag, e)
    runner.scan('NOMMA-1', null)
    runner.scan('NOMMA-2', null)
    await vi.waitFor(() => expect(runner.paused).toMatchObject({ kind, message: e.message }))
    expect(runner.rows.map((r) => [r.tag, r.result.state])).toEqual([['NOMMA-2', 'waiting'], ['NOMMA-1', 'waiting']])
    expect(failed).toHaveBeenCalledTimes(1)
    // Scanning carries on: a new scan joins with no lookup, and a double read is still one.
    expect(runner.scan('NOMMA-3', null)).toBe('')
    expect(runner.scan('NOMMA-1', null)).toBe('NOMMA-1 is already scanned')
    await flush()
    expect(calls.filter((c) => c.startsWith('bytag'))).toEqual(['bytag NOMMA-1'])
    expect(runner.unsent).toBe(3)
    expect(runner.undoBlocked).toBe('Undo waits until the Workflow resumes')
    expect(runner.announce).toMatch(kind === 'rateLimited' ? /^Snipe-IT asked the app to slow down\. Carrying on in 23 s\. 2 scans are waiting\.$/ : /2 scans are waiting; nothing more is sent until you resume\.$/)
    runner.reset()
    expect(written).toEqual([])
  })

  it('a refusal, a 500 or a 403 that /version answers is a red row for that Asset; the queue moves on', async () => {
    const { runner, bridge, failed, written } = direct([asset('NOMMA-1'), asset('NOMMA-2'), asset('NOMMA-3'), asset('NOMMA-4')])
    const errors: Record<string, unknown> = { 'NOMMA-1': failure('refused'), 'NOMMA-2': new Error('Snipe-IT returned HTTP 500'), 'NOMMA-3': failure('forbidden') }
    const usual = bridge.assetByTag.getMockImplementation()!
    bridge.assetByTag.mockImplementation(async (tag) => { if (errors[tag]) throw errors[tag]; return usual(tag) })
    for (const tag of ['NOMMA-1', 'NOMMA-2', 'NOMMA-3', 'NOMMA-4']) runner.scan(tag, null)
    await settled(runner)
    expect(runner.paused).toBeNull()
    expect(bridge.keyRefused).toHaveBeenCalledTimes(1)
    expect(runner.rows.map((r) => r.result.state)).toEqual(['done', 'failed', 'failed', 'failed'])
    expect(failed).toHaveBeenCalledTimes(3)
    expect(written).toEqual(['NOMMA-4'])
  })

  it('Resume sends the front scan first, then the rest in order; failing the same way, the bar stays', async () => {
    const { runner, bridge, written, failed } = direct([asset('NOMMA-1'), asset('NOMMA-2')])
    failOnce(bridge.assetByTag, failure('unreachable'))
    runner.scan('NOMMA-1', null)
    await vi.waitFor(() => expect(runner.paused).not.toBeNull())
    runner.scan('NOMMA-2', null)
    failOnce(bridge.assetByTag, failure('unreachable'))
    await runner.resume()
    await vi.waitFor(() => expect(failed).toHaveBeenCalledTimes(2))
    expect(runner.paused).toMatchObject({ kind: 'unreachable' })
    expect(written).toEqual([])
    await runner.resume()
    await settled(runner)
    expect(runner.paused).toBeNull()
    expect(written).toEqual(['NOMMA-1', 'NOMMA-2'])
    expect(runner.unsent).toBe(0)
  })

  it('Drop waiting marks every waiting scan "Skipped: not sent", writes nothing and lifts the pause', async () => {
    const { runner, bridge, written } = direct([asset('NOMMA-1'), asset('NOMMA-2'), asset('NOMMA-3')])
    failOnce(bridge.assetByTag, failure('key'))
    runner.scan('NOMMA-1', null)
    runner.scan('NOMMA-2', null)
    await vi.waitFor(() => expect(runner.paused).not.toBeNull())
    runner.dropWaiting()
    expect(runner.paused).toBeNull()
    expect(runner.rows.map((r) => r.result)).toEqual([{ state: 'neutral', text: NOT_SENT }, { state: 'neutral', text: NOT_SENT }])
    expect(runner.pending).toBe(0)
    runner.scan('NOMMA-3', null)
    await settled(runner)
    expect(written).toEqual(['NOMMA-3'])
  })

  it('a 429 carries on by itself after Retry-After (60 s without one), with no Operator action', async () => {
    vi.useFakeTimers()
    try {
      const { runner, bridge, written } = direct([asset('NOMMA-1')])
      failOnce(bridge.assetByTag, failure('rateLimited', { retryAfter: 23 }))
      runner.scan('NOMMA-1', null)
      await vi.advanceTimersByTimeAsync(0)
      expect(runner.paused).toMatchObject({ kind: 'rateLimited' })
      await vi.advanceTimersByTimeAsync(22_900)
      expect(runner.paused).not.toBeNull()
      await vi.advanceTimersByTimeAsync(100)
      expect(runner.paused).toBeNull()
      expect(written).toEqual(['NOMMA-1'])

      failOnce(bridge.assetByTag, failure('rateLimited'))
      runner.scan('NOMMA-1', null)
      await vi.advanceTimersByTimeAsync(59_900)
      expect(runner.paused).not.toBeNull()
      await vi.advanceTimersByTimeAsync(100)
      expect(written).toEqual(['NOMMA-1', 'NOMMA-1'])
    } finally {
      vi.useRealTimers()
    }
  })

  it('the pause bar says why and how many wait', () => {
    expect(pauseSays({ kind: 'unreachable', message: "Can't reach Snipe-IT." }, 4)).toBe("Can't reach Snipe-IT. 4 scans are waiting; nothing more is sent until you resume.")
    expect(pauseSays({ kind: 'rateLimited', message: '', until: 23_000 }, 1, 100)).toBe('Snipe-IT asked the app to slow down. Carrying on in 23 s. 1 scan is waiting.')
  })

  it("scans held by a pause bring up their confirms on Resume one at a time; a confirmed write isn't confirmed again", async () => {
    const fake = fakeBridge([asset('NOMMA-1'), asset('NOMMA-2'), asset('NOMMA-3')])
    const written: string[] = []
    const runner = createRunner<null>(fake.bridge, async () => ({ confirm: { write: async (now: Asset) => (written.push(now.assetTag), { text: 'Checked out' }) } }), { changed: () => {} }, undefined, 0)
    runner.scan('NOMMA-1', null)
    await vi.waitFor(() => expect(runner.open).not.toBeNull())
    // Confirmed, then its write hits a 401: it waits through the pause with its confirm kept.
    failOnce(fake.bridge.assetByTag, failure('key'))
    runner.confirmOpen()
    await vi.waitFor(() => expect(runner.paused).not.toBeNull())
    runner.scan('NOMMA-2', null)
    runner.scan('NOMMA-3', null)
    await runner.resume()
    await vi.waitFor(() => expect(runner.open?.row.tag).toBe('NOMMA-2'))
    expect(written).toEqual(['NOMMA-1'])
    await flush()
    // NOMMA-3 waits for NOMMA-2's confirm instead of skipping it.
    expect(fake.calls.filter((c) => c === 'bytag NOMMA-3')).toEqual([])
    runner.confirmOpen()
    await vi.waitFor(() => expect(runner.open?.row.tag).toBe('NOMMA-3'))
    runner.cancelOpen()
    await settled(runner)
    expect(written).toEqual(['NOMMA-1', 'NOMMA-2'])
  })

  it('scans already queued when the pause hit also come up one at a time on Resume', async () => {
    const fake = fakeBridge([asset('NOMMA-1'), asset('NOMMA-2'), asset('NOMMA-3')])
    const runner = createRunner<null>(fake.bridge, async () => ({ confirm: { write: async () => ({ text: 'Checked out' }) } }), { changed: () => {} }, undefined, 0)
    failOnce(fake.bridge.assetByTag, failure('unreachable'))
    for (const tag of ['NOMMA-1', 'NOMMA-2', 'NOMMA-3']) runner.scan(tag, null)
    await vi.waitFor(() => expect(runner.paused).not.toBeNull())
    await runner.resume()
    await vi.waitFor(() => expect(runner.open?.row.tag).toBe('NOMMA-1'))
    await flush()
    expect(runner.rows.map((r) => r.result.state)).toEqual(['waiting', 'waiting', 'confirm'])
    runner.cancelOpen()
    await vi.waitFor(() => expect(runner.open?.row.tag).toBe('NOMMA-2'))
  })

  it("a 403 whose /version check itself fails is a red row, and the queue still moves", async () => {
    const { runner, bridge, written } = direct([asset('NOMMA-1'), asset('NOMMA-2')])
    bridge.keyRefused.mockRejectedValueOnce(new Error('IPC gone'))
    failOnce(bridge.assetByTag, failure('forbidden'))
    runner.scan('NOMMA-1', null)
    runner.scan('NOMMA-2', null)
    await settled(runner)
    expect(runner.rows.map((r) => r.result.state)).toEqual(['done', 'failed'])
    expect(written).toEqual(['NOMMA-2'])
  })

  describe('a write that may have gone through', () => {
    // Bulk return, whose Checkin loses the connection once.
    async function cutOff() {
      const assets = [asset('NOMMA-1')]
      const fake = fakeBridge(assets)
      const flow = createBulkReturn(fake.bridge, { changed: () => {} }, undefined, 0)
      await flow.start(ITOFFICE)
      failOnce(fake.bridge.checkin, failure('unreachable'))
      flow.scan('NOMMA-1')
      await vi.waitFor(() => expect(flow.runner.paused).not.toBeNull())
      return { ...fake, flow, assets }
    }

    it('says "Not sure it went through" while paused; Drop waiting leaves it red, for the Operator to check', async () => {
      const { flow } = await cutOff()
      expect(flow.runner.rows[0].result).toEqual({ state: 'unsure', reason: 'Snipe-IT failed: unreachable' })
      expect(flow.runner.unsent).toBe(1)
      flow.runner.dropWaiting()
      expect(flow.runner.rows[0].result).toEqual({ state: 'failed', reason: 'Not sure it went through: Snipe-IT failed: unreachable' })
    })

    it('on Resume, already as the Workflow leaves it: done, nothing sent again, and Undo last works', async () => {
      const { flow, assets, checkins } = await cutOff()
      assets[0] = { ...assets[0], assignee: null, status: 'Ready to Deploy', statusId: 1, location: 'IT Office', locationId: 8 }
      await flow.runner.resume()
      await settled(flow.runner)
      expect(checkins).toHaveLength(1)
      expect(flow.runner.rows[0]).toMatchObject({ what: 'From Avery Testwell', result: { state: 'done', text: 'Checked in: went through before the connection dropped' } })
      expect(flow.runner.undoBlocked).toBe('')
    })

    it('on Resume, still as it was: sent again', async () => {
      const { flow, checkins } = await cutOff()
      await flow.runner.resume()
      await settled(flow.runner)
      expect(checkins).toHaveLength(2)
      expect(flow.runner.rows[0].result).toEqual({ state: 'done', text: 'Checked in' })
    })

    it('on Resume, anything else: "Changed while paused", nothing written', async () => {
      const { flow, assets, checkins } = await cutOff()
      assets[0] = { ...assets[0], assignee: { type: 'user', id: 8, name: 'Blake Sampleton' } }
      await flow.runner.resume()
      await settled(flow.runner)
      expect(checkins).toHaveLength(1)
      expect(flow.runner.rows[0].result).toEqual({ state: 'failed', reason: "Changed while paused: checked out to Blake Sampleton, 'Deployed', at Library" })
    })

    it('on Resume, a newer Checkout to the same Assignee counts as changed too: the retry would clear it', async () => {
      const { flow, assets, checkins } = await cutOff()
      assets[0] = { ...assets[0], lastCheckout: '2026-10-12 09:30' }
      await flow.runner.resume()
      await settled(flow.runner)
      expect(checkins).toHaveLength(1)
      expect(flow.runner.rows[0].result).toMatchObject({ state: 'failed', reason: expect.stringMatching(/^Changed while paused/) })
    })

    it('on Resume, a new Expected Checkin counts as changed too: the retry would clear it', async () => {
      const { flow, assets, checkins } = await cutOff()
      assets[0] = { ...assets[0], expectedCheckin: '2026-10-20' }
      await flow.runner.resume()
      await settled(flow.runner)
      expect(checkins).toHaveLength(1)
      expect(flow.runner.rows[0].result).toMatchObject({ state: 'failed', reason: expect.stringMatching(/^Changed while paused/) })
    })

    it("Bulk checkout: a confirmed Checkout that timed out and went through is done on Resume, without a second confirm", async () => {
      const fake = fakeBridge([asset('NOMMA-1', { assignee: null, status: 'Ready to Deploy', statusId: 1, statusMeta: 'deployable', checkoutAllowed: true })])
      const flow = createBulkCheckout(fake.bridge, { changed: () => {} }, undefined, 0)
      fake.bridge.exactUsers.mockResolvedValueOnce([AVERY])
      await flow.find('atestwell')
      flow.scan('NOMMA-1')
      await vi.waitFor(() => expect(flow.runner.open).not.toBeNull())
      failOnce(fake.bridge.checkout, failure('timeout'))
      flow.runner.confirmOpen()
      await vi.waitFor(() => expect(flow.runner.paused).not.toBeNull())
      fake.bridge.assetByTag.mockResolvedValueOnce(asset('NOMMA-1', { status: 'Ready to Deploy', statusId: 1 }))
      await flow.runner.resume()
      await settled(flow.runner)
      expect(flow.runner.open).toBeNull()
      expect(fake.checkouts).toHaveLength(1)
      expect(flow.runner.rows[0].result).toEqual({ state: 'done', text: 'Checked out: went through before the connection dropped' })
      expect(flow.step).toMatchObject({ user: { assets: AVERY.assets + 1 } })
    })

    it("Bulk checkout: someone else's Checkout to the same User (another Expected Checkin) isn't taken for this one", async () => {
      const fake = fakeBridge([asset('NOMMA-1', { assignee: null, status: 'Ready to Deploy', statusId: 1, statusMeta: 'deployable', checkoutAllowed: true })])
      const flow = createBulkCheckout(fake.bridge, { changed: () => {} }, undefined, 0)
      fake.bridge.exactUsers.mockResolvedValueOnce([AVERY])
      await flow.find('atestwell')
      flow.scan('NOMMA-1')
      await vi.waitFor(() => expect(flow.runner.open).not.toBeNull())
      fake.bridge.checkout.mockRejectedValueOnce(failure('timeout'))
      flow.runner.confirmOpen()
      await vi.waitFor(() => expect(flow.runner.paused).not.toBeNull())
      fake.bridge.assetByTag.mockResolvedValueOnce(asset('NOMMA-1', { status: 'Ready to Deploy', statusId: 1, expectedCheckin: '2026-10-30' }))
      await flow.runner.resume()
      await settled(flow.runner)
      expect(flow.runner.rows[0].result).toMatchObject({ state: 'failed', reason: expect.stringMatching(/^Changed while paused: checked out to Avery Testwell/) })
      expect(flow.runner.undoBlocked).toBe('Nothing to undo')
    })
  })

  it('Resume by hand repeats the once-per-session lookups (the key may be new); a slow-down ending does not', async () => {
    vi.useFakeTimers()
    try {
      const { bridge, calls } = fakeBridge([asset('NOMMA-1'), asset('NOMMA-2')])
      const flow = createBulkReturn(bridge, { changed: () => {} }, undefined, 0)
      await flow.start(ITOFFICE)
      failOnce(bridge.assetByTag, failure('key'))
      flow.scan('NOMMA-1')
      await vi.advanceTimersByTimeAsync(0)
      expect(flow.runner.paused).toMatchObject({ kind: 'key' })
      await flow.runner.resume()
      await vi.advanceTimersByTimeAsync(0)
      expect(calls).toEqual(['statusLabels', 'bytag NOMMA-1', 'statusLabels', 'bytag NOMMA-1', 'checkin 1'])
      failOnce(bridge.assetByTag, failure('rateLimited', { retryAfter: 1 }))
      flow.scan('NOMMA-2')
      await vi.advanceTimersByTimeAsync(1000)
      expect(calls.slice(5)).toEqual(['bytag NOMMA-2', 'bytag NOMMA-2', 'checkin 2'])
    } finally {
      vi.useRealTimers()
    }
  })

  it('Drop waiting while Resume is still checking a 403 keeps the pause lifted', async () => {
    const fake = fakeBridge([asset('NOMMA-1')])
    const flow = createBulkReturn(fake.bridge, { changed: () => {} }, undefined, 0)
    await flow.start(ITOFFICE)
    failOnce(fake.bridge.assetByTag, failure('key'))
    flow.scan('NOMMA-1')
    await vi.waitFor(() => expect(flow.runner.paused).not.toBeNull())
    let answer!: (refused: boolean) => void
    fake.bridge.statusLabels.mockRejectedValueOnce(failure('forbidden'))
    fake.bridge.keyRefused.mockImplementationOnce(() => new Promise((r) => { answer = r }))
    const resumed = flow.runner.resume()
    await vi.waitFor(() => expect(answer).toBeDefined())
    flow.runner.dropWaiting()
    answer(true)
    await resumed
    expect(flow.runner.paused).toBeNull()
  })

  it('each Workflow pauses on its own', async () => {
    const one = direct([asset('NOMMA-1')])
    const two = direct([asset('NOMMA-1')])
    failOnce(one.bridge.assetByTag, failure('unreachable'))
    one.runner.scan('NOMMA-1', null)
    two.runner.scan('NOMMA-1', null)
    await settled(two.runner)
    expect(one.runner.paused).not.toBeNull()
    expect(two.runner.paused).toBeNull()
  })
})
