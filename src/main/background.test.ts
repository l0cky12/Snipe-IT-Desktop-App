import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { linuxAutostart } from './background'

const dirs: string[] = []
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })))

it('on Linux, starts at login hidden through an XDG autostart entry, and stops when turned off', () => {
  const config = mkdtempSync(join(tmpdir(), 'snipe-autostart-'))
  dirs.push(config)
  const entry = join(config, 'autostart', 'snipe-it-desktop.desktop')
  linuxAutostart(true, config, '/home/j/Apps/Snipe-IT Desktop "1".AppImage')
  expect(readFileSync(entry, 'utf8')).toContain('\nExec="/home/j/Apps/Snipe-IT Desktop \\\\"1\\\\".AppImage" --hidden\n')
  linuxAutostart(true, config, '/opt/Snipe-IT Desktop/snipe-it-desktop')
  expect(readFileSync(entry, 'utf8')).toContain('\nExec="/opt/Snipe-IT Desktop/snipe-it-desktop" --hidden\n')
  linuxAutostart(false, config, '/opt/Snipe-IT Desktop/snipe-it-desktop')
  expect(existsSync(entry)).toBe(false)
  linuxAutostart(false, config, '/opt/Snipe-IT Desktop/snipe-it-desktop')
})
