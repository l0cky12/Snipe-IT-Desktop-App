import { describe, expect, it } from 'vitest'
import { auditedLine, auditedResult, defaultLocationChoice, ifShowing, opensAt, opensPanel, panelTakesFocus } from './App'

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

describe('the Asset panel taking focus as it opens', () => {
  it('leaves a field holding text alone, so a half-typed next scan is kept', () => {
    expect(panelTakesFocus('field', 'AB1')).toBe(false)
  })

  it('takes it from an empty Scan box (an exact scan clears it), a row or nowhere', () => {
    expect(panelTakesFocus('field', '')).toBe(true)
    expect(panelTakesFocus('control', '')).toBe(true)
    expect(panelTakesFocus('none', '')).toBe(true)
  })
})

describe('the Asset panel when a Bulk Action ends', () => {
  const on = (id: number, n = 1) => ({ asset: { id }, n })
  const reload = (p: { asset: { id: number }; n: number }) => ({ asset: { id: p.asset.id }, n: p.n + 1 })

  it('reloads its Asset, or closes after a delete, while it still shows that Asset', () => {
    expect(ifShowing(on(7), 7, reload)).toEqual(on(7, 2))
    expect(ifShowing(on(7), 7, () => null)).toBeNull()
  })

  it('keeps an Asset opened meanwhile (a click on another row), so that open is not superseded', () => {
    const newer = on(9, 5)
    expect(ifShowing(newer, 7, reload)).toBe(newer)
    expect(ifShowing(newer, 7, () => null)).toBe(newer)
    expect(ifShowing(null, 7, reload)).toBeNull()
  })

  it('given the panel it started from, leaves a newer open of the same Asset (a Quick Action form, another server) alone', () => {
    const seen = on(7, 1), newer = on(7, 2)
    expect(ifShowing(newer, 7, reload, seen)).toBe(newer)
    expect(ifShowing(seen, 7, reload, seen)).toEqual(on(7, 2))
    expect(ifShowing(on(7), 7, reload, null)).toEqual(on(7))
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

describe('what an Audit says it did', () => {
  it('gives the next audit date and the one it was, so a mistake can be put back', () => {
    expect(auditedLine({ was: '2026-10-01', next: '2027-10-10' })).toBe('Audited. Next audit 2027-10-10 (was 2026-10-01)')
    expect(auditedLine({ was: null, next: '2027-10-10' })).toBe('Audited. Next audit 2027-10-10 (had none)')
    expect(auditedResult({ was: '2026-10-01', next: '2027-10-10' })).toBe('Audited, next 2027-10-10, was 2026-10-01')
  })

  it('warns when Snipe-IT sent back no next audit date, because it has no audit interval set', () => {
    const warning = 'Audited. Snipe-IT has no audit interval set, so this Asset now has no next audit date (was 2026-10-01)'
    expect(auditedLine({ was: '2026-10-01', next: null })).toBe(warning)
    expect(auditedResult({ was: '2026-10-01', next: null })).toBe(warning)
  })
})
