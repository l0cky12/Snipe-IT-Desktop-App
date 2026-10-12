import { describe, expect, it } from 'vitest'
import type { Settings } from '../../main/config'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { CheckinForm, CheckoutForm, defaultLocationChoice, ifShowing, layoutFrom, reloadPanel, opensAt, panelTakesFocus, routeKey, startsOver, StatusForm } from './App'

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
  it('keeps a newer open of the same Asset (a Quick Action form), so its typed inputs are not wiped', () => {
    const newer = on(7, 5)
    expect(ifShowing(newer, 7, reload, 4)).toBe(newer)
    expect(ifShowing(newer, 7, reload, 5)).toEqual(on(7, 6))
  })
  it('reloads in place, the same open (its key), so a form opened from its header meanwhile is not remounted away', () => {
    const shown = { asset: { id: 7, name: 'old' }, n: 5, form: 'checkin' as const }
    expect(reloadPanel(shown, 7, 5, { id: 7, name: 'new' })).toEqual({ ...shown, asset: { id: 7, name: 'new' } })
    expect(reloadPanel(shown, 7, 4, { id: 7, name: 'new' })).toBe(shown)
  })
})

describe('a Quick Action form opening in the Asset panel', () => {
  const asset = { id: 1, assetTag: 'T1', statusId: 1, assignee: { id: 2, name: 'Fake', type: 'user' }, can: { checkin: true }, defaultLocation: '' } as unknown as Parameters<typeof StatusForm>[0]['asset']
  const forms = (autoFocus?: boolean) => [
    createElement(CheckinForm, { defaultLocation: null, locations: [], asset, statusLabels: [], onCheckin: async () => {}, autoFocus }),
    createElement(CheckoutForm, { defaultLocation: null, onCheckout: async () => {}, autoFocus }),
    createElement(StatusForm, { asset, statusLabels: [], onSave: async () => {}, autoFocus }),
  ].map((f) => renderToStaticMarkup(f))

  it('leaves focus in a Scan box holding text, so the rest of the scan is not typed into the form', () => {
    for (const html of forms(false)) expect(html).not.toContain('autofocus')
  })

  it('takes focus otherwise, as it always has', () => {
    for (const html of forms(true)) expect(html).toContain('autofocus')
    for (const html of forms()) expect(html).toContain('autofocus')
  })
})

describe('the stored dashboard layout', () => {
  // As the last version stored it: the Assets bar first among the Inventory Chart's six bars, then the two tables.
  const before = (show: Record<string, boolean>) => JSON.stringify(['users', 'assets', 'licenses', 'accessories', 'consumables', 'components', 'expiring', 'overdue']
    .map((piece) => ({ piece, show: show[piece] ?? true })))

  it("an Operator who hid the Assets bar has the Status Label chart hidden; the Category and Location charts are new, so they show", () => {
    expect(layoutFrom(before({ assets: false, licenses: false }))).toEqual([
      { piece: 'assets', show: false }, { piece: 'categories', show: true }, { piece: 'locations', show: true },
      { piece: 'users', show: true }, { piece: 'licenses', show: false }, { piece: 'accessories', show: true }, { piece: 'consumables', show: true }, { piece: 'components', show: true },
      { piece: 'expiring', show: true }, { piece: 'overdue', show: true },
    ])
  })

  it('with nothing stored, every piece shows: Charts, then the Inventory Chart, then Tables', () => {
    expect(layoutFrom(null).map((p) => [p.piece, p.show])).toEqual([
      ['assets', true], ['categories', true], ['locations', true], ['licenses', true], ['accessories', true], ['consumables', true], ['components', true], ['users', true],
      ['overdue', true], ['expiring', true],
    ])
  })

  it('unreadable or unknown entries are dropped', () => {
    expect(layoutFrom('not json')).toEqual(layoutFrom(null))
    expect(layoutFrom(JSON.stringify([{ piece: 'gone', show: false }, null]))).toEqual(layoutFrom(null))
  })
})
