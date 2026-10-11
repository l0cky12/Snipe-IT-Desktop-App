import { afterEach, describe, expect, it, vi } from 'vitest'
import { eachInTurn, type Outcome } from './BatchView'
import { auditAction, mayAudit, allMatching, listKey, moveCursor, choices, listQuery, opening, picking, storedColumns, confirmSelectAll, deleteQuestion, filterPick, holdsStudentInfo, mayDelete, numericColumns, mayEdit, pageTicks, progress, refreshed, retrying, tick, type BulkRun } from './ListView'

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
  const allowed = { checkout: true, checkin: true, update: true, delete: true, audit: true }
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
  const row = (id: number, update = true) => ({ id, can: { checkout: true, checkin: true, update, delete: true, audit: true } })

  it("is offered on a Selection of Assets or Users when Snipe-IT lets the Operator edit what's selected", () => {
    expect(mayEdit('assets', [row(1), row(2)])).toBe(true)
    expect(mayEdit('users', [row(1)])).toBe(true)
    expect(mayEdit('assets', [row(1, false), row(2, false)])).toBe(false)
    expect(mayEdit('locations', [row(1)])).toBe(false)
  })
})

describe('Bulk audit', () => {
  const row = (id: number, audit = true) => ({ id, can: { checkout: true, checkin: true, update: true, delete: true, audit } })
  afterEach(() => vi.unstubAllGlobals())

  it('is offered on a Selection of Assets when Snipe-IT lets the Operator audit any of them', () => {
    expect(mayAudit('assets', [row(1, false), row(2)])).toBe(true)
    expect(mayAudit('assets', [row(1, false)])).toBe(false)
    expect(mayAudit('users', [row(1)])).toBe(false)
  })

  it('sends one Audit per Asset, each with the same Next audit and note, and says what each did', async () => {
    const audit = vi.fn(async (id: number) => {
      if (id === 2) throw new Error('You do not have permission to audit this asset.')
      return { was: id === 1 ? '2026-10-01' : null, next: id === 1 ? '2027-10-10' : null }
    })
    vi.stubGlobal('window', { snipeIt: { audit } })
    const action = auditAction({ nextAudit: '2027-10-10', note: 'Room 204' })
    const results: [number, Outcome][] = []
    await eachInTurn([1, 2, 3], action.work, action.done, (id, o) => o.state !== 'working' && results.push([id, o]))
    expect(audit.mock.calls).toEqual([[1, { nextAudit: '2027-10-10', note: 'Room 204' }], [2, { nextAudit: '2027-10-10', note: 'Room 204' }], [3, { nextAudit: '2027-10-10', note: 'Room 204' }]])
    expect(results).toEqual([
      [1, { state: 'done', text: 'Audited, next 2027-10-10, was 2026-10-01' }],
      [2, { state: 'failed', reason: 'You do not have permission to audit this asset.' }],
      [3, { state: 'done', text: 'Audited. Snipe-IT has no audit interval set, so this Asset now has no next audit date' }],
    ])
  })
})

describe('Export CSV', () => {
  it('Lists whose rows hold Users or Assignees need the FERPA confirmation', () => {
    expect(['assets', 'users', 'activity', 'departments'].every((k) => holdsStudentInfo(k as 'assets'))).toBe(true)
    expect(['suppliers', 'locations', 'licenses', 'statuslabels'].some((k) => holdsStudentInfo(k as 'assets'))).toBe(false)
  })
})

describe('columns', () => {
  it('count columns right-align; text columns and empty ones do not', () => {
    const columns = [{ key: 'name', label: 'Name' }, { key: 'assets', label: 'Assets' }, { key: 'parent', label: 'Parent' }]
    const rows = [{ name: 'Library', assets: 12, parent: null }, { name: 'Gym', assets: 0, parent: null }]
    expect([...numericColumns(columns, rows)]).toEqual(['assets'])
  })
})

