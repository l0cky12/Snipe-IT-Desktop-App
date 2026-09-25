import { readFileSync, writeFileSync, renameSync } from 'node:fs'
import type { safeStorage } from 'electron'
import type { Config, StatusLabel } from './snipeit'

export type SettingsInput = { baseUrl: string; apiKey: string; defaultLocation: StatusLabel | null }
export type Settings = Omit<SettingsInput, 'apiKey'> & { hasToken: boolean; appVersion: string }
export type SettingsApi = {
  get(): Promise<Settings>
  save(input: SettingsInput): Promise<Settings>
  test(input: SettingsInput): Promise<{ version: string }>
  locations(input: SettingsInput): Promise<StatusLabel[]>
  clearToken(): Promise<Settings>
}
type Stored = { baseUrl: string; encryptedToken?: string; defaultLocation: StatusLabel | null }

export function createSettingsStore(path: string, storage: Pick<typeof safeStorage, 'isEncryptionAvailable' | 'getSelectedStorageBackend' | 'encryptString' | 'decryptString'>, appVersion: string) {
  function read(): Stored {
    try { return JSON.parse(readFileSync(path, 'utf8')) }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { baseUrl: '', defaultLocation: null }
      throw new Error('Could not read saved settings. Check the settings file before trying again.')
    }
  }
  function secure() {
    if (!storage.isEncryptionAvailable() || (process.platform === 'linux' && ['basic_text', 'unknown'].includes(storage.getSelectedStorageBackend())))
      throw new Error('OS secure storage is unavailable. Unlock your keychain or enable a system password store, then try again.')
  }
  function write(value: Stored) {
    writeFileSync(path + '.tmp', JSON.stringify(value), { mode: 0o600 })
    renameSync(path + '.tmp', path)
  }
  function get(): Settings {
    const value = read()
    return { baseUrl: value.baseUrl, defaultLocation: value.defaultLocation, hasToken: !!value.encryptedToken, appVersion }
  }
  function credentials(input?: SettingsInput): Config {
    const saved = read()
    const baseUrl = (input?.baseUrl ?? saved.baseUrl).trim().replace(/\/+$/, '')
    let url: URL
    try { url = new URL(baseUrl) } catch { throw new Error('Enter a valid Snipe-IT server URL.') }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash)
      throw new Error('Use an HTTP(S) server URL without credentials, query parameters, or a fragment.')
    let apiKey = input?.apiKey.trim() ?? ''
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
      secure()
      write({ baseUrl: config.baseUrl, encryptedToken: storage.encryptString(config.apiKey).toString('base64'), defaultLocation: loc && { id: loc.id, name: loc.name } })
      return get()
    },
    clearToken() {
      const saved = read()
      write({ baseUrl: saved.baseUrl, defaultLocation: saved.defaultLocation })
      return get()
    },
  }
}
