import { describe, expect, it } from 'vitest'
import { opensAt, opensPanel } from './App'

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

describe('where a scanned or picked Asset opens', () => {
  const assets = { page: 'assets', n: 3 }

  it('on the Assets List it docks in the Asset panel and the List stays the same, so its View, page and Selection stay', () => {
    const at = opensAt(assets, false)
    expect(at.docked).toBe(true)
    expect(at.view).toBe(assets)
  })

  it('on any other page it opens the full Asset sheet in place of the page', () => {
    for (const view of [{ page: 'dashboard' }, { page: 'users', n: 1 }, { page: 'record', n: 2 }, null])
      expect(opensAt(view, false)).toEqual({ docked: false, view: null })
  })

  it('with Settings showing it opens the sheet, even if the Assets List is behind them', () => {
    expect(opensAt(assets, true)).toEqual({ docked: false, view: null })
  })
})
