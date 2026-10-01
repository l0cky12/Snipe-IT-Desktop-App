import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** Passed to the app when it starts at login, so it starts hidden in the tray when tray mode is on. */
export const HIDDEN_ARG = '--hidden'

// Electron's login item does nothing on Linux, so there it's an XDG autostart entry in configDir (~/.config).
// exec: the program, quoted for the entry's Exec key (quoting rules, then string escapes, then %).
export function linuxAutostart(on: boolean, configDir: string, exec: string) {
  const dir = join(configDir, 'autostart')
  const entry = join(dir, 'snipe-it-desktop.desktop')
  if (!on) return rmSync(entry, { force: true })
  const quoted = `"${exec.replace(/["`$\\]/g, '\\$&')}"`.replace(/\\/g, '\\\\').replace(/%/g, '%%')
  mkdirSync(dir, { recursive: true })
  writeFileSync(entry, `[Desktop Entry]\nType=Application\nName=Snipe-IT Desktop\nExec=${quoted} ${HIDDEN_ARG}\nX-GNOME-Autostart-enabled=true\n`)
}
