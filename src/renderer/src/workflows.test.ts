import { describe, expect, it, vi } from 'vitest'
import type { Asset, CheckinOptions, CheckoutOptions, MaintenanceInput, StatusLabel, UserCard } from '../../main/snipeit'
import { cleanTag, createBulkCheckout, createBulkReturn, createRepairIntake, createRunner, NOT_ALLOWED } from './workflows'

// A fake Snipe-IT behind the Workflow bridge: fictional Assets, and every call recorded.
const asset = (tag: string, more: Partial<Asset> = {}): Asset => ({
  id: Number(tag.replace(/\D/g, '')), assetTag: tag, name: `CB-${tag.slice(-3)}`, model: 'HP Chromebook 14 G7', status: 'Deployed', statusId: 2, statusMeta: 'deployed', statusType: 'deployable',
  assignee: { type: 'user', id: 7, name: 'Avery Testwell' }, checkoutAllowed: false, location: 'Library', locationId: 3, category: 'Chromebook', serial: '', purchaseDate: null,
  warrantyEnd: null, expectedCheckin: null, overdueDays: null, warranty: null, can: { checkout: true, checkin: true, update: true, delete: true }, ...more,
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
  const bridge = {
    assetByTag: vi.fn(async (tag: string) => (calls.push(`bytag ${tag}`), assets.find((a) => a.assetTag === tag) ?? null)),
    checkin: vi.fn(async (id: number, o: CheckinOptions) => { calls.push(`checkin ${id}`); checkins.push([id, o]) }),
    checkout: vi.fn(async (id: number, o: CheckoutOptions) => { calls.push(`checkout ${id}`); checkouts.push([id, o]) }),
    statusLabels: vi.fn(async () => (calls.push('statusLabels'), LABELS)),
    exactUsers: vi.fn(async (text: string): Promise<UserCard[]> => (calls.push(`exact ${text}`), [])),
    userSelectlist: vi.fn(async (text: string): Promise<StatusLabel[]> => (calls.push(`selectlist ${text}`), [])),
    userCard: vi.fn(async (id: number): Promise<UserCard> => (calls.push(`user ${id}`), { ...AVERY, id })),
    updateStatus: vi.fn(async (id: number, statusId: number) => { calls.push(`status ${id} ${statusId}`) }),
    addAssetNote: vi.fn(async (id: number, note: string) => { calls.push(`note ${id} ${note}`) }),
    operatorName: vi.fn(async () => (calls.push('me'), 'D. Tech')),
    repairTypeId: vi.fn(async (fallback: number | null): Promise<number | null> => (calls.push(`repair type ${fallback}`), 4)),
    openMaintenances: vi.fn(async (id: number): Promise<{ id: number; type: StatusLabel | null }[]> => (calls.push(`open maintenances ${id}`), [])),
    createMaintenance: vi.fn(async (m: MaintenanceInput) => (calls.push(`maintenance ${m.assetId} type ${m.typeId} "${m.name}" ${m.startDate} ${m.notes}`), 61)),
    appendUserNotes: vi.fn(async (id: number, line: string) => { calls.push(`user notes ${id} ${line}`) }),
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
    const { runner, written } = confirmable([asset('NOMMA-1')], 'Say what happened')
    runner.scan('NOMMA-1', null)
    await opened(runner)
    expect(runner.open!.needs).toBe('Say what happened')
    expect(runner.confirmOpen()).toBe('Say what happened')
    runner.setText('   ')
    expect(runner.scan('NOMMA-1', null)).toBe('Say what happened')
    expect(runner.open).not.toBeNull()
    runner.setText('cracked screen')
    expect(runner.scan('NOMMA-1', null)).toBe('')
    await settled(runner)
    expect(written).toEqual([['NOMMA-1', 'cracked screen']])
  })

  it("Enter in the text field confirms with what was typed; a one-word entry that is an Asset Tag is a scan of it", async () => {
    const { runner, written, calls } = confirmable([asset('NOMMA-1'), asset('NOMMA-2')], 'Say what happened')
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

  it("a one-word entry whose tag lookup fails is never taken as the text: the confirm stays open and says why", async () => {
    const { runner, written, bridge } = confirmable([asset('NOMMA-1')], 'Say what happened')
    runner.scan('NOMMA-1', null)
    await opened(runner)
    bridge.assetByTag.mockRejectedValueOnce(new Error("Can't reach Snipe-IT"))
    expect(await runner.submitText('NOMMA-2', null)).toBe("Couldn't check whether NOMMA-2 is an Asset Tag: Can't reach Snipe-IT")
    expect(runner.open).not.toBeNull()
    await flush()
    expect(written).toEqual([])
  })

  it('the same tag landing in the text field is a rescan, never the text', async () => {
    const { runner, written } = confirmable([asset('NOMMA-1')], 'Say what happened')
    runner.scan('NOMMA-1', null)
    await opened(runner)
    // Typed as it arrives, then Enter: the text was the tag, so nothing was said.
    runner.setText('NOMMA-1')
    expect(await runner.submitText('NOMMA-1', null)).toBe('Say what happened')
    expect(runner.open!.text).toBe('')
    expect(await runner.submitText('cracked', null)).toBe('')
    await settled(runner)
    expect(written).toEqual([['NOMMA-1', 'cracked']])
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

describe('Choice step', () => {
  // A Workflow whose step offers a fix-it action (off with blocked, if given) or Stop, and whose fix records what it wrote.
  function choosable(assets: Asset[], blocked = '') {
    const fake = fakeBridge(assets)
    const written: string[] = []
    const failed = vi.fn()
    const runner = createRunner<null>(fake.bridge, async () => ({
      what: 'To Avery Testwell',
      choice: { fix: 'Move to this User', blocked, stop: 'checked out to Blake Sampleton', write: async (now: Asset) => (written.push(now.assetTag), { text: 'Checked out', what: 'Moved from Blake Sampleton' }) },
    }), { changed: () => {}, failed }, undefined, 0)
    return { ...fake, runner, written, failed }
  }
  const opened = async (runner: { open: unknown }) => vi.waitFor(() => expect(runner.open).not.toBeNull())
  const settled = async (runner: { pending: number }) => vi.waitFor(() => expect(runner.pending).toBe(0))
  const STOPPED = { state: 'failed', reason: 'Stopped: checked out to Blake Sampleton' }

  it('opens in place and writes only when the fix-it action is picked; the write re-reads the Asset first', async () => {
    const { runner, written, calls } = choosable([asset('NOMMA-1')])
    runner.scan('NOMMA-1', null)
    await opened(runner)
    expect(runner.open).toMatchObject({ row: { tag: 'NOMMA-1', what: 'To Avery Testwell', result: { state: 'choice' } }, choice: { fix: 'Move to this User', blocked: '' } })
    expect(runner.undoBlocked).toBe('Undo waits for the open choice')
    expect(runner.fixOpen()).toBe('')
    expect(runner.open).toBeNull()
    await settled(runner)
    expect(written).toEqual(['NOMMA-1'])
    expect(calls).toEqual(['bytag NOMMA-1', 'bytag NOMMA-1'])
    expect(runner.rows[0]).toMatchObject({ result: { state: 'done', text: 'Checked out' }, what: 'Moved from Blake Sampleton' })
  })

  it('Enter on the empty field and a rescan of the same tag never pick it', async () => {
    const { runner, written } = choosable([asset('NOMMA-1')])
    runner.scan('NOMMA-1', null)
    await opened(runner)
    expect(runner.confirmOpen()).toBe('NOMMA-1: pick Move to this User or Stop')
    expect(runner.scan('nomma-1', null)).toBe('NOMMA-1: pick Move to this User or Stop')
    expect(await runner.submitText('NOMMA-1', null)).toBe('NOMMA-1: pick Move to this User or Stop')
    await flush()
    expect(runner.open?.row.tag).toBe('NOMMA-1')
    expect(runner.rows).toHaveLength(1)
    expect(written).toEqual([])
  })

  it('Esc stops: "Stopped: <reason>", a red row with the error sound, nothing written', async () => {
    const { runner, written, failed } = choosable([asset('NOMMA-1')])
    runner.scan('NOMMA-1', null)
    await opened(runner)
    runner.cancelOpen()
    expect(runner.open).toBeNull()
    expect(runner.rows[0].result).toEqual(STOPPED)
    expect(failed).toHaveBeenCalledTimes(1)
    await flush()
    expect(written).toEqual([])
  })

  it('a different tag stops the waiting Asset without writing it, and gets its own checks', async () => {
    const { runner, written } = choosable([asset('NOMMA-1'), asset('NOMMA-2')])
    runner.scan('NOMMA-1', null)
    await opened(runner)
    runner.scan('NOMMA-2', null)
    expect(runner.rows[1].result).toEqual(STOPPED)
    await vi.waitFor(() => expect(runner.open?.row.tag).toBe('NOMMA-2'))
    expect(written).toEqual([])
  })

  it('a blocked fix-it action says why and writes nothing; Stop still works', async () => {
    const { runner, written } = choosable([asset('NOMMA-1')], NOT_ALLOWED)
    runner.scan('NOMMA-1', null)
    await opened(runner)
    expect(runner.fixOpen()).toBe(NOT_ALLOWED)
    expect(runner.open).not.toBeNull()
    runner.cancelOpen()
    await flush()
    expect(written).toEqual([])
    expect(runner.rows[0].result).toEqual(STOPPED)
  })

  it('leaving stops an open choice, and one that opens while away is stopped too', async () => {
    const { runner, written, bridge } = choosable([asset('NOMMA-1'), asset('NOMMA-2')])
    runner.scan('NOMMA-1', null)
    await opened(runner)
    let release = () => {}
    bridge.assetByTag.mockImplementationOnce((tag) => new Promise((r) => { release = () => r(asset(tag)) }))
    runner.scan('NOMMA-2', null)
    runner.leave()
    expect(runner.rows[1].result).toEqual(STOPPED)
    release()
    await settled(runner)
    expect(runner.open).toBeNull()
    expect(runner.rows[0].result).toEqual(STOPPED)
    expect(written).toEqual([])
  })

  it('a confirm and a choice are never open together: a newer one stops or skips the older', async () => {
    const fake = fakeBridge([asset('NOMMA-1'), asset('NOMMA-2')])
    const write = async () => ({ text: 'Done' })
    const runner = createRunner<null>(fake.bridge, async (a) => a.assetTag === 'NOMMA-1'
      ? { choice: { fix: 'Move to this User', blocked: '', stop: 'checked out to Blake Sampleton', write } }
      : { confirm: { write } }, { changed: () => {} }, undefined, 0)
    let release = () => {}
    fake.bridge.assetByTag.mockImplementationOnce((tag) => new Promise((r) => { release = () => r(asset(tag)) }))
    runner.scan('NOMMA-2', null)
    runner.scan('NOMMA-1', null)
    release()
    await vi.waitFor(() => expect(runner.open?.row.tag).toBe('NOMMA-1'))
    expect(runner.rows[1].result).toEqual({ state: 'neutral', text: 'Skipped: not confirmed' })
  })
})

describe('Undo last', () => {
  //A Workflow whose step does nothing, and whose undo records the Asset it re-read (or throws what it found).
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

    it('refuses when the Status Label was changed since the return, and writes nothing', async () => {
      const one = asset('NOMMA-1')
      const { flow, checkouts } = await returned(one)
      Object.assign(one, { status: 'Deployed', statusId: 2 })
      await flow.runner.undo()
      expect(checkouts).toEqual([])
      expect(flow.runner.rows[0]).toMatchObject({ result: { state: 'done' }, undoFailed: "NOMMA-1 is 'Deployed' now" })
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
    it("refuses before any confirm or choice: unknown tag, a Status Label that can't be checked out, a key that may not", async () => {
      const { flow, checkouts, failed } = await scanning([
        ready('NOMMA-2', { status: 'Broken', statusId: 6, statusMeta: 'undeployable', statusType: 'undeployable' }),
        ready('NOMMA-3', { can: { checkout: false, checkin: true, update: true, delete: true } }),
        // Someone else's, but a Move couldn't check it out again: its label isn't deployable.
        asset('NOMMA-4', { assignee: { type: 'user', id: 8, name: 'Blake Sampleton' }, status: 'Pending', statusId: 5, statusType: 'pending' }),
      ])
      for (const tag of ['NOMMA-9', 'NOMMA-2', 'NOMMA-3', 'NOMMA-4']) flow.scan(tag)
      await settled(flow)
      expect(flow.runner.open).toBeNull()
      expect(flow.runner.rows.map((r) => r.result)).toEqual([
        { state: 'failed', reason: '"NOMMA-4" is "Pending", which can\'t be checked out' },
        { state: 'failed', reason: NOT_ALLOWED },
        { state: 'failed', reason: '"NOMMA-2" is "Broken", which can\'t be checked out' },
        { state: 'failed', reason: 'No Asset with tag NOMMA-9' },
      ])
      expect(failed).toHaveBeenCalledTimes(4)
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
      expect(checkouts).toEqual([[1, { targetType: 'user', targetId: 7, expectedCheckin: '2027-06-04', note: '[Bulk checkout] start of year' }]])
      expect(calls.slice(-3)).toEqual(['bytag NOMMA-1', 'bytag NOMMA-1', 'checkout 1'])
      expect(flow.runner.rows[0].result).toEqual({ state: 'done', text: 'Checked out' })
      // Without options: no Expected Checkin, just the tag.
      flow.setOptions({ expectedCheckin: '', note: '' })
      flow.scan('NOMMA-2')
      await opened(flow)
      flow.runner.confirmOpen()
      await settled(flow)
      expect(checkouts[1]).toEqual([2, { targetType: 'user', targetId: 7, expectedCheckin: undefined, note: '[Bulk checkout]' }])
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

  describe('someone else\'s Asset: the choice step', () => {
    const BLAKE = { type: 'user' as const, id: 8, name: 'Blake Sampleton', username: 'bsampleton', employeeNum: '20424' }
    // Checked out to Blake, due back on a date, in Room 204.
    const blakes = (tag: string, more: Partial<Asset> = {}) => asset(tag, { assignee: BLAKE, expectedCheckin: '2026-12-18', location: 'Room 204', locationId: 4, ...more })
    async function choosing(assets: Asset[], options?: { expectedCheckin: string; note: string }) {
      const f = await scanning(assets, options)
      f.flow.scan(assets[0].assetTag)
      await opened(f.flow)
      return f
    }

    it('shows who has it and offers Move to this User or Stop; nothing is written yet', async () => {
      const { flow, checkins, checkouts } = await choosing([blakes('NOMMA-1')])
      expect(flow.runner.open).toMatchObject({ row: { tag: 'NOMMA-1', what: 'To Avery Testwell', before: { assignee: BLAKE } }, choice: { fix: 'Move to this User', blocked: '' } })
      expect(checkins).toEqual([])
      expect(checkouts).toEqual([])
    })

    it("Move is off with the not-allowed text when the key can't check it in", async () => {
      const { flow, checkins } = await choosing([blakes('NOMMA-1', { can: { checkout: true, checkin: false, update: true, delete: true } })])
      expect(flow.runner.open!.choice!.blocked).toBe(NOT_ALLOWED)
      expect(flow.runner.fixOpen()).toBe(NOT_ALLOWED)
      expect(checkins).toEqual([])
    })

    it('Stop (Esc), a different scan and Done each stop it as "Stopped: checked out to <other Assignee>"; nothing is written', async () => {
      const room = asset('NOMMA-2', { assignee: { type: 'location', id: 4, name: 'Room 204' } })
      const cart = asset('NOMMA-3', { assignee: { type: 'asset', id: 40, name: 'Cart 2' } })
      const { flow, checkins, checkouts } = await choosing([blakes('NOMMA-1'), room, cart])
      flow.runner.cancelOpen()
      flow.scan('NOMMA-2')
      await vi.waitFor(() => expect(flow.runner.open?.row.tag).toBe('NOMMA-2'))
      flow.scan('NOMMA-3')
      await vi.waitFor(() => expect(flow.runner.open?.row.tag).toBe('NOMMA-3'))
      flow.done()
      await settled(flow)
      expect(flow.runner.rows.filter((r) => !r.line).map((r) => r.result)).toEqual([
        { state: 'failed', reason: 'Stopped: checked out to Asset Cart 2' },
        { state: 'failed', reason: 'Stopped: checked out to Room 204' },
        { state: 'failed', reason: 'Stopped: checked out to Blake Sampleton' },
      ])
      expect(checkins).toEqual([])
      expect(checkouts).toEqual([])
    })

    it("Move checks it in ([Bulk checkout | move], no Status Label change), then out to this User with the session's options", async () => {
      const { flow, checkins, checkouts, calls } = await choosing([blakes('NOMMA-1')], { expectedCheckin: '2027-06-04', note: 'start of year' })
      expect(flow.runner.fixOpen()).toBe('')
      await settled(flow)
      expect(calls.slice(-4)).toEqual(['bytag NOMMA-1', 'bytag NOMMA-1', 'checkin 1', 'checkout 1'])
      expect(checkins).toEqual([[1, { note: '[Bulk checkout | move]' }]])
      expect(checkouts).toEqual([[1, { targetType: 'user', targetId: 7, expectedCheckin: '2027-06-04', note: '[Bulk checkout] start of year' }]])
      expect(flow.runner.rows[0]).toMatchObject({ what: 'Moved from Blake Sampleton', result: { state: 'done', text: 'Checked out' } })
    })

    it('Move refuses when the Assignee changed since the scan, and writes nothing', async () => {
      const { flow, bridge, checkins, checkouts } = await choosing([blakes('NOMMA-1')])
      bridge.assetByTag.mockResolvedValueOnce(blakes('NOMMA-1', { assignee: { type: 'user', id: 9, name: 'Casey Mockford' } }))
      flow.runner.fixOpen()
      await settled(flow)
      expect(flow.runner.rows[0].result).toEqual({ state: 'failed', reason: 'NOMMA-1 changed since it was scanned' })
      expect(checkins).toEqual([])
      expect(checkouts).toEqual([])
    })

    it("Move refuses when the Status Label changed, or the key may no longer check it in or out, and writes nothing", async () => {
      const { flow, bridge, checkins } = await choosing([blakes('NOMMA-1'), blakes('NOMMA-2')])
      bridge.assetByTag.mockResolvedValueOnce(blakes('NOMMA-1', { status: 'Pending', statusId: 5, statusType: 'pending' }))
      flow.runner.fixOpen()
      await settled(flow)
      expect(flow.runner.rows[0].result).toEqual({ state: 'failed', reason: 'NOMMA-1 changed since it was scanned' })
      flow.scan('NOMMA-2')
      await opened(flow)
      bridge.assetByTag.mockResolvedValueOnce(blakes('NOMMA-2', { can: { checkout: false, checkin: true, update: true, delete: true } }))
      flow.runner.fixOpen()
      await settled(flow)
      expect(flow.runner.rows[0].result).toEqual({ state: 'failed', reason: NOT_ALLOWED })
      // The same label, made non-deployable since the scan.
      flow.scan('NOMMA-1')
      await opened(flow)
      bridge.assetByTag.mockResolvedValueOnce(blakes('NOMMA-1', { statusType: 'undeployable' }))
      flow.runner.fixOpen()
      await settled(flow)
      expect(flow.runner.rows[0].result).toEqual({ state: 'failed', reason: 'NOMMA-1 changed since it was scanned' })
      expect(checkins).toEqual([])
    })

    it('Move stops between its Checkin and Checkout when Settings point at another server meanwhile', async () => {
      const { flow, bridge, checkouts } = await choosing([blakes('NOMMA-1')])
      let release = () => {}
      bridge.checkin.mockImplementationOnce(() => new Promise<void>((r) => { release = r }))
      flow.runner.fixOpen()
      await vi.waitFor(() => expect(bridge.checkin).toHaveBeenCalled())
      flow.reset()
      release()
      await flush()
      await flush()
      expect(checkouts).toEqual([])
    })

    it('a Checkin that works then a Checkout that fails is a red row with both facts; the Asset stays checked in', async () => {
      const { flow, bridge, checkins, failed } = await choosing([blakes('NOMMA-1')])
      bridge.checkout.mockRejectedValueOnce(new Error('The selected status id is invalid.'))
      flow.runner.fixOpen()
      await settled(flow)
      expect(flow.runner.rows[0].result).toEqual({ state: 'failed', reason: 'Checked in from Blake Sampleton, but checkout to Avery Testwell failed: The selected status id is invalid.' })
      expect(checkins).toHaveLength(1)
      expect(bridge.checkin).toHaveBeenCalledTimes(1)
      expect(failed).toHaveBeenCalled()
      expect(flow.runner.undoBlocked).toBe('Nothing to undo')
    })

    describe('Undo last of a Move', () => {
      // Moved, then re-read for the undo: checked out to Avery now.
      const moved = (was: Asset) => ({ ...was, assignee: { type: 'user' as const, id: 7, name: 'Avery Testwell' }, expectedCheckin: '2027-06-04' })
      async function undone(was: Asset) {
        const f = await choosing([was])
        f.flow.runner.fixOpen()
        await settled(f.flow)
        f.bridge.assetByTag.mockResolvedValueOnce(moved(was))
        expect(f.flow.runner.askUndo()).toBe('')
        await f.flow.runner.undo()
        return f
      }

      it('checks it in, then back out to the previous User with the old Status Label and Expected Checkin', async () => {
        const { flow, checkins, checkouts } = await undone(blakes('NOMMA-1'))
        expect(checkins.slice(1)).toEqual([[1, { note: '[Undo] Bulk checkout' }]])
        expect(checkouts.slice(1)).toEqual([[1, { targetType: 'user', targetId: 8, statusId: 2, expectedCheckin: '2026-12-18', note: '[Undo] Bulk checkout' }]])
        expect(flow.runner.rows[0].result).toEqual({ state: 'undone' })
      })

      it('puts it back to a Location or an Asset, with no Expected Checkin when it had none', async () => {
        const room = await undone(asset('NOMMA-2', { assignee: { type: 'location', id: 4, name: 'Room 204' } }))
        expect(room.checkouts[1]).toEqual([2, { targetType: 'location', targetId: 4, statusId: 2, expectedCheckin: undefined, note: '[Undo] Bulk checkout' }])
        const cart = await undone(asset('NOMMA-3', { assignee: { type: 'asset', id: 40, name: 'Cart 2' } }))
        expect(cart.checkouts[1]).toEqual([3, { targetType: 'asset', targetId: 40, statusId: 2, expectedCheckin: undefined, note: '[Undo] Bulk checkout' }])
      })

      it('carries the Temp checkout tag when the old Expected Checkin had a time of day', async () => {
        const { checkouts } = await undone(blakes('NOMMA-1', { expectedCheckin: '2026-10-12 14:50' }))
        expect(checkouts[1][1]).toMatchObject({ expectedCheckin: '2026-10-12 14:50', note: '[Undo] Bulk checkout [Temp checkout | due: 2026-10-12 14:50]' })
      })

      it('a failed re-checkout says so in red and leaves it checked in', async () => {
        const f = await choosing([blakes('NOMMA-1')])
        f.flow.runner.fixOpen()
        await settled(f.flow)
        f.bridge.assetByTag.mockResolvedValueOnce(moved(blakes('NOMMA-1')))
        f.bridge.checkout.mockRejectedValueOnce(new Error('User does not exist.'))
        f.flow.runner.askUndo()
        await f.flow.runner.undo()
        expect(f.flow.runner.rows[0]).toMatchObject({ result: { state: 'done' }, undoFailed: 'Checked in from Avery Testwell, but checkout back to Blake Sampleton failed: User does not exist.' })
        expect(f.checkins).toHaveLength(2)
        expect(f.failed).toHaveBeenCalled()
      })

      it('stops between its Checkin and Checkout when Settings point at another server meanwhile', async () => {
        const f = await choosing([blakes('NOMMA-1')])
        f.flow.runner.fixOpen()
        await settled(f.flow)
        f.bridge.assetByTag.mockResolvedValueOnce(moved(blakes('NOMMA-1')))
        let release = () => {}
        f.bridge.checkin.mockImplementationOnce(() => new Promise<void>((r) => { release = r }))
        f.flow.runner.askUndo()
        const undo = f.flow.runner.undo()
        await vi.waitFor(() => expect(f.bridge.checkin).toHaveBeenCalledTimes(2))
        f.flow.reset()
        release()
        await undo
        expect(f.checkouts).toHaveLength(1)
      })

      it("refuses when the key may no longer check it in or out, or its label can't be checked out now, and writes nothing", async () => {
        const f = await choosing([blakes('NOMMA-1')])
        f.flow.runner.fixOpen()
        await settled(f.flow)
        f.bridge.assetByTag.mockResolvedValueOnce({ ...moved(blakes('NOMMA-1')), can: { checkout: false, checkin: true, update: true, delete: true } })
        f.flow.runner.askUndo()
        await f.flow.runner.undo()
        expect(f.flow.runner.rows[0].undoFailed).toBe(NOT_ALLOWED)
        f.bridge.assetByTag.mockResolvedValueOnce({ ...moved(blakes('NOMMA-1')), statusType: 'pending' })
        f.flow.runner.askUndo()
        await f.flow.runner.undo()
        expect(f.flow.runner.rows[0].undoFailed).toBe("NOMMA-1 is 'Deployed' now")
        expect(f.checkins).toHaveLength(1)
      })

      it('refuses when it is no longer checked out to this User, and writes nothing', async () => {
        const f = await choosing([blakes('NOMMA-1')])
        f.flow.runner.fixOpen()
        await settled(f.flow)
        f.bridge.assetByTag.mockResolvedValueOnce(blakes('NOMMA-1'))
        f.flow.runner.askUndo()
        await f.flow.runner.undo()
        expect(f.flow.runner.rows[0].undoFailed).toBe('NOMMA-1 is no longer checked out to Avery Testwell')
        expect(f.checkins).toHaveLength(1)
      })
    })
  })

  describe('Undo last', () => {
    async function checkedOut() {
      const f = await scanning([ready('NOMMA-1')])
      f.flow.scan('NOMMA-1')
      await opened(f.flow)
      f.flow.runner.confirmOpen()
      await settled(f.flow)
      return f
    }
    const now = (more: Partial<Asset> = {}) => ready('NOMMA-1', { assignee: { type: 'user', id: 7, name: 'Avery Testwell' }, statusMeta: 'deployed', location: 'Room 204', locationId: 4, ...more })

    it('checks it in, putting back the Status Label and Location it had, with the [Undo] note', async () => {
      const { flow, bridge, checkins } = await checkedOut()
      bridge.assetByTag.mockResolvedValueOnce(now())
      expect(flow.runner.askUndo()).toBe('')
      expect(flow.runner.confirm).toBe('Undo: NOMMA-1 → Avery Testwell? Enter to undo, Esc to cancel.')
      await flow.runner.undo()
      expect(checkins).toEqual([[1, { statusId: 1, locationId: 3, note: '[Undo] Bulk checkout' }]])
      expect(flow.runner.rows[0].result).toEqual({ state: 'undone' })
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

describe('Repair intake', () => {
  const DAMAGED: StatusLabel = { id: 9, name: 'damaged' }
  const clock = () => new Date(2026, 9, 11, 10, 30)
  const LINE = '[2026-10-11] [NOMMA-1] damaged – cracked screen (by D. Tech)'
  // A fake Snipe-IT with a Status Label named Damaged. Assets are checked out to Avery Testwell unless told otherwise.
  function withDamaged(assets: Asset[]) {
    const fake = fakeBridge(assets)
    fake.bridge.statusLabels.mockImplementation(async () => (fake.calls.push('statusLabels'), [...LABELS, DAMAGED]))
    return fake
  }
  // Opened, with the Maintenance type the fallback chain finds (none: null).
  async function opened(assets: Asset[], typeId: number | null = 9) {
    const fake = withDamaged(assets)
    fake.bridge.repairTypeId.mockImplementation(async (fallback) => (fake.calls.push(`repair type ${fallback}`), typeId))
    const failed = vi.fn()
    const flow = createRepairIntake(fake.bridge, { changed: () => {}, failed }, clock, 0)
    await flow.open(null)
    expect(flow.blocked).toBe('')
    return { ...fake, flow, failed }
  }
  const confirming = async (flow: { runner: { open: unknown } }) => vi.waitFor(() => expect(flow.runner.open).not.toBeNull())
  const settled = async (flow: { runner: { pending: number } }) => vi.waitFor(() => expect(flow.runner.pending).toBe(0))
  // Scans the tag, says what happened and confirms; resolves once the write is done.
  async function intake(flow: Awaited<ReturnType<typeof opened>>['flow'], tag: string, note = 'cracked screen') {
    expect(flow.scan(tag)).toBe('')
    await confirming(flow)
    expect(await flow.runner.submitText(note, null)).toBe('')
    await settled(flow)
    return flow.runner.rows[0]
  }

  it('finds Damaged by name, ignoring case, the Operator and the Maintenance type once, when it opens; the type is looked for again until found', async () => {
    const { bridge, calls } = withDamaged([])
    bridge.repairTypeId.mockImplementationOnce(async (fallback) => (calls.push(`repair type ${fallback}`), null))
    const flow = createRepairIntake(bridge, { changed: () => {} }, clock, 0)
    await flow.open(null)
    await flow.open(12)
    await flow.open(12)
    expect(calls).toEqual(['me', 'statusLabels', 'repair type null', 'repair type 12'])
    // A changed Settings id (say, a wrong one corrected) is looked up with again.
    await flow.open(13)
    expect(calls.slice(4)).toEqual(['repair type 13'])
  })

  it('after Settings are saved, "(by …)" is read again, since a new API token may be another Operator', async () => {
    const { flow, calls } = await opened([])
    await flow.open(null)
    expect(calls.filter((c) => c === 'me')).toHaveLength(1)
    flow.forgetOperator()
    await flow.open(null)
    expect(calls.filter((c) => c === 'me')).toHaveLength(2)
  })

  it('with no Status Label named Damaged, opens to a blocking message and takes no scans', async () => {
    const fake = fakeBridge([asset('NOMMA-1')])
    const flow = createRepairIntake(fake.bridge, { changed: () => {} }, clock, 0)
    await flow.open(null)
    expect(flow.blocked).toBe("No Status Label named 'Damaged' in Snipe-IT; ask an admin to create one")
    expect(flow.scan('NOMMA-1')).toBe(flow.blocked)
    expect(flow.runner.rows).toEqual([])
    // Created since: the next open finds it.
    fake.bridge.statusLabels.mockResolvedValue([...LABELS, DAMAGED])
    await flow.open(null)
    expect(flow.blocked).toBe('')
  })

  it('the confirm says exactly what will be written, and the note is required: Enter or a rescan with it empty writes nothing', async () => {
    const { flow, calls } = await opened([asset('NOMMA-1')])
    flow.scan('NOMMA-1')
    await confirming(flow)
    expect(flow.runner.open).toMatchObject({ needs: 'Say what happened', says: "Check in from Avery Testwell, mark Damaged, open a repair Maintenance, add a line to Avery Testwell's notes" })
    expect(flow.runner.open!.row.what).toBe('From Avery Testwell')
    expect(flow.runner.confirmOpen()).toBe('Say what happened')
    expect(flow.scan('NOMMA-1')).toBe('Say what happened')
    expect(await flow.runner.submitText('  ', null)).toBe('Say what happened')
    await flush()
    expect(flow.runner.open).not.toBeNull()
    expect(calls).toEqual(['me', 'statusLabels', 'repair type null', 'bytag NOMMA-1'])
  })

  it('refuses without a confirm: already Damaged and not checked out, or a key that can\'t do the first step', async () => {
    const { flow, calls, failed } = await opened([
      asset('NOMMA-1', { assignee: null, status: 'damaged', statusId: 9, statusType: 'undeployable' }),
      asset('NOMMA-2', { can: { checkout: true, checkin: false, update: true, delete: true } }),
      asset('NOMMA-3', { assignee: null, statusId: 1, can: { checkout: true, checkin: true, update: false, delete: true } }),
    ])
    flow.scan('NOMMA-1')
    flow.scan('NOMMA-2')
    flow.scan('NOMMA-3')
    await settled(flow)
    expect(flow.runner.open).toBeNull()
    expect(flow.runner.rows.map((r) => r.result)).toEqual([{ state: 'failed', reason: NOT_ALLOWED }, { state: 'failed', reason: NOT_ALLOWED }, { state: 'failed', reason: 'Already Damaged: nothing to do' }])
    expect(failed).toHaveBeenCalledTimes(3)
    expect(calls.filter((c) => !c.startsWith('bytag')).slice(3)).toEqual([])
  })

  it('a User held it: Checkin as Damaged with the note, a repair Maintenance, then the User notes line', async () => {
    const { flow, calls, checkins } = await opened([asset('NOMMA-1')])
    const row = await intake(flow, 'NOMMA-1', 'cracked   screen\n')
    expect(checkins).toEqual([[1, { statusId: 9, note: '[Repair intake] cracked screen' }]])
    expect(calls.slice(3)).toEqual([
      'bytag NOMMA-1', 'bytag NOMMA-1', 'checkin 1', 'open maintenances 1',
      'maintenance 1 type 9 "NOMMA-1 damaged" 2026-10-11 [Repair intake] cracked screen', `user notes 7 ${LINE}`,
    ])
    expect(row).toMatchObject({ what: 'Damaged, from Avery Testwell', result: { state: 'done', text: 'cracked screen' }, sub: ['Maintenance opened', 'User note added'] })
    expect(row.copy).toBeUndefined()
    // Not undone here: Undo last for Repair intake comes later.
    expect(flow.runner.undoBlocked).toBe('Nothing to undo')
  })

  it('a Location held it: Checkin and the Maintenance, with no User notes line', async () => {
    const { flow, calls } = await opened([asset('NOMMA-1', { assignee: { type: 'location', id: 4, name: 'Room 204' } })])
    flow.scan('NOMMA-1')
    await confirming(flow)
    expect(flow.runner.open!.says).toBe('Check in from Room 204, mark Damaged, open a repair Maintenance')
    await flow.runner.submitText('cracked screen', null)
    await settled(flow)
    expect(calls.slice(5)).toEqual(['checkin 1', 'open maintenances 1', 'maintenance 1 type 9 "NOMMA-1 damaged" 2026-10-11 [Repair intake] cracked screen'])
    expect(flow.runner.rows[0]).toMatchObject({ what: 'Damaged, from Room 204', sub: ['Maintenance opened', 'User note: no User'] })
  })

  it("not checked out: the Status Label, then the note in its History, then the Maintenance (already Damaged but checked out is checked in as normal)", async () => {
    // A key that can't check in can still take in an Asset that isn't checked out: that's an edit, not a Checkin.
    const noCheckin = { checkout: true, checkin: false, update: true, delete: true }
    const { flow, calls, checkins } = await opened([asset('NOMMA-1', { assignee: null, status: 'Ready to Deploy', statusId: 1, statusType: 'deployable', can: noCheckin }), asset('NOMMA-2', { status: 'damaged', statusId: 9 })])
    flow.scan('NOMMA-1')
    await confirming(flow)
    expect(flow.runner.open!.says).toBe('Mark Damaged, add the note to its History, open a repair Maintenance')
    await flow.runner.submitText('cracked screen', null)
    await settled(flow)
    expect(calls.slice(5)).toEqual(['status 1 9', 'note 1 [Repair intake] cracked screen', 'open maintenances 1', 'maintenance 1 type 9 "NOMMA-1 damaged" 2026-10-11 [Repair intake] cracked screen'])
    expect(flow.runner.rows[0]).toMatchObject({ what: "Damaged (wasn't checked out)", sub: ['Maintenance opened', 'User note: no User'] })
    await intake(flow, 'NOMMA-2')
    expect(checkins).toEqual([[2, { statusId: 9, note: '[Repair intake] cracked screen' }]])
  })

  it('an open Repair Maintenance is reused, never a second one', async () => {
    const { flow, bridge, calls } = await opened([asset('NOMMA-1')])
    bridge.openMaintenances.mockResolvedValueOnce([{ id: 50, type: { id: 2, name: 'Upgrade' } }, { id: 51, type: { id: 9, name: 'Repair' } }])
    const row = await intake(flow, 'NOMMA-1')
    expect(calls.some((c) => c.startsWith('maintenance '))).toBe(false)
    expect(row.sub).toEqual(['Maintenance already open', 'User note added'])
  })

  it('with no Repair type found, rows say so and the rest still happens', async () => {
    const { flow, calls } = await opened([asset('NOMMA-1')], null)
    flow.scan('NOMMA-1')
    await confirming(flow)
    expect(flow.runner.open!.says).toContain('no Maintenance (no Repair type found)')
    await flow.runner.submitText('cracked screen', null)
    await settled(flow)
    expect(calls.some((c) => c.includes('maintenance'))).toBe(false)
    expect(flow.runner.rows[0].sub).toEqual(['Maintenance not opened: no Repair type found', 'User note added'])
  })

  it('a later step that fails leaves the earlier ones done and says why; a skipped User note offers its line to copy', async () => {
    const { flow, bridge, calls } = await opened([asset('NOMMA-1'), asset('NOMMA-2', { assignee: null, status: 'Ready to Deploy', statusId: 1 })])
    bridge.createMaintenance.mockRejectedValueOnce(new Error('The selected maintenance type id is invalid.'))
    bridge.appendUserNotes.mockRejectedValueOnce(new Error("the User's notes have formatting the app can't keep"))
    const row = await intake(flow, 'NOMMA-1')
    expect(calls.filter((c) => c.startsWith('checkin'))).toEqual(['checkin 1'])
    expect(row).toMatchObject({
      result: { state: 'done', text: 'cracked screen' },
      sub: ['Maintenance not opened: The selected maintenance type id is invalid.', "User note skipped: the User's notes have formatting the app can't keep"],
      copy: LINE,
    })
    bridge.addAssetNote.mockRejectedValueOnce(new Error('Snipe-IT returned HTTP 500'))
    bridge.openMaintenances.mockRejectedValueOnce(new Error("Can't reach Snipe-IT"))
    expect((await intake(flow, 'NOMMA-2')).sub).toEqual(['Asset note not added: Snipe-IT returned HTTP 500', "Maintenance not opened: Can't reach Snipe-IT", 'User note: no User'])
  })

  it("the Operator's name failing to load never blocks scans: it's read again for the User notes line", async () => {
    const fake = withDamaged([asset('NOMMA-1'), asset('NOMMA-2')])
    fake.bridge.operatorName.mockRejectedValueOnce(new Error("Can't reach Snipe-IT")).mockRejectedValueOnce(new Error("couldn't read your name from Snipe-IT"))
    const flow = createRepairIntake(fake.bridge, { changed: () => {} }, clock, 0)
    await flow.open(null)
    expect(flow.blocked).toBe('')
    const row = await intake(flow, 'NOMMA-1')
    expect(row).toMatchObject({ result: { state: 'done' }, sub: ['Maintenance opened', "User note skipped: couldn't read your name from Snipe-IT"] })
    expect(row.copy).toBeUndefined()
    expect((await intake(flow, 'NOMMA-2')).sub).toEqual(['Maintenance opened', 'User note added'])
    expect(fake.calls.filter((c) => c.startsWith('user notes'))).toEqual([`user notes 7 ${LINE.replace('NOMMA-1', 'NOMMA-2')}`])
  })

  it('Settings pointing at another server mid-intake stop it before its next step', async () => {
    const { flow, bridge, calls } = await opened([asset('NOMMA-1')])
    let release = () => {}
    bridge.checkin.mockImplementationOnce(async (id) => { calls.push(`checkin ${id}`); await new Promise<void>((r) => { release = r }) })
    flow.scan('NOMMA-1')
    await confirming(flow)
    await flow.runner.submitText('cracked screen', null)
    await vi.waitFor(() => expect(calls.at(-1)).toBe('checkin 1'))
    flow.reset()
    release()
    await flush()
    await flush()
    expect(calls.at(-1)).toBe('checkin 1')
  })

  it('a first step that fails stops there: a red row, nothing else written', async () => {
    const { flow, bridge, calls } = await opened([asset('NOMMA-1')])
    bridge.checkin.mockRejectedValueOnce(new Error('Snipe-IT said no'))
    const row = await intake(flow, 'NOMMA-1')
    expect(row.result).toEqual({ state: 'failed', reason: 'Snipe-IT said no' })
    expect(calls.slice(5)).toEqual([])
  })

  it('refuses the write when the Asset changed hands while the confirm was open', async () => {
    const { flow, bridge, checkins } = await opened([asset('NOMMA-1')])
    flow.scan('NOMMA-1')
    await confirming(flow)
    bridge.assetByTag.mockResolvedValueOnce(asset('NOMMA-1', { assignee: null }))
    await flow.runner.submitText('cracked screen', null)
    await settled(flow)
    expect(flow.runner.rows[0].result).toEqual({ state: 'failed', reason: 'NOMMA-1 changed since it was scanned' })
    expect(checkins).toEqual([])
  })
})
