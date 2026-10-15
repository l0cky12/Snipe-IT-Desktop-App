import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { Settings } from '../../main/config'
import { SettingsPage, unencryptedRemote } from './SettingsPage'

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

describe('the Settings tabs', () => {
  const settings: Settings = {
    baseUrl: 'https://snipeit.example.org', defaultLocation: null, hasToken: true, plaintext: false, appVersion: '1.0.0',
    mail: { host: 'smtp.example.org', port: 465, security: 'ssl', username: 'it@example.org', sender: 'it@example.org', hasPassword: true, plaintext: false },
    background: { tray: false, startAtLogin: false }, appearance: 'system', branding: { name: 'Snipe-IT Desktop', primary: '#14285a', accent: '#f5b301', footer: '', icon: null },
    tempCheckout: { endOfDay: '14:50', reminder: true, automatic: false, automaticAt: '15:50' }, schoolCalendar: [], repairTypeId: null,
  }
  const html = renderToStaticMarkup(createElement(SettingsPage, { settings, onSaved: () => {}, onAppearance: () => {} }))
  // Each panel's text runs from its role attribute to the next panel's: the attributes that follow, then its headings.
  const panels = html.split('role="tabpanel"').slice(1).map((p) => ({ hidden: p.startsWith(' hidden'), headings: [...p.matchAll(/<h2>([^<]*)<\/h2>/g)].map((m) => m[1]) }))

  it('are five, with the page opening on Snipe-IT', () => {
    expect([...html.matchAll(/role="tab"[^>]*>([^<]*)</g)].map((m) => m[1])).toEqual(['Snipe-IT', 'Email &amp; Reports', 'Branding', 'Checkouts', 'This PC'])
    expect(panels.map((p) => p.hidden)).toEqual([false, true, true, true, true])
  })

  it('each hold their sections, About and Repairs with the connection', () => {
    expect(panels.map((p) => p.headings)).toEqual([
      ['Connection', 'About', 'Repairs'], ['Email', 'Scheduled Reports'], ['Branding'], ['Temp checkout', 'School calendar'], ['Running in the background', 'Appearance'],
    ])
  })
})
