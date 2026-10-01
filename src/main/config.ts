import { randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync, renameSync } from 'node:fs'
import type { safeStorage } from 'electron'
import { LIST_SORTS, type Config, type ListKind, type StatusLabel } from './snipeit'

export type SettingsInput = { baseUrl: string; apiKey: string; defaultLocation: StatusLabel | null }
// plaintext: no OS secure storage, so the token is kept in the owner-only settings file instead.
export type Settings = Omit<SettingsInput, 'apiKey'> & { hasToken: boolean; plaintext: boolean; appVersion: string }
export type SettingsApi = {
  get(): Promise<Settings>
  save(input: SettingsInput): Promise<Settings>
  test(input: SettingsInput): Promise<{ version: string }>
  locations(input: SettingsInput): Promise<StatusLabel[]>
  clearToken(): Promise<Settings>
  savedReports(): Promise<SavedReport[]>
  saveReport(report: SavedReportInput): Promise<SavedReport>
  renameReport(id: string, name: string): Promise<SavedReport[]>
  deleteReport(id: string): Promise<SavedReport[]>
}
/** A List as the Operator saved it. label names a drilled-into filter that has no filter box ("Checked out to …"). */
export type SavedReportQuery = { kind: ListKind; search: string; filters: Record<string, string>; label?: string; sort: { key: string; order: 'asc' | 'desc' } | null; columns: string[] }
// The scheduler will keep a Saved Report's schedule and last send beside these; re-saving and renaming leave them be.
export type SavedReport = SavedReportQuery & { id: string; name: string }
/** No id: a new Saved Report. An id: re-saves that one. */
export type SavedReportInput = SavedReportQuery & { id?: string; name: string }
type Stored = { baseUrl: string; encryptedToken?: string; plainToken?: string; defaultLocation: StatusLabel | null; savedReports?: SavedReport[] }

const isStrings = (v: unknown, of: 'array' | 'record') =>
  (of === 'array' ? Array.isArray(v) : !!v && typeof v === 'object' && !Array.isArray(v)) && Object.values(v as object).every((x) => typeof x === 'string')
// What comes from the screen, checked and with emptied filters dropped, so the store only ever holds a List it can open.
function reportQuery(r: SavedReportInput): SavedReportQuery & { name: string } {
  const name = typeof r?.name === 'string' ? r.name.trim() : ''
  if (!name) throw new Error('Name the report.')
  const sorts: Record<string, string> | undefined = Object.hasOwn(LIST_SORTS, r.kind) ? LIST_SORTS[r.kind] : undefined
  if (!sorts || typeof r.search !== 'string' || !isStrings(r.filters, 'record') || !isStrings(r.columns, 'array') || (r.label !== undefined && typeof r.label !== 'string')
    || (r.sort !== null && !(Object.hasOwn(sorts, r.sort?.key) && ['asc', 'desc'].includes(r.sort.order))))
    throw new Error('Invalid report')
  const filters = Object.fromEntries(Object.entries(r.filters).filter(([, v]) => v))
  return { name, kind: r.kind, search: r.search, filters, ...(r.label && { label: r.label }), sort: r.sort && { key: r.sort.key, order: r.sort.order }, columns: [...r.columns] }
}

