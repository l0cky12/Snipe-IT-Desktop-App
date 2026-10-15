import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MailInput, SavedReport } from './config'
import type { Mail } from './mail'
import { RELEASES_URL } from './release'
import type { SnipeItBridge } from './snipeit'

// Exercise the actual IPC wiring and settings store; only Electron, HTTP and SMTP are fake.
const handlers = new Map<string, (...args: unknown[]) => unknown>()
const call = (name: string, ...args: unknown[]) => handlers.get(name)!({}, ...args)
const exposed: Record<string, unknown> = {}
const connection = { baseUrl: 'https://old.example.org', apiKey: 'old-test-token', defaultLocation: null }
const smtp: MailInput = { host: 'smtp.example.org', port: 465, security: 'ssl', username: 'operator', sender: 'operator@nomma.net', password: 'test-password' }
const send = vi.fn<(server: MailInput, mail: Mail) => Promise<void>>(async () => {})
const request = vi.fn<typeof fetch>()
let dir: string
const nativeTheme = { themeSource: 'system', shouldUseDarkColors: false, on: () => {} }
const openExternal = vi.fn(async (_url: string) => {})
// The main window's event handlers, the tray menu, and the quit prompt (which answers Cancel unless told otherwise).
const windowEvents = new Map<string, (e: { preventDefault(): void }) => void>()
const appEvents = new Map<string, (e: { preventDefault(): void }) => void>()
let trayMenu: { label: string; click: () => void }[] = []
const ask = vi.fn<(...args: unknown[]) => number>()
const quit = vi.fn()
const saveAs = vi.fn<(...args: unknown[]) => Promise<{ canceled: boolean; filePath?: string }>>()

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