describe('Assets Views', () => {
  const report = { id: 'r1', name: 'Library carts', kind: 'assets' as const, search: 'cart', filters: { location_id: '2' }, sort: { key: 'name', order: 'asc' as const }, columns: ['assetTag'] }

  it('each View asks for itself with the search, filter boxes and sort; other Lists have no View', () => {
    const state = { view: 'auditLate' as const, search: 'cb', filters: { location_id: '4' }, sort: { key: 'nextAudit', order: 'desc' as const } }
    expect(listQuery('assets', state)).toEqual({ view: 'auditLate', search: 'cb', filters: { location_id: '4' }, sort: 'nextAudit', order: 'desc' })
    expect(listQuery('users', { ...state, view: 'all' })).not.toHaveProperty('view')
  })

  it("Assets' old defaults, stored by the List on every open, give the new defaults; a real pick is kept", () => {
    expect(storedColumns('assets', ['assetTag', 'name', 'status', 'model', 'category', 'location', 'assignee'])).toEqual(['assetTag', 'status', 'model', 'assignee', 'location'])
    expect(storedColumns('assets', ['assetTag', 'name', 'status', 'model', 'location', 'assignee'])).toEqual(['assetTag', 'name', 'status', 'model', 'assignee', 'location'])
    expect(storedColumns('assets', null)).toEqual(['assetTag', 'status', 'model', 'assignee', 'location'])
  })

  it('picking a View starts its search, filter boxes and sort again', () => {
    expect(picking('damaged')).toEqual({ view: 'damaged', search: '', filters: {}, sort: null })
    expect(picking('auditLate')).toEqual({ view: 'auditLate', search: '', filters: {}, sort: { key: 'nextAudit', order: 'asc' } })
  })

  it('a dashboard or Record drill opens on All with its filter; a Saved Report on All with its search and sort', () => {
    expect(opening({ filters: { status_id: '3' } })).toEqual({ view: 'all', search: '', filters: { status_id: '3' }, sort: null })
    expect(opening({ filters: report.filters }, report)).toEqual({ view: 'all', search: 'cart', filters: { location_id: '2' }, sort: { key: 'name', order: 'asc' } })
  })

  it('the Selection survives switching Views, and "Select all N matching" adds the open View\'s Assets to it', async () => {
    const asset = (id: number) => ({ id, name: `NOMMA-${id}` })
    // Ticked on All, then Audit late's first page loads with one of them on it.
    let s = tick(new Map(), [asset(1), asset(2)])
    s = refreshed(s, [{ id: 2, name: 'NOMMA-2 (reloaded)' }, asset(9)])
    expect([...s.values()]).toEqual([asset(1), { id: 2, name: 'NOMMA-2 (reloaded)' }])
    // Select all pages through the open View only.
    const asked: unknown[] = []
    const lateRows = [asset(2), asset(9), asset(12)]
    const query = listQuery('assets', { ...picking('auditLate'), sort: { key: 'id', order: 'asc' } })
    const all = await allMatching(async (offset) => (asked.push({ ...query, offset }), { total: 3, rows: lateRows.slice(offset, offset + 2) }))
    expect(asked).toEqual([0, 2].map((offset) => ({ view: 'auditLate', search: '', filters: {}, sort: 'id', order: 'asc', offset })))
    expect([...new Map([...s, ...all!]).keys()]).toEqual([1, 2, 9, 12])
  })
})

describe('keys on the Assets List', () => {
  const key = (name: string, mods: Partial<Pick<KeyboardEvent, 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>> = {}) =>
    ({ key: name, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods })

  it('↑/↓ move between rows from anywhere but a field, even with a button focused', () => {
    expect(listKey(key('ArrowDown'), 'none', false)).toBe('down')
    expect(listKey(key('ArrowUp'), 'control', false)).toBe('up')
    expect(listKey(key('ArrowDown'), 'field', false)).toBeNull()
  })

  it('Enter opens the focused row, but leaves a focused button or field to do its own job', () => {
    expect(listKey(key('Enter'), 'none', false)).toBe('open')
    expect(listKey(key('Enter'), 'control', false)).toBeNull()
    expect(listKey(key('Enter'), 'field', true)).toBeNull()
  })

  it('Space ticks only when focus is not in a field or on a button', () => {
    expect(listKey(key(' '), 'none', true)).toBe('tick')
    expect(listKey(key(' '), 'control', true)).toBeNull()
    expect(listKey(key(' '), 'field', false)).toBeNull()
  })

  it('Esc closes (or cancels the form in the panel), but a field outside the panel keeps it', () => {
    expect(listKey(key('Escape'), 'none', false)).toBe('close')
    expect(listKey(key('Escape'), 'control', false)).toBe('close')
    expect(listKey(key('Escape'), 'field', true)).toBe('close')
    expect(listKey(key('Escape'), 'field', false)).toBeNull()
  })

  it('with a modifier held, or any other key, nothing happens', () => {
    expect(listKey(key('ArrowDown', { shiftKey: true }), 'none', false)).toBeNull()
    expect(listKey(key(' ', { ctrlKey: true }), 'none', false)).toBeNull()
    expect(listKey(key('a'), 'none', false)).toBeNull()
  })

  it('the focused row moves one at a time and stops at either end of the page', () => {
    const ids = [4, 8, 15]
    expect(moveCursor(ids, 8, 1)).toBe(15)
    expect(moveCursor(ids, 8, -1)).toBe(4)
    expect(moveCursor(ids, 15, 1)).toBe(15)
    expect(moveCursor(ids, 4, -1)).toBe(4)
  })

  it('with no focused row (or one no longer on the page), ↓ starts at the top and ↑ at the bottom', () => {
    expect(moveCursor([4, 8, 15], null, 1)).toBe(4)
    expect(moveCursor([4, 8, 15], 99, -1)).toBe(15)
    expect(moveCursor([], null, 1)).toBeNull()
  })
})
