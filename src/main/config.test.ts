import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { createSettingsStore } from './config'

const dirs: string[] = []
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })))
function setup() {
  const path = join(mkdtempSync(join(tmpdir(), 'snipe-settings-')), 'settings.json')
  dirs.push(join(path, '..'))
  const storage = {
    isEncryptionAvailable: vi.fn(() => true),
    getSelectedStorageBackend: vi.fn<() => ReturnType<typeof import('electron').safeStorage.getSelectedStorageBackend>>(() => 'gnome_libsecret'),
    encryptString: vi.fn(() => Buffer.from('encrypted-by-os')),
    decryptString: vi.fn(() => 'secret-token'),
  }
  return { path, storage, store: createSettingsStore(path, storage, '0.1.0') }
}
const input = { baseUrl: 'https://snipe.example.org/', apiKey: 'secret-token', defaultLocation: { id: 9, name: 'Library' } }

it('saves only encrypted credentials, reloads preferences, keeps a blank token, and clears it', () => {
  const { path, storage, store } = setup()
  expect(store.get().hasToken).toBe(false)
  store.save(input)
  expect(storage.encryptString).toHaveBeenCalledWith('secret-token')
  expect(readFileSync(path, 'utf8')).not.toContain('secret-token')
  expect(store.get()).not.toHaveProperty('apiKey')
  expect(store.get().defaultLocation).toEqual(input.defaultLocation)
  expect(store.credentials().apiKey).toBe('secret-token')
  store.save({ ...input, apiKey: '' })
  expect(store.clearToken().hasToken).toBe(false)
  expect(() => store.credentials()).toThrow('Enter an API token')
  expect(readFileSync(path, 'utf8')).not.toContain('encryptedToken')
})

it('without secure storage saves the token to the owner-only file so it survives a restart', () => {
  const { path, storage, store } = setup()
  storage.isEncryptionAvailable.mockReturnValue(false)
  expect(store.save(input)).toMatchObject({ hasToken: true, plaintext: true, defaultLocation: input.defaultLocation })
  expect(storage.encryptString).not.toHaveBeenCalled()
  if (process.platform !== 'win32') expect(statSync(path).mode & 0o777).toBe(0o600)
  const relaunched = createSettingsStore(path, storage, '0.1.0')
  expect(relaunched.get().hasToken).toBe(true)
  expect(relaunched.credentials().apiKey).toBe('secret-token')
  expect(() => relaunched.credentials({ ...input, baseUrl: 'https://other.example.org', apiKey: '' })).toThrow('Enter an API token')
  expect(relaunched.clearToken().hasToken).toBe(false)
  expect(readFileSync(path, 'utf8')).not.toContain('secret-token')
})

it.skipIf(process.platform !== 'linux')('treats the Linux basic_text fallback as unavailable', () => {
  const { storage, store } = setup()
  storage.getSelectedStorageBackend.mockReturnValue('basic_text')
  expect(store.save(input).plaintext).toBe(true)
  expect(storage.encryptString).not.toHaveBeenCalled()
})

it('never sends the saved token to a changed server and validates URL and Location', () => {
  const { store } = setup()
  store.save(input)
  expect(() => store.credentials({ ...input, baseUrl: 'https://other.example.org', apiKey: '' })).toThrow('Enter an API token')
  for (const baseUrl of ['file:///tmp/x', 'https://name:password@example.org', 'https://example.org?token=x'])
    expect(() => store.save({ ...input, baseUrl })).toThrow('HTTP(S)')
  expect(() => store.save({ ...input, defaultLocation: { id: -1, name: 'Bad' } })).toThrow('valid default Location')
})

const report = { name: 'Broken Chromebooks', kind: 'assets' as const, search: 'chromebook', filters: { status_id: '3' }, sort: { key: 'assetTag', order: 'desc' as const }, columns: ['assetTag', 'status', 'serial'] }

it('keeps Saved Reports across a restart, renames, re-saves and deletes them, and keeps them when the token changes', () => {
  const { path, storage, store } = setup()
  expect(store.savedReports()).toEqual([])
  const saved = store.saveReport(report)
  expect(saved).toMatchObject(report)
  store.save(input)
  store.clearToken()
  const relaunched = createSettingsStore(path, storage, '0.1.0')
  expect(relaunched.savedReports()).toEqual([saved])
  expect(relaunched.renameReport(saved.id, '  Broken  ')).toEqual([{ ...saved, name: 'Broken' }])
  const resaved = relaunched.saveReport({ ...report, id: saved.id, name: 'Broken', filters: { status_id: '4', location_id: '' } })
  expect(resaved).toEqual({ ...saved, name: 'Broken', filters: { status_id: '4' } })
  const other = relaunched.saveReport({ ...report, kind: 'users', filters: {}, sort: null, columns: ['name'] })
  expect(other.id).not.toBe(saved.id)
  expect(relaunched.deleteReport(saved.id)).toEqual([other])
  expect(createSettingsStore(path, storage, '0.1.0').savedReports()).toEqual([other])
})

