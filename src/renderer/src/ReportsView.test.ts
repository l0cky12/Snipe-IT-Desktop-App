import { expect, it } from 'vitest'
import { automaticCheckins, DEFAULT_CUSTOM_COLUMNS, lastSendText, pickerOptions, reportFilters, scheduleText, weekCheckouts } from './ReportsView'

it("says when a Report emails itself and over which dates", () => {
  expect(scheduleText({ every: 'day', time: '07:00' })).toBe('Daily at 07:00')
  expect(scheduleText({ every: 'week', day: 1, time: '16:30', range: 7 })).toBe('Weekly on Mondays at 16:30 · the previous 7 days')
  expect(scheduleText({ every: 'month', day: 2, time: '07:00', range: 'since' })).toBe('Monthly on the 2nd at 07:00 · since the last send')
  expect(scheduleText({ every: 'month', day: 31, time: '07:00', range: 1 })).toBe("Monthly on the 31st (or the month's last day) at 07:00 · the previous day")
  expect(scheduleText({ every: 'month', day: 13, time: '07:00' })).toBe('Monthly on the 13th at 07:00')
})

it('says how the last send went, including why it failed', () => {
  expect(lastSendText({ at: new Date(2026, 9, 5, 7).toISOString(), rows: 1 })).toBe('Last sent Oct 5, 7:00 AM: 1 row')
  expect(lastSendText({ at: new Date(2026, 9, 5, 19, 5).toISOString(), error: 'Wrong password' })).toBe('Last send failed Oct 5, 7:05 PM: Wrong password')
})

it('tells same-name Locations apart in the picker', () => {
  expect(pickerOptions('Any Location', [{ id: 3, name: 'Room 101' }, { id: 9, name: 'Room 101' }, { id: 4, name: 'Gym' }])).toEqual([
    { value: '3', label: 'Room 101 (id 3)' },
    { value: '9', label: 'Room 101 (id 9)' },
    { value: '4', label: 'Gym' },
  ])
  expect(pickerOptions('Any Category')).toEqual([])
})

it("opens on a starting query: Automatic check-in's is that day's automatic check-ins, every filter of it sent", () => {
  const start = automaticCheckins('2026-10-12')
  expect(start).toEqual({ kind: 'activity', query: { from: '2026-10-12', to: '2026-10-12', itemType: 'asset', actionType: 'checkin from', search: 'Automatic check-in' } })
  expect(reportFilters(start.kind, start.query)).toEqual(start.query)
  // A search is the Activity Report's own, like its record type and action.
  expect(reportFilters('overdue', { ...start.query, locationId: '3' })).toEqual({ from: '2026-10-12', to: '2026-10-12' })
  expect(reportFilters('auditDue', { search: 'x', locationId: '3' })).toEqual({ from: undefined, to: undefined, locationId: '3', categoryId: undefined })
})

it('the Custom Asset Report sends its columns (every standard one until chosen) and its filters, and nothing else', () => {
  expect(DEFAULT_CUSTOM_COLUMNS.slice(0, 3)).toEqual(['id', 'company', 'asset_tag'])
  expect(reportFilters('custom', { from: '2026-01-01', filters: { category_id: '3' } })).toEqual({ columns: DEFAULT_CUSTOM_COLUMNS, filters: { category_id: '3' } })
  expect(reportFilters('custom', { columns: ['asset_tag'] })).toEqual({ columns: ['asset_tag'], filters: {} })
  expect(reportFilters('overdue', { columns: ['asset_tag'], from: '2026-01-01' })).toEqual({ from: '2026-01-01', to: undefined })
})

it('a week of Checkouts over time opens its Asset Checkouts, Monday through Sunday, across a year end too', () => {
  expect(weekCheckouts('2025-12-29')).toEqual({ kind: 'activity', query: { from: '2025-12-29', to: '2026-01-04', itemType: 'asset', actionType: 'checkout' } })
  expect(weekCheckouts('2026-09-21').query.to).toBe('2026-09-27')
})
