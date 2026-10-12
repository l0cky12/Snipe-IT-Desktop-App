import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createSettingsStore } from './config'
import { createEndOfDayReminder, reminderText } from './reminder'

const tags = (n: number) => Array.from({ length: n }, (_, i) => `NOMMA-${1001 + i}`)

describe('the End-of-day reminder text', () => {
  it('counts and lists the Asset Tags as given (most late first), and never more than 10', () => {
    expect(reminderText(tags(3))).toEqual({ title: '3 Temp checkouts still out', body: 'NOMMA-1001, NOMMA-1002, NOMMA-1003' })
    expect(reminderText(tags(14))).toEqual({
      title: '14 Temp checkouts still out',
      body: 'NOMMA-1001, NOMMA-1002, NOMMA-1003, NOMMA-1004, NOMMA-1005, NOMMA-1006, NOMMA-1007, NOMMA-1008, NOMMA-1009, NOMMA-1010 and 4 more',
    })
    expect(reminderText(tags(1)).title).toBe('1 Temp checkout still out')
  })

  it('says when Automatic check-in will check them in, when it is on', () => {
    expect(reminderText(tags(3), '15:50')).toEqual({
      title: '3 Temp checkouts still out',
      body: 'NOMMA-1001, NOMMA-1002, NOMMA-1003\nAny still out at 3:50 pm will be checked in automatically.',
    })
    expect(reminderText(tags(14), '13:00').body).toBe(
      'NOMMA-1001, NOMMA-1002, NOMMA-1003, NOMMA-1004, NOMMA-1005, NOMMA-1006, NOMMA-1007, NOMMA-1008, NOMMA-1009, NOMMA-1010 and 4 more\nAny still out at 1:00 pm will be checked in automatically.',
    )
  })
})

const dirs: string[] = []
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })))
// The reminder on a fake clock, against a real settings store (so the last day survives a "restart") and a fake lookup.
// Mon 12 Oct 2026 is a School day; Wed 14 is a half day ending 12:00; Thu 15 has no school.
function setup({ out = tags(3) as string[] | Error } = {}) {
  const path = join(mkdtempSync(join(tmpdir(), 'snipe-reminder-')), 'settings.json')
  dirs.push(join(path, '..'))
  const storage = { isEncryptionAvailable: () => true, getSelectedStorageBackend: () => 'gnome_libsecret' as const, encryptString: () => Buffer.from('x'), decryptString: () => 'secret-token' }
  const open = () => createSettingsStore(path, storage, '0.1.0')
  const store = open()
  store.save({ baseUrl: 'https://snipe.example.org', apiKey: 'secret-token', defaultLocation: null })
  store.saveSchoolCalendar('2026-10-14 half day 12:00 Conferences\n2026-10-15 Fall break')
  const clock = { now: new Date(2026, 9, 12, 14, 49) }
  const shown: { title: string; body: string }[] = []
  let lookups = 0
  // A launch: a fresh store and reminder over the same settings file.
  const launch = () => {
    const s = open()
    return createEndOfDayReminder({
      now: () => clock.now,
      settings: s.get,
      lastShown: s.lastReminder,
      recordShown: s.recordReminder,
      outstanding: async () => {
        lookups++
        if (out instanceof Error) throw out
        return out
      },
      notify: (text) => void shown.push(text),
    })
  }
  return { store, clock, shown, launch, lookups: () => lookups, at: (d: number, h: number, m: number) => (clock.now = new Date(2026, 9, d, h, m)) }
}

describe('the End-of-day reminder job', () => {
  it('shows once at the end-of-day time on a School day, never twice, even across a restart', async () => {
    const { shown, launch, at, lookups } = setup()
    const reminder = launch()
    await reminder.tick()
    expect(lookups()).toBe(0)
    at(12, 14, 50)
    await reminder.tick()
    expect(shown).toEqual([{ title: '3 Temp checkouts still out', body: 'NOMMA-1001, NOMMA-1002, NOMMA-1003' }])
    at(12, 14, 51)
    await reminder.tick()
    await launch().tick()
    expect(shown).toHaveLength(1)
    expect(lookups()).toBe(1)
  })

  it('shows once at a later launch the same School day, but never the next day for a missed one', async () => {
    const { shown, launch, at } = setup()
    at(12, 16, 30)
    await launch().tick()
    expect(shown).toHaveLength(1)
    // Closed all Monday: nothing at Tuesday's launch before its end-of-day time.
    const missed = setup()
    missed.at(13, 9, 0)
    const reminder = missed.launch()
    await reminder.tick()
    expect(missed.shown).toHaveLength(0)
    missed.at(13, 14, 50)
    await reminder.tick()
    expect(missed.shown).toHaveLength(1)
  })

  it('skips weekends and School calendar days off, and comes at a half day\'s time', async () => {
    const { shown, launch, at } = setup()
    const reminder = launch()
    for (const [d, h] of [[10, 15], [11, 15], [15, 15], [15, 23]]) {
      at(d, h, 0)
      await reminder.tick()
    }
    expect(shown).toHaveLength(0)
    at(14, 11, 59)
    await reminder.tick()
    expect(shown).toHaveLength(0)
    at(14, 12, 0)
    await reminder.tick()
    expect(shown).toHaveLength(1)
  })

  it('does nothing when switched off or with no connection set up', async () => {
    const { store, shown, launch, at, lookups } = setup()
    at(12, 15, 0)
    store.saveTempCheckout({ endOfDay: '14:50', reminder: false })
    await launch().tick()
    store.saveTempCheckout({ endOfDay: '14:50', reminder: true })
    store.clearToken()
    await launch().tick()
    expect(shown).toHaveLength(0)
    expect(lookups()).toBe(0)
  })

  it('shows nothing when none are out, and records the day so it looks only once', async () => {
    const { shown, launch, at, lookups } = setup({ out: [] })
    at(12, 15, 0)
    const reminder = launch()
    await reminder.tick()
    await reminder.tick()
    expect(shown).toHaveLength(0)
    expect(lookups()).toBe(1)
  })

  it('tries again each tick while Snipe-IT can\'t be reached, until the day ends', async () => {
    const { shown, launch, at, lookups } = setup({ out: new Error("Can't reach Snipe-IT") })
    const reminder = launch()
    at(12, 15, 0)
    await expect(reminder.tick()).rejects.toThrow("Can't reach Snipe-IT")
    at(12, 15, 1)
    await expect(reminder.tick()).rejects.toThrow("Can't reach Snipe-IT")
    expect(lookups()).toBe(2)
    // Tuesday before its end-of-day time: Monday's isn't caught up.
    at(13, 9, 0)
    await reminder.tick()
    expect(lookups()).toBe(2)
    expect(shown).toHaveLength(0)
  })

  it('reads the end-of-day time from Settings at each tick', async () => {
    const { store, shown, launch, at } = setup()
    const reminder = launch()
    at(12, 14, 55)
    store.saveTempCheckout({ endOfDay: '15:10', reminder: true })
    await reminder.tick()
    expect(shown).toHaveLength(0)
    at(12, 15, 10)
    await reminder.tick()
    expect(shown).toHaveLength(1)
  })
})