it('re-saving or renaming keeps what a later ticket stores beside a Saved Report (its schedule, its last send)', () => {
  const { path, storage, store } = setup()
  const saved = store.saveReport(report)
  const stored = JSON.parse(readFileSync(path, 'utf8'))
  stored.savedReports[0].schedule = { every: 'week' }
  writeFileSync(path, JSON.stringify(stored))
  store.renameReport(saved.id, 'Renamed')
  expect(store.saveReport({ ...report, id: saved.id })).toMatchObject({ schedule: { every: 'week' } })
})

it('refuses a Saved Report it could not open again', () => {
  const { store } = setup()
  expect(() => store.saveReport({ ...report, name: '  ' })).toThrow('Name the report')
  expect(() => store.saveReport({ ...report, kind: 'nope' as 'assets' })).toThrow('Invalid report')
  expect(() => store.saveReport({ ...report, filters: { status_id: 3 as unknown as string } })).toThrow('Invalid report')
  expect(() => store.saveReport({ ...report, sort: { key: 'nope', order: 'asc' } })).toThrow('Invalid report')
  expect(() => store.saveReport({ ...report, columns: 'assetTag' as unknown as string[] })).toThrow('Invalid report')
  expect(() => store.saveReport({ ...report, id: 'missing' })).toThrow('no longer exists')
  expect(() => store.renameReport('missing', 'x')).toThrow('no longer exists')
  expect(store.savedReports()).toEqual([])
})

const mail = { host: 'smtp.gmail.com', port: 465, security: 'ssl' as const, username: 'operator@nomma.net', sender: 'operator@nomma.net', password: 'app-password' }

it("fills in Gmail's mail server, keeps the email password encrypted across a restart, and keeps it when left blank", () => {
  const { path, storage, store } = setup()
  expect(store.get().mail).toEqual({ host: 'smtp.gmail.com', port: 465, security: 'ssl', username: '', sender: '', hasPassword: false, plaintext: false })
  expect(() => store.mailServer()).toThrow('Enter the email password')
  storage.decryptString.mockReturnValue('app-password')
  const { password: _, ...server } = mail
  expect(store.saveMail(mail).mail).toEqual({ ...server, hasPassword: true, plaintext: false })
  expect(storage.encryptString).toHaveBeenCalledWith('app-password')
  expect(readFileSync(path, 'utf8')).not.toContain('app-password')
  const relaunched = createSettingsStore(path, storage, '0.1.0')
  expect(relaunched.mailServer()).toEqual(mail)
  relaunched.saveMail({ ...mail, port: 587, security: 'starttls', password: '' })
  expect(relaunched.mailServer()).toEqual({ ...mail, port: 587, security: 'starttls' })
  // What's typed is tried before saving, with the saved password when it's left blank.
  expect(relaunched.mailServer({ ...mail, password: '' })).toEqual(mail)
  expect(relaunched.mailServer({ ...mail, password: 'typed' }).password).toBe('typed')
  // The API token and Saved Reports are left alone, and logging out leaves the mail settings.
  relaunched.save(input)
  expect(relaunched.clearToken().mail.hasPassword).toBe(true)
})

it('never sends the saved email password to a changed mail server or account', () => {
  const { storage, store } = setup()
  storage.decryptString.mockReturnValue('app-password')
  store.saveMail(mail)
  expect(() => store.mailServer({ ...mail, host: 'smtp.evil.example', password: '' })).toThrow('Enter the email password')
  expect(() => store.mailServer({ ...mail, username: 'other@nomma.net', password: '' })).toThrow('Enter the email password')
  expect(store.saveMail({ ...mail, host: 'smtp.office365.com', password: '' }).mail.hasPassword).toBe(false)
})

it('without secure storage keeps the email password in the owner-only file', () => {
  const { path, storage, store } = setup()
  storage.isEncryptionAvailable.mockReturnValue(false)
  expect(store.saveMail(mail).mail).toMatchObject({ hasPassword: true, plaintext: true })
  expect(storage.encryptString).not.toHaveBeenCalled()
  if (process.platform !== 'win32') expect(statSync(path).mode & 0o777).toBe(0o600)
  expect(createSettingsStore(path, storage, '0.1.0').mailServer()).toEqual(mail)
})

