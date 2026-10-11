import { describe, expect, it } from 'vitest'
import { layoutFrom, opensPanel } from './App'

const key = (name: string, mods: { ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean } = {}) => ({ key: name, ctrlKey: false, metaKey: false, altKey: false, ...mods })

describe('keys that open the Scan/Search panel', () => {
  it('Ctrl+K opens it from anywhere, even while typing in a field', () => {
    expect(opensPanel(key('k', { ctrlKey: true }), true)).toBe(true)
    expect(opensPanel(key('K', { ctrlKey: true }), false)).toBe(true)
  })

  it('a scanned character opens it when focus is not in a field', () => {
    expect(opensPanel(key('A'), false)).toBe(true)
    expect(opensPanel(key('7'), false)).toBe(true)
  })

  it('typing in a field stays in that field', () => {
    expect(opensPanel(key('A'), true)).toBe(false)
  })

  it('Space, Enter, Tab and other shortcuts keep their usual job', () => {
    for (const k of [' ', 'Enter', 'Tab', 'Escape', 'ArrowDown'])
      expect(opensPanel(key(k), false)).toBe(false)
    expect(opensPanel(key('c', { ctrlKey: true }), false)).toBe(false)
    expect(opensPanel(key('k', { altKey: true }), false)).toBe(false)
  })
})

describe('the stored dashboard layout', () => {
  // As the last version stored it: the Assets bar first among the Inventory Chart's six bars, then the two tables.
  const before = (show: Record<string, boolean>) => JSON.stringify(['users', 'assets', 'licenses', 'accessories', 'consumables', 'components', 'expiring', 'overdue']
    .map((piece) => ({ piece, show: show[piece] ?? true })))

  it("an Operator who hid the Assets bar has the Status Label chart hidden; the Category, Location and Upcoming audits charts are new, so they show", () => {
    expect(layoutFrom(before({ assets: false, licenses: false }))).toEqual([
      { piece: 'assets', show: false }, { piece: 'categories', show: true }, { piece: 'locations', show: true }, { piece: 'audits', show: true },
      { piece: 'users', show: true }, { piece: 'licenses', show: false }, { piece: 'accessories', show: true }, { piece: 'consumables', show: true }, { piece: 'components', show: true },
      { piece: 'expiring', show: true }, { piece: 'overdue', show: true },
    ])
  })

  it('with nothing stored, every piece shows: Charts, then the Inventory Chart, then Tables', () => {
    expect(layoutFrom(null).map((p) => [p.piece, p.show])).toEqual([
      ['assets', true], ['categories', true], ['locations', true], ['audits', true], ['licenses', true], ['accessories', true], ['consumables', true], ['components', true], ['users', true],
      ['overdue', true], ['expiring', true],
    ])
  })

  it('unreadable or unknown entries are dropped', () => {
    expect(layoutFrom('not json')).toEqual(layoutFrom(null))
    expect(layoutFrom(JSON.stringify([{ piece: 'gone', show: false }, null]))).toEqual(layoutFrom(null))
  })
})
