import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
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
