import { describe, expect, it } from 'vitest'
import type { Settings } from '../../main/config'
import { defaultLocationChoice, routeKey, startsOver } from './App'

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
