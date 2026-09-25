import { useEffect, useState } from 'react'
import type { Settings, SettingsInput } from '../../main/config'

export function SettingsPage({ settings, onSaved }: { settings: Settings; onSaved: (value: Settings) => void }) {
  const [baseUrl, setBaseUrl] = useState(settings.baseUrl)
  const [apiKey, setApiKey] = useState('')
  const [version, setVersion] = useState('Not connected')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  // Default Location is no longer offered; saving clears any previously stored one.
  const input: SettingsInput = { baseUrl, apiKey, defaultLocation: null }

  useEffect(() => {
    if (!settings.hasToken) return
    let stale = false
    window.settings.test({ ...settings, apiKey: '' }).then((r) => !stale && setVersion(r.version), () => !stale && setVersion('Unavailable'))
    return () => { stale = true }
  }, [settings])

  async function run(work: () => Promise<void>) {
    setBusy(true); setMessage(''); setError('')
    try { await work() } catch (e) { setError((e as Error).message) }
    finally { setBusy(false) }
  }

  return <div className="settings-page">
    <header><span className="eyebrow">WORKSPACE</span><h1>Settings</h1><p className="dim">Connect to Snipe-IT with your API token.</p></header>
    <form onSubmit={(e) => { e.preventDefault(); run(async () => {
      const saved = await window.settings.save(input)
      setApiKey(''); onSaved(saved); setMessage(saved.plaintext ? 'Settings saved. No OS password store was found, so the API token is stored unencrypted in a file only your user account can read.' : 'Settings saved.')
    }) }}>
      <fieldset disabled={busy}>
        <section className="settings-section">
          <h2>Connection</h2><p className="dim">Use your personal Snipe-IT API token.</p>
          <label htmlFor="server-url">Snipe-IT server URL</label>
          <input id="server-url" type="url" required placeholder="https://snipeit.example.org" value={baseUrl} onChange={(e) => { setBaseUrl(e.target.value); setApiKey(''); setVersion('Not connected'); setMessage('') }} />
          <label htmlFor="api-token">API token</label>
          <div className="connection-row"><input id="api-token" type="password" autoComplete="new-password" value={apiKey} placeholder={settings.hasToken && baseUrl === settings.baseUrl ? (settings.plaintext ? 'Saved (unencrypted)' : 'Saved securely') + ' · leave blank to keep' : 'Paste your API token'} onChange={(e) => { setApiKey(e.target.value); setMessage(''); setVersion('Not connected') }} />
            <button type="button" onClick={() => run(async () => {
              const result = await window.settings.test(input)
              setVersion(result.version); setMessage('Connected successfully. Credentials have not been saved yet.')
            })}>Test connection</button></div>
          <p className="hint">{settings.plaintext ? 'No OS password store found: saved unencrypted, readable only by your user account.' : 'Encrypted with your OS credential store when available.'}</p>
        </section>
        <div className="settings-footer"><button className="primary" type="submit">{busy ? 'Working…' : 'Save settings'}</button><span className="dim">Changes apply immediately after saving.</span></div>
      </fieldset>
    </form>
    {message && <p className="settings-success" role="status">{message}</p>}
    {error && <p className="message error" role="alert">{error}</p>}
    <section className="settings-about"><h2>About</h2><dl><div><dt>Snipe-IT Desktop</dt><dd>{settings.appVersion}</dd></div><div><dt>Snipe-IT server</dt><dd>{version}</dd></div></dl>
      <button className="clear-token" disabled={busy || !settings.hasToken} onClick={() => run(async () => { const saved = await window.settings.clearToken(); setApiKey(''); setVersion('Not connected'); onSaved(saved); setMessage('API token cleared. You are logged out.') })}>Log out / clear token</button>
    </section>
  </div>
}
