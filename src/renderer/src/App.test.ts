import { describe, expect, it } from 'vitest'
import type { Settings } from '../../main/config'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { assetFacts, auditedLine, auditedResult, CheckinForm, CopyButton, CheckoutForm, defaultLocationChoice, createdUser, ifShowing, layoutFrom, newUserFrom, RecordsIndex, reloadPanel, opensAt, panelTakesFocus, routeKey, showAuditDay, startsOver, StatusForm } from './App'
import { LayoutGrid } from 'lucide-react'

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
    createElement(CheckoutForm, { defaultLocation: null, onCheckout: async () => {}, onUnfinished: () => {}, autoFocus }),
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

  it("an Operator who hid the Assets bar has the Status Label chart hidden; the Checkouts, Category, Location and Upcoming audits charts are new, so they show", () => {
    expect(layoutFrom(before({ assets: false, licenses: false }))).toEqual([
      { piece: 'assets', show: false }, { piece: 'checkouts', show: true }, { piece: 'categories', show: true }, { piece: 'locations', show: true }, { piece: 'audits', show: true },
      { piece: 'users', show: true }, { piece: 'licenses', show: false }, { piece: 'accessories', show: true }, { piece: 'consumables', show: true }, { piece: 'components', show: true },
      { piece: 'expiring', show: true }, { piece: 'overdue', show: true },
    ])
  })

  it('with nothing stored, every piece shows: Charts, then the Inventory Chart, then Tables', () => {
    expect(layoutFrom(null).map((p) => [p.piece, p.show])).toEqual([
      ['assets', true], ['checkouts', true], ['categories', true], ['locations', true], ['audits', true], ['licenses', true], ['accessories', true], ['consumables', true], ['components', true], ['users', true],
      ['overdue', true], ['expiring', true],
    ])
  })

  it('unreadable or unknown entries are dropped', () => {
    expect(layoutFrom('not json')).toEqual(layoutFrom(null))
    expect(layoutFrom(JSON.stringify([{ piece: 'gone', show: false }, null]))).toEqual(layoutFrom(null))
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

describe('clicking an Upcoming audits day', () => {
  it('discards a lookup or Asset open still loading before showing the day, so it cannot replace the day or leave the dashboard', () => {
    // run()'s pattern: a request is stale once latest moves on; cancel() moves it.
    let latest = 1
    const mine = latest
    const steps: string[] = []
    showAuditDay({ day: '2026-10-19', assets: [{ id: 7 } as never] }, () => (steps.push('cancel'), ++latest), (m) => steps.push(`show ${m.assets.length}`))
    expect(steps).toEqual(['cancel', 'show 1'])
    expect(mine !== latest).toBe(true)
  })
})

describe('Create User… from Checkout', () => {
  it('starts the New User form with the searched name, the last word as the last name', () => {
    expect(newUserFrom('  Pat  Q. Example ')).toEqual({ first_name: 'Pat Q.', last_name: 'Example' })
    expect(newUserFrom('Pat')).toEqual({ first_name: 'Pat' })
  })

  it("leaves the name blank for a scanned number, an email or nothing, which aren't names", () => {
    for (const text of ['40012', 'pat@example.test', 'Pat 2', '', '   ']) expect(newUserFrom(text)).toEqual({})
  })

  it('chooses the created User by the id Snipe-IT returned, named as Snipe-IT names Users', () => {
    expect(createdUser(42, { first_name: 'Pat', last_name: 'Example', username: 'pexample', password: 'x' })).toEqual({ id: 42, name: 'Pat Example', detail: 'pexample' })
    expect(createdUser(43, { first_name: ' Pat ', last_name: '' })).toEqual({ id: 43, name: 'Pat', detail: '' })
  })
})

describe('copying a fact from the Asset panel', () => {
  const asset = {
    name: '', model: 'Fake Book 14', status: 'Ready to Deploy', statusMeta: 'deployable', assignee: { id: 2, name: 'Fake Person', type: 'user' },
    expectedCheckin: null, overdue: null, location: '', lastAudited: null, nextAudit: null, category: 'Laptops', serial: 'FAKE-SERIAL-1',
    purchaseDate: '2026-01-01', warrantyEnd: null, warranty: null,
  } as unknown as Parameters<typeof assetFacts>[0]
  const copies = Object.fromEntries(assetFacts(asset).map(([label, , copy]) => [label, copy]))

  it('copies the value itself, not how it is shown', () => {
    expect(copies).toMatchObject({ 'Asset Model': 'Fake Book 14', Status: 'Ready to Deploy', Assignee: 'Fake Person', Type: 'User', Serial: 'FAKE-SERIAL-1', Purchased: '2026-01-01' })
  })

  it('offers nothing to copy for a fact the Asset has no value for', () => {
    for (const label of ['Name', 'Expected Checkin', 'Location', 'Last audited', 'Next audit', 'Warranty ends']) expect(copies[label]).toBeFalsy()
  })

  it('names the fact on its Copy button', () => {
    expect(renderToStaticMarkup(createElement(CopyButton, { label: 'Serial', text: 'FAKE-SERIAL-1' }))).toContain('aria-label="Copy Serial"')
  })
})

describe('All records', () => {
  const buttons = (pages: { label: string; Icon: typeof LayoutGrid; open: () => void }[]) =>
    [...renderToStaticMarkup(createElement(RecordsIndex, { onGo: () => {}, onGroups: () => {}, pages })).matchAll(/<button[^>]*>(?:<svg.*?<\/svg>)?([^<]*)<\/button>/g)].map((m) => m[1])

  it('lists every List and Permission groups', () => {
    expect(buttons([])).toContain('Assets')
    expect(buttons([])).toContain('Consumables')
    expect(buttons([]).at(-1)).toBe('Permission groups')
  })

  it('also opens the pages hidden from the sidebar, so Settings never strands one', () => {
    expect(buttons([{ label: 'Dashboard', Icon: LayoutGrid, open: () => {} }]).slice(-2)).toEqual(['Permission groups', 'Dashboard'])
  })
})
