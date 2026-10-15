import { describe, expect, it } from 'vitest'
import { unencryptedRemote } from './SettingsPage'

describe('the unencrypted connection warning', () => {
  it('shows for HTTP to any other machine, LAN included', () => {
    expect(unencryptedRemote('http://inventory.example.org')).toBe(true)
    expect(unencryptedRemote('http://192.168.1.20')).toBe(true)
    expect(unencryptedRemote('http://10.0.0.5:8080/snipe')).toBe(true)
    expect(unencryptedRemote('HTTP://snipeit.local')).toBe(true)
  })

  it("doesn't show for HTTPS, this machine, or a URL still being typed", () => {
    expect(unencryptedRemote('https://inventory.example.org')).toBe(false)
    expect(unencryptedRemote('http://localhost:8765')).toBe(false)
    expect(unencryptedRemote('http://127.0.0.1')).toBe(false)
    expect(unencryptedRemote('http://127.5.0.1:3000')).toBe(false)
    expect(unencryptedRemote('http://[::1]:8765')).toBe(false)
    expect(unencryptedRemote('http://')).toBe(false)
    expect(unencryptedRemote('')).toBe(false)
  })
})
