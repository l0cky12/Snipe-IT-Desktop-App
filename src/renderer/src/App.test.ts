import { describe, expect, it } from 'vitest'
import type { Settings } from '../../main/config'
import { defaultLocationChoice, layoutFrom, routeKey, startsOver } from './App'

const key = (name: string, mods: { ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean } = {}) => ({ key: name, ctrlKey: false, metaKey: false, altKey: false, ...mods })

describe('keys that open the Scan/Search panel', () => {
  it('Ctrl+K opens it from anywhere, even while typing in a field', () => {
    expect(routeKey(key('k', { ctrlKey: true }), true)).toBe('panel')
    expect(routeKey(key('K', { ctrlKey: true }), false)).toBe('panel')
  })

  it('a scanned character opens it when focus is not in a field', () => {
    expect(routeKey(key('A'), false)).toBe('panel')
    expect(routeKey(key('7'), false)).toBe('panel')
  })

  it('typing in a field stays in that field', () => {
    expect(routeKey(key('A'), true)).toBe(null)
  })

  it('Space, Enter, Tab and other shortcuts keep their usual job', () => {
    for (const k of [' ', 'Enter', 'Tab', 'Escape', 'ArrowDown'])
      expect(routeKey(key(k), false)).toBe(null)
    expect(routeKey(key('c', { ctrlKey: true }), false)).toBe(null)
    expect(routeKey(key('k', { altKey: true }), false)).toBe(null)
  })
})

describe('keys on and into Workflows', () => {
  it('Ctrl+1–5 open their Workflow in glossary order, from anywhere, including inside a field', () => {
    expect(routeKey(key('2', { ctrlKey: true }), true)).toBe('Bulk return')
    expect(routeKey(key('1', { ctrlKey: true }), false, true)).toBe('Bulk checkout')
    expect(routeKey(key('5', { ctrlKey: true }), true)).toBe('Temp checkout')
    for (const k of ['0', '6']) expect(routeKey(key(k, { ctrlKey: true }), false)).toBe(null)
    expect(routeKey(key('2', { ctrlKey: true, altKey: true }), false)).toBe(null)
  })

  it("typing outside a field on a Workflow page goes to the Workflow's field, not the Scan/Search panel", () => {
    expect(routeKey(key('N'), false, true)).toBe('workflow field')
    expect(routeKey(key('N'), true, true)).toBe(null)
    expect(routeKey(key('Enter'), false, true)).toBe(null)
  })

  it('Ctrl+K still opens Lookup on a Workflow page; it never feeds the Workflow', () => {
    expect(routeKey(key('k', { ctrlKey: true }), true, true)).toBe('panel')
    expect(routeKey(key('k', { ctrlKey: true }), false, true)).toBe('panel')
  })
})

describe('which Settings saves start the session over', () => {
  const before = { baseUrl: 'https://snipe.example.org', hasToken: true, mail: { host: 'smtp.example.org' }, background: { tray: false } } as Settings
  it('saving Email or Background settings, or a new key for the same server, keeps Workflow state', () => {
    expect(startsOver(before, { ...before, mail: { ...before.mail, host: 'smtp2.example.org' } })).toBe(false)
    expect(startsOver(before, { ...before, background: { tray: true, startAtLogin: false } })).toBe(false)
    expect(startsOver(before, { ...before })).toBe(false)
  })

  it('a different server URL, or logging out, clears it', () => {
    expect(startsOver(before, { ...before, baseUrl: 'https://other.example.org' })).toBe(true)
    expect(startsOver(before, { ...before, hasToken: false })).toBe(true)
  })
})

describe("the Checkin form's empty Location choice", () => {
  // Snipe-IT moves an Asset checked in with no Location to its Default Location, or to none.
  it("names the Asset's Default Location when it has one", () => {
    expect(defaultLocationChoice('IT Office')).toBe('Default Location (IT Office)')
  })

  it('says No Location when the Asset has no Default Location', () => {
    expect(defaultLocationChoice('')).toBe('No Location')
  })
})

describe('the stored dashboard layout', () => {
  // As the last version stored it: the Assets bar first among the Inventory Chart's six bars, then the two tables.
  const before = (show: Record<string, boolean>) => JSON.stringify(['users', 'assets', 'licenses', 'accessories', 'consumables', 'components', 'expiring', 'overdue']
    .map((piece) => ({ piece, show: show[piece] ?? true })))

  it("an Operator who hid the Assets bar has the Status Label chart hidden; the Checkouts, Category and Location charts are new, so they show", () => {
    expect(layoutFrom(before({ assets: false, licenses: false }))).toEqual([
      { piece: 'assets', show: false }, { piece: 'checkouts', show: true }, { piece: 'categories', show: true }, { piece: 'locations', show: true },
      { piece: 'users', show: true }, { piece: 'licenses', show: false }, { piece: 'accessories', show: true }, { piece: 'consumables', show: true }, { piece: 'components', show: true },
      { piece: 'expiring', show: true }, { piece: 'overdue', show: true },
    ])
  })

  it('with nothing stored, every piece shows: Charts, then the Inventory Chart, then Tables', () => {
    expect(layoutFrom(null).map((p) => [p.piece, p.show])).toEqual([
      ['assets', true], ['checkouts', true], ['categories', true], ['locations', true], ['licenses', true], ['accessories', true], ['consumables', true], ['components', true], ['users', true],
      ['overdue', true], ['expiring', true],
    ])
  })

  it('unreadable or unknown entries are dropped', () => {
    expect(layoutFrom('not json')).toEqual(layoutFrom(null))
    expect(layoutFrom(JSON.stringify([{ piece: 'gone', show: false }, null]))).toEqual(layoutFrom(null))
  })
})
