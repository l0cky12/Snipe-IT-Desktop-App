import { describe, expect, it } from 'vitest'
import type { CheckinOptions, CheckoutOptions } from '../../main/snipeit'
import { allMatching, cantCheckin, cantCheckout, checkinAction, checkoutAction, choices, confirmSelectAll, deleteQuestion, eachInTurn, filterPick, holdsStudentInfo, mayDelete, mayEdit, pageTicks, progress, refreshed, retrying, tick, type BulkRun, type Outcome } from './ListView'

describe('filter boxes', () => {
  const location = { label: 'Any Location', options: [{ value: '4', label: 'Room 1201' }, { value: '9', label: 'Room 12' }] }

  it('a whole name picks that choice, even when it starts another', () => {
    expect(filterPick(location, 'Room 12')).toBe('9')
    expect(filterPick(location, 'Room 1201')).toBe('4')
  })

  it('part of a name picks nothing yet, so the List keeps its filter while the Operator types', () => {
    expect(filterPick(location, 'Room 120')).toBeNull()
  })

  it('choices with the same name each get their id, so either can be picked', () => {
    const twins = { label: 'Any Location', options: [{ value: '3', label: 'Room 101' }, { value: '8', label: 'Room 101' }, { value: '5', label: 'Gym' }] }
    expect(choices(twins).map((o) => o.label)).toEqual(['Room 101 (id 3)', 'Room 101 (id 8)', 'Gym'])
    expect(filterPick(twins, 'Room 101 (id 8)')).toBe('8')
    expect(filterPick(twins, 'Room 101')).toBeNull()
  })

  it('a choice named like the "Any …" prompt can still be picked', () => {
    const odd = { label: 'Any category', options: [{ value: '2', label: 'Any category' }] }
    expect(filterPick(odd, 'Any category (id 2)')).toBe('2')
    expect(filterPick(odd, 'Any category')).toBe('')
  })

  it('case does not matter, as in the datalist, unless two choices differ only by case', () => {
    expect(filterPick(location, 'room 12')).toBe('9')
    expect(filterPick(location, 'any location')).toBe('')
    const cased = { label: 'Any category', options: [{ value: '1', label: 'Lab' }, { value: '2', label: 'LAB' }] }
    expect(filterPick(cased, 'lab')).toBeNull()
    expect(filterPick(cased, 'LAB')).toBe('2')
  })

  it('"Any …" or an empty box clears the filter', () => {
    expect(filterPick(location, 'Any Location')).toBe('')
    expect(filterPick(location, '  ')).toBe('')
  })
})

describe('Selection', () => {
  const row = (id: number) => ({ id, name: `Room ${id}` })
  const page1 = [row(1), row(2), row(3)]
  const page2 = [row(4), row(5)]

  it('ticks stay as the Operator moves between pages', () => {
    let s = tick(new Map(), [page1[0]])
    s = tick(s, page2)
    expect([...s.keys()]).toEqual([1, 4, 5])
    expect(pageTicks(s, page1)).toBe('some')
    expect(pageTicks(s, page2)).toBe('all')
  })

  it('ticking a ticked row, or the box of a fully ticked page, clears just those', () => {
    let s = tick(tick(new Map(), page1), page2)
    s = tick(s, [page1[1]])
    expect([...s.keys()]).toEqual([1, 3, 4, 5])
    s = tick(s, page2)
    expect([...s.keys()]).toEqual([1, 3])
    expect(pageTicks(s, page2)).toBe('none')
  })

  it("a partly ticked page's box ticks the rest of it", () => {
    expect([...tick(tick(new Map(), [page1[0]]), page1).keys()]).toEqual([1, 2, 3])
  })

  it('an empty page has nothing to tick', () => {
    expect(pageTicks(new Map(), [])).toBe('none')
  })

  it('a ticked row reloaded with new values carries them, so a Bulk Action sends what Snipe-IT has now', () => {
    const s = refreshed(tick(new Map(), page1), [{ id: 2, name: 'Room 2 (renamed)' }, row(9)])
    expect([...s.values()]).toEqual([row(1), { id: 2, name: 'Room 2 (renamed)' }, row(3)])
  })

  it('"select all" asks to confirm over 100', () => {
    expect(confirmSelectAll(100)).toBe(false)
    expect(confirmSelectAll(101)).toBe(true)
  })

  it('"select all" fetches every matching page', async () => {
    const all = Array.from({ length: 7 }, (_, i) => row(i + 1))
    const asked: number[] = []
    const s = await allMatching(async (offset) => (asked.push(offset), { total: 7, rows: all.slice(offset, offset + 3) }))
    expect(asked).toEqual([0, 3, 6])
    expect([...s!.keys()]).toEqual([1, 2, 3, 4, 5, 6, 7])
  })

  it('"select all" stops at a page that comes back short', async () => {
    const s = await allMatching(async (offset) => ({ total: 9, rows: offset ? [] : [row(1)] }))
    expect([...s!.keys()]).toEqual([1])
  })

  it('"select all" gives up when the List changes meanwhile', async () => {
    expect(await allMatching(async () => ({ total: 9, rows: [row(1)] }), () => true)).toBeNull()
  })
})