export function createSettingsStore(path: string, storage: Pick<typeof safeStorage, 'isEncryptionAvailable' | 'getSelectedStorageBackend' | 'encryptString' | 'decryptString'>, appVersion: string) {
  function read(): Stored {
    try { return JSON.parse(readFileSync(path, 'utf8')) }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { baseUrl: '', defaultLocation: null }
      throw new Error('Could not read saved settings. Check the settings file before trying again.')
    }
  }
  const available = () => storage.isEncryptionAvailable() && !(process.platform === 'linux' && ['basic_text', 'unknown'].includes(storage.getSelectedStorageBackend()))
  function secure() {
    if (!available())
      throw new Error('OS secure storage is unavailable. Unlock your keychain or enable a system password store, then try again.')
  }
  function write(value: Stored) {
    writeFileSync(path + '.tmp', JSON.stringify(value), { mode: 0o600 })
    renameSync(path + '.tmp', path)
  }
  const withoutToken = ({ encryptedToken: _, plainToken: __, ...rest }: Stored): Stored => rest
  const savedReports = () => read().savedReports ?? []
  const gone = (): never => { throw new Error('That Saved Report no longer exists.') }
  function get(): Settings {
    const value = read()
    return { baseUrl: value.baseUrl, defaultLocation: value.defaultLocation, hasToken: !!(value.encryptedToken || value.plainToken), plaintext: !!value.plainToken, appVersion }
  }
  function credentials(input?: SettingsInput): Config {
    const saved = read()
    const baseUrl = (input?.baseUrl ?? saved.baseUrl).trim().replace(/\/+$/, '')
    let url: URL
    try { url = new URL(baseUrl) } catch { throw new Error('Enter a valid Snipe-IT server URL.') }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash)
      throw new Error('Use an HTTP(S) server URL without credentials, query parameters, or a fragment.')
    let apiKey = input?.apiKey.trim() ?? ''
    if (!apiKey && saved.plainToken && baseUrl === saved.baseUrl) apiKey = saved.plainToken
    if (!apiKey && saved.encryptedToken && baseUrl === saved.baseUrl) {
      secure()
      try { apiKey = storage.decryptString(Buffer.from(saved.encryptedToken, 'base64')) }
      catch { throw new Error('Could not unlock the saved API token. Enter it again or clear it.') }
    }
    if (!apiKey) throw new Error('Enter an API token for this server in Settings.')
    return { baseUrl, apiKey }
  }
  return {
    get, credentials,
    save(input: SettingsInput) {
      const config = credentials(input)
      const loc = input.defaultLocation
      if (loc !== null && (!Number.isSafeInteger(loc?.id) || loc.id <= 0 || typeof loc.name !== 'string'))
        throw new Error('Choose a valid default Location.')
      const defaultLocation = loc && { id: loc.id, name: loc.name }
      const rest = withoutToken(read())
      // No keychain: fall back to the owner-only (0600) file rather than locking the Operator out every launch.
      if (!available()) write({ ...rest, baseUrl: config.baseUrl, plainToken: config.apiKey, defaultLocation })
      else write({ ...rest, baseUrl: config.baseUrl, encryptedToken: storage.encryptString(config.apiKey).toString('base64'), defaultLocation })
      return get()
    },
    clearToken() {
      write(withoutToken(read()))
      return get()
    },
    savedReports,
    saveReport(input: SavedReportInput): SavedReport {
      const query = reportQuery(input)
      const saved = read()
      const reports = saved.savedReports ?? []
      if (input.id === undefined) {
        const report = { id: randomUUID(), ...query }
        write({ ...saved, savedReports: [...reports, report] })
        return report
      }
      const old = reports.find((r) => r.id === input.id) ?? gone()
      // The old label goes, so one the List no longer has doesn't linger; anything else beside the query stays.
      const { label: _, ...kept } = old
      const report = { ...kept, ...query }
      write({ ...saved, savedReports: reports.map((r) => (r === old ? report : r)) })
      return report
    },
    renameReport(id: string, name: string) {
      const saved = read()
      const reports = saved.savedReports ?? []
      const old = reports.find((r) => r.id === id) ?? gone()
      const { name: named } = reportQuery({ ...old, name })
      write({ ...saved, savedReports: reports.map((r) => (r === old ? { ...r, name: named } : r)) })
      return savedReports()
    },
    deleteReport(id: string) {
      const saved = read()
      write({ ...saved, savedReports: (saved.savedReports ?? []).filter((r) => r.id !== id) })
      return savedReports()
    },
  }
}
