import { describe, expect, it } from 'vitest'
import { allMatching, choices, confirmSelectAll, filterPick, pageTicks, refreshed, tick } from './ListView'

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
