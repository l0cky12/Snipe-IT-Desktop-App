import { expect, it } from 'vitest'
import { lastSendText, scheduleText } from './ReportsView'

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
