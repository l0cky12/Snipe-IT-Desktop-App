import { describe, expect, it } from 'vitest'
import { exportTable, shownColumns, toCsv } from './export'

describe('CSV export', () => {
  it('quotes every cell, doubles quotes, keeps commas and line breaks, and marks it UTF-8 for Excel', () => {
    expect(toCsv(['Asset Tag', 'Note'], [['NOMMA-1', 'Charger, "65W"\nincluded']])).toBe('\uFEFF"Asset Tag","Note"\r\n"NOMMA-1","Charger, ""65W""\nincluded"\r\n')
  })

  it("a cell a spreadsheet would run as a formula can't become one", () => {
    expect(toCsv(['Note'], [['=HYPERLINK("http://x")'], ['+1'], ['-2'], ['@SUM(A1)'], ['plain']]).split('\r\n').slice(1, 6))
      .toEqual(['"\'=HYPERLINK(""http://x"")"', '"\'+1"', '"\'-2"', '"\'@SUM(A1)"', '"plain"'])
  })
})

describe('Export CSV', () => {
  const can = { checkout: true, checkin: true, update: true, delete: true }
  const asset = {
    id: 1, assetTag: 'NOMMA-1', name: 'CB-01', model: 'HP Chromebook 14 G7', status: 'Deployed', statusId: 2, statusMeta: 'deployed',
    assignee: { type: 'user' as const, id: 311, name: 'Jordan Reyes' }, checkoutAllowed: false, location: 'Library', category: 'Chromebook',
    serial: '5CD1', purchaseDate: null, warrantyEnd: null, expectedCheckin: null, overdueDays: null, warranty: null, can,
  }

  it('holds only the visible Columns, in the order the List shows them', () => {
    const t = exportTable('assets', ['assignee', 'assetTag', 'status', 'serial'], [asset])
    expect(t.columns).toEqual(['Asset Tag', 'Status', 'Assignee', 'Serial'])
    expect(t.rows).toEqual([['NOMMA-1', 'Deployed', 'Jordan Reyes', '5CD1']])
  })

  it('cells are the text the List shows: names, not records; empty, not a dash', () => {
    const t = exportTable('assets', ['assetTag', 'assignee', 'expectedCheckin', 'location'], [{ ...asset, assignee: null, location: '' }])
    expect(t.rows).toEqual([['NOMMA-1', '', '', '']])
    const activity = { id: 7, when: '2026-08-17 15:40', action: 'Checkin', operator: 'E. Caldwell', detail: 'from Sam Whitaker', note: 'keyboard sticky', item: { type: 'asset', id: 4812, name: 'CB-LIB-012' }, can }
    expect(exportTable('activity', ['when', 'item', 'note'], [activity]).rows).toEqual([['2026-08-17 15:40', 'CB-LIB-012', 'keyboard sticky']])
    expect(exportTable('statuslabels', ['name', 'type', 'assets'], [{ id: 1, name: 'Broken', type: 'undeployable', assets: 3, can }]).rows).toEqual([['Broken', 'Undeployable', '3']])
  })
})

describe('a Saved Report opened again', () => {
  it('shows its Columns in the List order, always the first, without ones the List no longer has', () => {
    expect(shownColumns('assets', ['serial', 'gone', 'status'])).toEqual(['assetTag', 'status', 'serial'])
    expect(shownColumns('users', null)).toEqual(['name', 'username', 'department', 'location', 'assets'])
  })
})