beforeEach(async () => {
  vi.resetModules()
  vi.useFakeTimers()
  handlers.clear()
  windowEvents.clear()
  appEvents.clear()
  ask.mockReset().mockReturnValue(1)
  quit.mockClear()
  saveAs.mockReset()
  send.mockClear()
  openExternal.mockClear()
  request.mockReset().mockImplementation(async (url) => new Response(JSON.stringify(
    String(url).endsWith('/users/me') ? { email: 'operator@nomma.net' } : { total: 0, rows: [] },
  )))
  vi.stubGlobal('fetch', request)
  // From source the app asks only this for the latest Snipe-IT release; the fake fetch answers it.
  vi.stubEnv('SNIPEIT_RELEASES_URL', RELEASES_URL)
  nativeTheme.themeSource = 'system'
  dir = mkdtempSync(join(tmpdir(), 'snipe-report-session-'))
  vi.doMock('electron', () => ({
    app: { requestSingleInstanceLock: () => true, whenReady: async () => {}, getPath: () => dir, getVersion: () => 'test', on: (name: string, handler: (e: { preventDefault(): void }) => void) => appEvents.set(name, handler), setAppUserModelId: () => {}, quit, isPackaged: false },
    BrowserWindow: class {
      setMenuBarVisibility() {}
      setIcon() {}
      loadFile() {}
      loadURL() {}
      on(name: string, handler: (e: { preventDefault(): void }) => void) { windowEvents.set(name, handler) }
      isVisible() { return true }
      getChildWindows() { return [] }
      hide() {}
    },
    dialog: { showMessageBoxSync: ask, showSaveDialog: saveAs },
    Tray: class { setImage() {} setToolTip() {} setContextMenu(menu: typeof trayMenu) { trayMenu = menu } on() {} destroy() {} },
    Menu: { buildFromTemplate: (template: typeof trayMenu) => template },
    nativeImage: { createFromPath: () => ({}) },
    ipcMain: { handle: (name: string, handler: (...args: unknown[]) => unknown) => handlers.set(name, handler) },
    nativeTheme,
    // The window's side, for the preload: Electron passes on only a rejection's text, wrapped like this.
    ipcRenderer: {
      invoke: async (name: string, ...args: unknown[]) => {
        try {
          return await handlers.get(name)!({}, ...args)
        } catch (e) {
          throw new Error(`Error invoking remote method '${name}': ${e}`)
        }
      },
    },
    // The bridge copies what a function throws, an Error's message only; structuredClone drops its other fields alike.
    contextBridge: {
      exposeInMainWorld: (key: string, api: Record<string, (...args: unknown[]) => Promise<unknown>>) =>
        (exposed[key] = Object.fromEntries(Object.entries(api).map(([name, fn]) =>
          [name, (...args: unknown[]) => fn(...args).catch((e) => { throw structuredClone(e) })]))),
    },
    safeStorage: { isEncryptionAvailable: () => false },
    shell: { openExternal },
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
  vi.unstubAllEnvs()
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
  await expect(call('settings:save', { ...connection, baseUrl: 'invalid' })).rejects.toThrow()
  call('settings:saveBackground', { tray: false, startAtLogin: false })
  response.resolve(new Response(JSON.stringify({ email: 'operator@nomma.net' })))
  await pending
  expect(send).toHaveBeenCalledTimes(1)
})

it('keeps a Saved Report definition captured before looking up the recipient', async () => {
  const saved = await call('settings:saveReport', { name: 'Original', kind: 'assets', search: 'original', filters: {}, sort: null, columns: ['assetTag'] }) as SavedReport
  const response = deferred<Response>()
  request.mockImplementationOnce(() => response.promise)
  const pending = call('reports:emailNow', { saved: saved.id })
  call('settings:saveReport', { ...saved, name: 'Changed', search: 'changed' })
  response.resolve(new Response(JSON.stringify({ email: 'operator@nomma.net' })))
  await pending
  expect(String(request.mock.calls[1][0])).toContain('search=original')
  expect(send.mock.calls[0][1].subject).toMatch(/^Original,/)
})

it('switches the theme when the Appearance setting is saved', () => {
  expect(nativeTheme.themeSource).toBe('system')
  call('settings:saveAppearance', 'dark')
  expect(nativeTheme.themeSource).toBe('dark')
})

it("gives the window a Snipe-IT failure's kind as well as its message", async () => {
  await import('../preload/index')
  const snipeIt = exposed.snipeIt as SnipeItBridge
  request.mockImplementation(async () => new Response('{}', { status: 429, headers: { 'Retry-After': '23' } }))
  // A 429 is sent again up to three times, after each wait, before it fails; fake timers skip the waits.
  vi.useFakeTimers({ toFake: ['setTimeout'] })
  const throttled = expect(snipeIt.statusLabels()).rejects.toMatchObject({ message: 'Snipe-IT is limiting requests; try again in 23 seconds.', kind: 'rateLimited', retryAfter: 23 })
  await vi.runAllTimersAsync()
  await throttled
  vi.useRealTimers()
  request.mockImplementation(async () => new Response('{}', { status: 401 }))
  await expect(snipeIt.statusLabels()).rejects.toMatchObject({ message: expect.stringMatching(/^Snipe-IT rejected your API key\./), kind: 'key' })
  request.mockImplementation(async () => new Response(JSON.stringify({ status: 'error', messages: 'No Status Labels for you.' })))
  await expect(snipeIt.statusLabels()).rejects.toMatchObject({ message: 'No Status Labels for you.', kind: 'refused' })
})

it("gives the window GitHub's latest Snipe-IT release, opens only its release notes, and hides it", async () => {
  const notes = 'https://github.com/grokability/snipe-it/releases/tag/v8.9.1'
  request.mockImplementation(async (url) => new Response(JSON.stringify(
    String(url) === RELEASES_URL ? { tag_name: 'v8.9.1', html_url: notes } : String(url).endsWith('/version') ? { version: 'v8.8.0' } : { total: 0, rows: [] })))
  expect(await call('release:latest')).toEqual({ tag: 'v8.9.1', url: notes })
  await call('release:open', notes)
  await expect(call('release:open', 'https://example.org/grokability/snipe-it/releases/tag/v8.9.1')).rejects.toThrow('Only Snipe-IT release notes')
  expect(openExternal.mock.calls).toEqual([[notes]])
  call('release:hide', 'v8.9.1')
  expect(await call('release:latest')).toBeNull()
  // Asked GitHub once: the second check read the day-long cache.
  expect(request.mock.calls.filter(([url]) => String(url) === RELEASES_URL)).toHaveLength(1)
})

describe('quitting while a Paused Workflow holds scans (#73)', () => {
  // Whether the window close, or app.quit()'s before-quit, was cancelled.
  const cancelled = (handler: (e: { preventDefault(): void }) => void) => {
    const e = { preventDefault: vi.fn() }
    handler(e)
    return e.preventDefault.mock.calls.length > 0
  }
  const close = () => cancelled(windowEvents.get('close')!)
  const beforeQuit = () => cancelled(appEvents.get('before-quit')!)

  it('closing the window out of tray mode asks only when scans are waiting, and Cancel keeps the app open', async () => {
    await call('workflows:unsent', 3)
    expect(close()).toBe(true)
    expect(ask).toHaveBeenCalledTimes(1)
    expect(ask.mock.calls[0].at(-1)).toMatchObject({ message: "3 scans weren't sent to Snipe-IT. Quit anyway?", buttons: ['Quit', 'Cancel'] })
    ask.mockReturnValue(0)
    expect(close()).toBe(false)
    // Quit was chosen: the app.quit() that follows the last window closing doesn't ask again.
    expect(beforeQuit()).toBe(false)
    expect(ask).toHaveBeenCalledTimes(2)
  })

  it('a moving queue (or none) quits without asking', async () => {
    await call('workflows:unsent', 0)
    expect(close()).toBe(false)
    expect(beforeQuit()).toBe(false)
    expect(ask).not.toHaveBeenCalled()
  })

  it('Windows logging out never waits on the prompt', async () => {
    await call('workflows:unsent', 2)
    windowEvents.get('session-end')!({ preventDefault() {} })
    expect(beforeQuit()).toBe(false)
    expect(close()).toBe(false)
    expect(ask).not.toHaveBeenCalled()
  })

  it("quitting the app (the tray's Quit, Ctrl+Q) asks too; closing to the tray keeps the scans without asking", async () => {
    await call('settings:saveBackground', { tray: true, startAtLogin: false })
    trayMenu.find((i) => i.label === 'Quit')!.click()
    expect(quit).toHaveBeenCalledTimes(1)
    await call('workflows:unsent', 1)
    expect(close()).toBe(true)
    expect(ask).not.toHaveBeenCalled()
    expect(beforeQuit()).toBe(true)
    expect(ask.mock.calls[0].at(-1)).toMatchObject({ message: "1 scan wasn't sent to Snipe-IT. Quit anyway?" })
    // Still running in the tray, so closing hides the window again.
    expect(close()).toBe(true)
    ask.mockReturnValue(0)
    expect(beforeQuit()).toBe(false)
    // Quitting now: the window closes for good.
    expect(close()).toBe(false)
  })

  it('only takes a whole number of scans from the window', async () => {
    for (const bad of [-2, 1.5, '4', null]) {
      await call('workflows:unsent', bad)
      expect(close()).toBe(false)
    }
    expect(ask).not.toHaveBeenCalled()
  })
})

describe('Export…', () => {
  const table = { name: 'Users', columns: ['Name'], rows: [['A']] }

  it('writes the CSV or HTML file where the Operator chooses, named for the day, and nothing when they cancel', async () => {
    saveAs.mockResolvedValueOnce({ canceled: true })
    expect(await call('export:save', { ...table, format: 'csv' })).toBe(false)
    expect(saveAs.mock.calls[0][1]).toMatchObject({ defaultPath: expect.stringMatching(/users-\d{4}-\d{2}-\d{2}\.csv$/), filters: [{ name: 'CSV file', extensions: ['csv'] }] })
    const csv = join(dir, 'users.csv')
    saveAs.mockResolvedValueOnce({ canceled: false, filePath: csv })
    expect(await call('export:save', { ...table, format: 'csv' })).toBe(true)
    expect(readFileSync(csv, 'utf8')).toBe('\uFEFF"Name"\r\n"A"\r\n')
    const html = join(dir, 'users.html')
    saveAs.mockResolvedValueOnce({ canceled: false, filePath: html })
    expect(await call('export:save', { ...table, format: 'html' })).toBe(true)
    expect(readFileSync(html, 'utf8')).toContain('<div class="org">Snipe-IT Desktop</div><h1>Users</h1>')
    expect(readFileSync(html, 'utf8')).toContain('<td>A</td>')
    await expect(call('export:save', { ...table, format: 'docx' })).rejects.toThrow('Invalid export')
  })
})