describe('Bulk delete', () => {
  const allowed = { checkout: true, checkin: true, update: true, delete: true }
  const row = (id: number, del = true) => ({ id, can: { ...allowed, delete: del } })

  it('the confirmation names the count and kind', () => {
    expect(deleteQuestion('suppliers', 12)).toBe('Delete 12 Suppliers?')
    expect(deleteQuestion('categories', 1)).toBe('Delete 1 Category?')
    expect(deleteQuestion('assets', 1200)).toBe('Delete 1,200 Assets?')
  })

  it("is offered when Snipe-IT lets the Operator delete what's selected, on every List of Records", () => {
    expect(mayDelete('suppliers', [row(1), row(2)])).toBe(true)
    expect(mayDelete('statuslabels', [row(1)])).toBe(true)
    expect(mayDelete('suppliers', [row(1, false)])).toBe(false)
    expect(mayDelete('activity', [row(1)])).toBe(false)
  })

  it("a Record Snipe-IT won't let go (a User with items checked out) still goes to Snipe-IT, which says why", () => {
    expect(mayDelete('users', [row(1), row(2, false)])).toBe(true)
  })

  const run: BulkRun = {
    busy: false, ids: [1, 2, 3, 4],
    records: [{ id: 1, name: 'CDW', outcome: { state: 'done', text: 'Deleted' } }, { id: 2, name: 'Dell', outcome: { state: 'failed', reason: 'Has Assets' } },
      { id: 3, name: 'HP', outcome: { state: 'working' } }, { id: 4, name: 'Lenovo' }],
  }

  it('progress counts the Records done or failed so far in this run', () => {
    expect(progress(run)).toBe('2 of 4')
  })

  it('"Retry failed" reruns only the failed Records, counting from 0 of them', () => {
    const again = retrying(run)
    expect(again.ids).toEqual([2])
    expect(again.records.map((r) => r.outcome?.state)).toEqual(['done', undefined, 'working', undefined])
    expect(progress(again)).toBe('0 of 1')
  })
})

describe('Bulk edit', () => {
  const row = (id: number, update = true) => ({ id, can: { checkout: true, checkin: true, update, delete: true } })

  it("is offered on a Selection of Assets or Users when Snipe-IT lets the Operator edit what's selected", () => {
    expect(mayEdit('assets', [row(1), row(2)])).toBe(true)
    expect(mayEdit('users', [row(1)])).toBe(true)
    expect(mayEdit('assets', [row(1, false), row(2, false)])).toBe(false)
    expect(mayEdit('locations', [row(1)])).toBe(false)
  })
})

describe('Export CSV', () => {
  it('Lists whose rows hold Users or Assignees need the FERPA confirmation', () => {
    expect(['assets', 'users', 'activity', 'departments'].every((k) => holdsStudentInfo(k as 'assets'))).toBe(true)
    expect(['suppliers', 'locations', 'licenses', 'statuslabels'].some((k) => holdsStudentInfo(k as 'assets'))).toBe(false)
  })
})