it('refuses mail settings it could not send with', () => {
  const { store } = setup()
  expect(() => store.saveMail({ ...mail, host: ' ' })).toThrow('Enter the mail server')
  for (const port of [0, 65536, 46.5, '465' as unknown as number]) expect(() => store.saveMail({ ...mail, port })).toThrow('port')
  expect(() => store.saveMail({ ...mail, security: 'none' as 'ssl' })).toThrow('security')
  expect(() => store.saveMail({ ...mail, username: '' })).toThrow('username')
  expect(() => store.saveMail({ ...mail, sender: 'not an address' })).toThrow('sender')
  expect(store.get().mail.hasPassword).toBe(false)
})

const weekly = { every: 'week' as const, day: 1, time: '07:00', range: 7 as const }
const since = new Date(2026, 9, 1, 12)

it('keeps built-in and Saved Report schedules across a restart; changing one keeps its last send, and they can be stopped', () => {
  const { path, storage, store } = setup()
  expect(store.schedules()).toEqual([])
  const saved = store.saveReport(report)
  store.setSchedule({ builtIn: 'overdue' }, weekly, since)
  // A Saved Report's List has no dates, so its schedule has no range.
  expect(store.setSchedule({ saved: saved.id }, { every: 'month', day: 31, time: '18:30', range: 30 }, since)).toEqual([
    { report: { builtIn: 'overdue' }, schedule: { ...weekly, since: since.toISOString() } },
    { report: { saved: saved.id }, schedule: { every: 'month', day: 31, time: '18:30', since: since.toISOString() } },
  ])
  store.recordSend({ builtIn: 'overdue' }, { at: '2026-10-05T12:00:00.000Z', rows: 3 })
  store.recordSend({ saved: saved.id }, { at: '2026-10-05T12:00:00.000Z', error: 'Wrong password' })
  store.save(input)
  store.renameReport(saved.id, 'Renamed')
  const relaunched = createSettingsStore(path, storage, '0.1.0')
  expect(relaunched.schedules()).toEqual([
    { report: { builtIn: 'overdue' }, schedule: { ...weekly, since: since.toISOString(), last: { at: '2026-10-05T12:00:00.000Z', rows: 3 }, sentAt: '2026-10-05T12:00:00.000Z' } },
    { report: { saved: saved.id }, schedule: { every: 'month', day: 31, time: '18:30', since: since.toISOString(), last: { at: '2026-10-05T12:00:00.000Z', error: 'Wrong password' } } },
  ])
  const later = new Date(2026, 9, 6)
  expect(relaunched.setSchedule({ builtIn: 'overdue' }, { every: 'day', day: 3, time: '06:00' }, later)[0]).toEqual(
    { report: { builtIn: 'overdue' }, schedule: { every: 'day', time: '06:00', since: later.toISOString(), last: { at: '2026-10-05T12:00:00.000Z', rows: 3 }, sentAt: '2026-10-05T12:00:00.000Z' } })
  // Changing only the range keeps when it was set, so the edit can't skip a send that's just come due.
  expect(relaunched.setSchedule({ builtIn: 'overdue' }, { every: 'day', time: '06:00', range: 'since' }, new Date(2026, 9, 7))[0].schedule.since).toBe(later.toISOString())
  relaunched.setSchedule({ builtIn: 'overdue' }, null, later)
  relaunched.deleteReport(saved.id)
  expect(createSettingsStore(path, storage, '0.1.0').schedules()).toEqual([])
  // A send finishing after its Saved Report was deleted, or its schedule stopped, records nothing.
  relaunched.recordSend({ saved: saved.id }, { at: '2026-10-06T12:00:00.000Z', rows: 1 })
  relaunched.recordSend({ builtIn: 'overdue' }, { at: '2026-10-06T12:00:00.000Z', rows: 1 })
  expect(relaunched.schedules()).toEqual([])
})

it('refuses a schedule it could not keep', () => {
  const { store } = setup()
  for (const [schedule, message] of [
    [{ ...weekly, every: 'hour' }, 'daily, weekly or monthly'],
    [{ ...weekly, day: 7 }, 'day of the week'],
    [{ ...weekly, every: 'month', day: 0 }, 'date from 1 to 31'],
    [{ ...weekly, time: '24:00' }, 'time'],
    [{ ...weekly, time: '7:00' }, 'time'],
    [{ ...weekly, range: 2 }, 'date range'],
  ] as const) expect(() => store.setSchedule({ builtIn: 'overdue' }, schedule as never, since)).toThrow(message)
  expect(() => store.setSchedule({ builtIn: '__proto__' as 'overdue' }, weekly, since)).toThrow('Unknown report')
  expect(() => store.setSchedule({ saved: 'missing' }, weekly, since)).toThrow('no longer exists')
  for (const key of [null, 'overdue', 7]) expect(() => store.setSchedule(key as never, weekly, since)).toThrow('Unknown report')
  expect(store.schedules()).toEqual([])
})
