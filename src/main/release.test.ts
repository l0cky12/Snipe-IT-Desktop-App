import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { createSettingsStore } from './config'
import { createReleaseCheck, openReleaseNotes, RELEASES_URL } from './release'

const dirs: string[] = []
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })))
const notes = (tag: string) => `https://github.com/grokability/snipe-it/releases/tag/${tag}`
const answer = (tag: string) => new Response(JSON.stringify({ tag_name: tag, html_url: notes(tag), body: '…' }))
// GitHub's releases/latest with a fake fetch and clock, cached in a real settings file.
function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'snipe-release-'))
  dirs.push(dir)
  const path = join(dir, 'settings.json')
  const fetch = vi.fn<typeof globalThis.fetch>(async () => answer('v8.9.1'))
  let at = new Date('2026-10-11T08:00:00Z')
  const store = () => createSettingsStore(path, { isEncryptionAvailable: () => false, getSelectedStorageBackend: () => 'basic_text', encryptString: () => Buffer.from(''), decryptString: () => '' }, 'test')
  const check = () => createReleaseCheck({ store: store(), fetch, now: () => at, url: RELEASES_URL })
  const later = (hours: number) => { at = new Date(at.getTime() + hours * 3_600_000) }
  return { fetch, check, later }
}

it('asks GitHub for the latest release once a day, keeping its tag and release notes in the settings file', async () => {
  const { fetch, check, later } = setup()
  expect(await check().latest()).toEqual({ tag: 'v8.9.1', url: notes('v8.9.1') })
  expect(fetch).toHaveBeenCalledOnce()
  expect(String(fetch.mock.calls[0][0])).toBe(RELEASES_URL)
  later(23.9)
  fetch.mockResolvedValue(answer('v8.9.2'))
  // A restart reads the same file, so it doesn't ask again either.
  expect(await check().latest()).toEqual({ tag: 'v8.9.1', url: notes('v8.9.1') })
  expect(fetch).toHaveBeenCalledOnce()
  later(0.1)
  expect(await check().latest()).toEqual({ tag: 'v8.9.2', url: notes('v8.9.2') })
  expect(fetch).toHaveBeenCalledTimes(2)
})

it.each([
  ['a rate limit', async () => new Response(JSON.stringify({ message: 'API rate limit exceeded' }), { status: 403 })],
  ['no internet', async () => { throw new TypeError('fetch failed') }],
  ['an answer with no release', async () => new Response(JSON.stringify({ tag_name: 'v8.9.1', html_url: 'https://example.org/v8.9.1' }))],
])('after %s it shows nothing and asks again an hour later', async (_, failure) => {
  const { fetch, check, later } = setup()
  fetch.mockImplementationOnce(failure)
  expect(await check().latest()).toBeNull()
  later(0.9)
  expect(await check().latest()).toBeNull()
  expect(fetch).toHaveBeenCalledOnce()
  later(0.1)
  expect(await check().latest()).toEqual({ tag: 'v8.9.1', url: notes('v8.9.1') })
  expect(fetch).toHaveBeenCalledTimes(2)
})

it('a failed ask keeps the release it already knew', async () => {
  const { fetch, check, later } = setup()
  await check().latest()
  later(25)
  fetch.mockRejectedValueOnce(new TypeError('fetch failed'))
  expect(await check().latest()).toEqual({ tag: 'v8.9.1', url: notes('v8.9.1') })
})

it('asks once when the dashboard checks twice at the same time', async () => {
  const { fetch, check } = setup()
  const releases = check()
  await Promise.all([releases.latest(), releases.latest()])
  expect(fetch).toHaveBeenCalledOnce()
})

it('Hide until the next release hides that tag on this PC, and a newer one shows', async () => {
  const { fetch, check, later } = setup()
  await check().latest()
  check().hide('v8.9.1')
  expect(await check().latest()).toBeNull()
  later(24)
  fetch.mockResolvedValue(answer('v8.9.2'))
  expect(await check().latest()).toEqual({ tag: 'v8.9.2', url: notes('v8.9.2') })
})

it('opens only Snipe-IT release notes on GitHub in the browser', async () => {
  const open = vi.fn(async (_url: string) => {})
  await openReleaseNotes(notes('v8.9.1'), open)
  expect(open.mock.calls).toEqual([[notes('v8.9.1')]])
  for (const url of [
    'http://github.com/grokability/snipe-it/releases/tag/v8.9.1',
    'https://github.com/grokability/snipe-it/releasesX',
    'https://github.com.example.org/grokability/snipe-it/releases/tag/v8.9.1',
    'https://github.com@example.org/grokability/snipe-it/releases/tag/v8.9.1',
    'https://user@github.com/grokability/snipe-it/releases/tag/v8.9.1',
    'https://github.com/grokability/snipe-it/releases/../../../evil/repo',
    'https://github.com/grokability/snipe-it/releases/%2e%2e/%2e%2e/evil',
    'https://github.com/someone/snipe-it/releases/tag/v8.9.1',
    'file:///etc/passwd',
    'javascript:alert(1)',
    'not a url',
    42,
  ])
    await expect(openReleaseNotes(url, open), String(url)).rejects.toThrow('Only Snipe-IT release notes on GitHub open from here.')
  expect(open).toHaveBeenCalledOnce()
})
