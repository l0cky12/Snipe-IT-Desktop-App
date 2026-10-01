import { describe, expect, it } from 'vitest'
import { opensPanel } from './App'

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