describe("a Bulk Action's run", () => {
  it('acts on each Record in turn, reports each outcome, and a failure does not stop the rest', async () => {
    const asked: number[] = []
    const reports: [number, Outcome][] = []
    const work = async (id: number) => {
      asked.push(id)
      if (id === 2) throw new Error('NOMMA-2 is not checked out, so there is nothing to check in.')
    }
    await eachInTurn([1, 2, 3], work, 'Checked in', (id, o) => reports.push([id, o]))
    expect(asked).toEqual([1, 2, 3])
    expect(reports).toEqual([
      [1, { state: 'working' }], [1, { state: 'done', text: 'Checked in' }],
      [2, { state: 'working' }], [2, { state: 'failed', reason: 'NOMMA-2 is not checked out, so there is nothing to check in.' }],
      [3, { state: 'working' }], [3, { state: 'done', text: 'Checked in' }],
    ])
  })

  it('stops before the next Record once told to, e.g. by Stop or when Settings point at another server', async () => {
    const asked: number[] = []
    let stopped = false
    await eachInTurn([1, 2, 3], async (id) => { asked.push(id); stopped = true }, 'Checked out', () => {}, () => stopped)
    expect(asked).toEqual([1])
  })

  it('one at a time: the next Record waits for the one before', async () => {
    let open = 0, most = 0
    await eachInTurn([1, 2, 3], async () => { most = Math.max(most, ++open); await new Promise((r) => setTimeout(r, 2)); open-- }, 'Checked out', () => {})
    expect(most).toBe(1)
  })
})

describe('Checkout… and Checkin… on a Selection of Assets', () => {
  // A fake Snipe-IT: every Checkout and Checkin recorded; NOMMA-2 is refused, as Snipe-IT would.
  const fake = () => {
    const calls: [string, number, CheckoutOptions | CheckinOptions][] = []
    const refuse = (id: number) => { if (id === 2) throw new Error('That asset is not available for checkout!') }
    return {
      calls,
      bridge: {
        checkout: async (id: number, o: CheckoutOptions) => (calls.push(['checkout', id, o]), refuse(id)),
        checkin: async (id: number, o: CheckinOptions) => (calls.push(['checkin', id, o]), refuse(id)),
      },
    }
  }
  const results = async (action: { work: (id: number) => Promise<void>; done: string }) => {
    const out: [number, Outcome][] = []
    await eachInTurn([1, 2, 3], action.work, action.done, (id, o) => o.state !== 'working' && out.push([id, o]))
    return out
  }

  it("Checkout… sends one Checkout per selected Asset with the form's options, and a result for each", async () => {
    const { calls, bridge } = fake()
    const options: CheckoutOptions = { targetType: 'location', targetId: 4, expectedCheckin: '2026-10-16', note: 'Cart to Room 204' }
    const action = checkoutAction(bridge, options)
    expect(action).toMatchObject({ kind: 'assets', title: 'Checkout Assets' })
    expect(await results(action)).toEqual([
      [1, { state: 'done', text: 'Checked out' }], [2, { state: 'failed', reason: 'That asset is not available for checkout!' }], [3, { state: 'done', text: 'Checked out' }],
    ])
    expect(calls).toEqual([1, 2, 3].map((id) => ['checkout', id, options]))
  })

  it("Checkin… sends one Checkin per selected Asset with the form's options, and a result for each", async () => {
    const { calls, bridge } = fake()
    const options: CheckinOptions = { statusId: 1, locationId: undefined, note: 'Back from Room 204' }
    const action = checkinAction(bridge, options)
    expect(action).toMatchObject({ kind: 'assets', title: 'Checkin Assets' })
    expect(await results(action)).toEqual([
      [1, { state: 'done', text: 'Checked in' }], [2, { state: 'failed', reason: 'That asset is not available for checkout!' }], [3, { state: 'done', text: 'Checked in' }],
    ])
    expect(calls).toEqual([1, 2, 3].map((id) => ['checkin', id, options]))
  })

  it("each is off when Snipe-IT says the Operator's key may not do it to any selected Asset", () => {
    const can = (checkout: boolean, checkin: boolean) => ({ can: { checkout, checkin, update: true, delete: true } })
    expect(cantCheckout([can(true, true), can(true, false)])).toBe(false)
    expect(cantCheckout([can(true, true), can(false, true)])).toBe(true)
    expect(cantCheckin([can(true, true), can(false, true)])).toBe(false)
    expect(cantCheckin([can(true, true), can(true, false)])).toBe(true)
  })
})
