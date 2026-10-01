import { describe, expect, it } from 'vitest'
import { allMatching, choices, confirmSelectAll, deleteQuestion, exportTable, filterPick, holdsStudentInfo, mayDelete, mayEdit, pageTicks, progress, refreshed, retrying, shownColumns, tick, type BulkRun } from './ListView'

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

  it('a ticked row reloaded with new values carries them, so Add to Batch sends what Snipe-IT has now', () => {
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
  const can = { checkout: true, checkin: true, update: true, delete: true }
  const asset = {
    id: 1, assetTag: 'NOMMA-1', name: 'CB-01', model: 'HP Chromebook 14 G7', status: 'Deployed', statusId: 2, statusMeta: 'deployed',
    assignee: { type: 'user' as const, id: 311, name: 'Jordan Reyes' }, checkoutAllowed: false, location: 'Library', category: 'Chromebook',
    serial: '5CD1', purchaseDate: null, warrantyEnd: null, expectedCheckin: null, overdueDays: null, warranty: null, can,
  }

  it('holds only the visible Columns, in the order the List shows them', () => {
    const t = exportTable('assets', ['assignee', 'assetTag', 'status', 'serial'], [asset])
    expect(t.columns).toEqual(['Asset Tag', 'Status', 'Assignee', 'Serial'])
    expect(t.rows).toEqual([['NOMMA-1', 'Deployed', 'Jordan Reyes', '5CD1']])
  })

  it('cells are the text the List shows: names, not records; empty, not a dash', () => {
    const t = exportTable('assets', ['assetTag', 'assignee', 'expectedCheckin', 'location'], [{ ...asset, assignee: null, location: '' }])
    expect(t.rows).toEqual([['NOMMA-1', '', '', '']])
    const activity = { id: 7, when: '2026-08-17 15:40', action: 'Checkin', operator: 'E. Caldwell', detail: 'from Sam Whitaker', note: 'keyboard sticky', item: { type: 'asset', id: 4812, name: 'CB-LIB-012' }, can }
    expect(exportTable('activity', ['when', 'item', 'note'], [activity]).rows).toEqual([['2026-08-17 15:40', 'CB-LIB-012', 'keyboard sticky']])
    expect(exportTable('statuslabels', ['name', 'type', 'assets'], [{ id: 1, name: 'Broken', type: 'undeployable', assets: 3, can }]).rows).toEqual([['Broken', 'Undeployable', '3']])
  })

  it('Lists whose rows hold Users or Assignees need the FERPA confirmation', () => {
    expect(['assets', 'users', 'activity', 'departments'].every((k) => holdsStudentInfo(k as 'assets'))).toBe(true)
    expect(['suppliers', 'locations', 'licenses', 'statuslabels'].some((k) => holdsStudentInfo(k as 'assets'))).toBe(false)
  })
})

describe('a Saved Report opened again', () => {
  it('shows its Columns in the List order, always the first, without ones the List no longer has', () => {
    expect(shownColumns('assets', ['serial', 'gone', 'status'])).toEqual(['assetTag', 'status', 'serial'])
    expect(shownColumns('users', null)).toEqual(['name', 'username', 'department', 'location', 'assets'])
  })
})
