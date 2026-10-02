import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { MailInput, SavedReport } from './config'
import type { Mail } from './mail'

// Exercise the actual IPC wiring and settings store; only Electron, HTTP and SMTP are fake.
const handlers = new Map<string, (...args: unknown[]) => unknown>()
const call = (name: string, ...args: unknown[]) => handlers.get(name)!({}, ...args)
const connection = { baseUrl: 'https://old.example.org', apiKey: 'old-test-token', defaultLocation: null }
const smtp: MailInput = { host: 'smtp.example.org', port: 465, security: 'ssl', username: 'operator', sender: 'operator@nomma.net', password: 'test-password' }
const send = vi.fn<(server: MailInput, mail: Mail) => Promise<void>>(async () => {})
const request = vi.fn<typeof fetch>()
let dir: string

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

beforeEach(async () => {
  vi.resetModules()
  vi.useFakeTimers()
  handlers.clear()
  send.mockClear()
  request.mockReset().mockImplementation(async (url) => new Response(JSON.stringify(
    String(url).endsWith('/users/me') ? { email: 'operator@nomma.net' } : { total: 0, rows: [] },
  )))
  vi.stubGlobal('fetch', request)
  dir = mkdtempSync(join(tmpdir(), 'snipe-report-session-'))
  vi.doMock('electron', () => ({
    app: { requestSingleInstanceLock: () => true, whenReady: async () => {}, getPath: () => dir, getVersion: () => 'test', on: () => {}, setAppUserModelId: () => {} },
    BrowserWindow: class {
      setMenuBarVisibility() {}
      loadFile() {}
      loadURL() {}
      on() {}
      isVisible() { return true }
    },
    ipcMain: { handle: (name: string, handler: (...args: unknown[]) => unknown) => handlers.set(name, handler) },
    safeStorage: { isEncryptionAvailable: () => false },
  }))
  vi.doMock('./mail', () => ({ sendMail: send }))
  vi.doMock('./tray.png?asset', () => ({ default: '' }))
  await import('./index')
  call('settings:save', connection)
  call('settings:saveMail', smtp)
})

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  rmSync(dir, { recursive: true, force: true })
})

it.each([
  ['recipient', 'logout'], ['recipient', 'server'], ['recipient', 'token'],
  ['report', 'logout'], ['report', 'server'], ['report', 'token'],
] as const)('cancels a report waiting for its %s after a %s change', async (phase, change) => {
  const entered = deferred<void>()
  const response = deferred<Response>()
  request.mockImplementation(async (url) => {
    const recipient = String(url).endsWith('/users/me')
    if (recipient === (phase === 'recipient')) {
      entered.resolve()
      return response.promise
    }
    return new Response(JSON.stringify(recipient ? { email: 'operator@nomma.net' } : { total: 0, rows: [] }))
  })
  const pending = Promise.resolve(call('reports:emailNow', { builtIn: 'overdue', query: {} }))
  // Attach the rejection handler before changing settings so a prompt cancellation is also safe.
  const outcome = pending.then(() => '', (e: Error) => e.message)
  await entered.promise
  if (change === 'logout') call('settings:clearToken')
  else call('settings:save', { ...connection, ...(change === 'server' ? { baseUrl: 'https://new.example.org' } : { apiKey: 'new-test-token' }) })
  response.resolve(new Response(JSON.stringify(phase === 'recipient' ? { email: 'operator@nomma.net' } : { total: 0, rows: [] })))
  expect(await outcome).toMatch(/cancelled.*connection|connection.*cancelled/i)
  expect(send).not.toHaveBeenCalled()
  if (phase === 'recipient') expect(request).toHaveBeenCalledTimes(1)
})

it('keeps the SMTP settings captured when a report started', async () => {
  const response = deferred<Response>()
  request.mockImplementationOnce(() => response.promise)
  const pending = call('reports:emailNow', { builtIn: 'overdue', query: {} })
  call('settings:saveMail', { ...smtp, host: 'new-smtp.example.org', password: 'new-test-password' })
  response.resolve(new Response(JSON.stringify({ email: 'operator@nomma.net' })))
  await pending
  expect(send).toHaveBeenCalledExactlyOnceWith(smtp, expect.objectContaining({ to: 'operator@nomma.net' }))
})

it('does not revive an old send after logging back in with the same credentials; a new send works', async () => {
  const response = deferred<Response>()
  request.mockImplementationOnce(() => response.promise)
  const pending = Promise.resolve(call('reports:emailNow', { builtIn: 'overdue', query: {} }))
  const outcome = pending.catch((e: Error) => e.message)
  call('settings:clearToken')
  call('settings:save', connection)
  response.resolve(new Response(JSON.stringify({ email: 'operator@nomma.net' })))
  expect(await outcome).toMatch(/cancelled/)
  expect(send).not.toHaveBeenCalled()
  await call('reports:emailNow', { builtIn: 'overdue', query: {} })
  expect(send).toHaveBeenCalledTimes(1)
})

it('does not cancel for a rejected connection save or unrelated background settings', async () => {
  const response = deferred<Response>()
  request.mockImplementationOnce(() => response.promise)
  const pending = call('reports:emailNow', { builtIn: 'overdue', query: {} })
  expect(() => call('settings:save', { ...connection, baseUrl: 'invalid' })).toThrow()
  call('settings:saveBackground', { tray: false, startAtLogin: false })
  response.resolve(new Response(JSON.stringify({ email: 'operator@nomma.net' })))
  await pending
  expect(send).toHaveBeenCalledTimes(1)
})

it('keeps a Saved Report definition captured before looking up the recipient', async () => {
  const saved = call('settings:saveReport', { name: 'Original', kind: 'assets', search: 'original', filters: {}, sort: null, columns: ['assetTag'] }) as SavedReport
  const response = deferred<Response>()
  request.mockImplementationOnce(() => response.promise)
  const pending = call('reports:emailNow', { saved: saved.id })
  call('settings:saveReport', { ...saved, name: 'Changed', search: 'changed' })
  response.resolve(new Response(JSON.stringify({ email: 'operator@nomma.net' })))
  await pending
  expect(String(request.mock.calls[1][0])).toContain('search=original')
  expect(send.mock.calls[0][1].subject).toMatch(/^Original,/)
})
