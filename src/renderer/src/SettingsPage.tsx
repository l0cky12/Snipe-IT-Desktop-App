import { useEffect, useState } from 'react'
import type { Settings, SettingsInput } from '../../main/config'
import type { StatusLabel } from '../../main/snipeit'

export function SettingsPage({ settings, onSaved }: { settings: Settings; onSaved: (value: Settings) => void }) {
  const [baseUrl, setBaseUrl] = useState(settings.baseUrl)
  const [apiKey, setApiKey] = useState('')
  const [defaultLocation, setLocation] = useState(settings.defaultLocation)
  const [locations, setLocations] = useState<StatusLabel[]>([])
  const [version, setVersion] = useState('Not connected')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const input: SettingsInput = { baseUrl, apiKey, defaultLocation }

  useEffect(() => {
    if (!settings.hasToken) return
    let stale = false
    window.settings.test({ ...settings, apiKey: '' }).then((r) => !stale && setVersion(r.version), () => !stale && setVersion('Unavailable'))
    window.settings.locations({ ...settings, apiKey: '' }).then((r) => !stale && setLocations(r), (e: Error) => !stale && setError(e.message))
    return () => { stale = true }
  }, [settings])

  async function run(work: () => Promise<void>) {
    setBusy(true); setMessage(''); setError('')
    try { await work() } catch (e) { setError((e as Error).message) }
    finally { setBusy(false) }
  }

  return <div className="settings-page">
    <header><span className="eyebrow">WORKSPACE</span><h1>Settings</h1><p className="dim">Connect to Snipe-IT and set your default Location.</p></header>
    <form onSubmit={(e) => { e.preventDefault(); run(async () => {
      const saved = await window.settings.save(input)
      setApiKey(''); onSaved(saved); setMessage('Settings saved.')
    }) }}>
      <fieldset disabled={busy}>
        <section className="settings-section">
          <h2>Connection</h2><p className="dim">Use your personal Snipe-IT API token.</p>
          <label htmlFor="server-url">Snipe-IT server URL</label>
          <input id="server-url" type="url" required placeholder="https://snipeit.example.org" value={baseUrl} onChange={(e) => { setBaseUrl(e.target.value); setApiKey(''); setLocation(null); setLocations([]); setVersion('Not connected'); setMessage('') }} />
          <label htmlFor="api-token">API token</label>
          <div className="connection-row"><input id="api-token" type="password" autoComplete="new-password" value={apiKey} placeholder={settings.hasToken && baseUrl === settings.baseUrl ? 'Saved securely · leave blank to keep' : 'Paste your API token'} onChange={(e) => { setApiKey(e.target.value); setMessage(''); setVersion('Not connected') }} />
            <button type="button" onClick={() => run(async () => {
              const result = await window.settings.test(input)
              setVersion(result.version); setMessage('Connected successfully. Credentials have not been saved yet.')
              setLocations(await window.settings.locations(input))
            })}>Test connection</button></div>
          <p className="hint">Encrypted with your OS credential store. Never saved as plaintext.</p>
        </section>
        <section className="settings-section">
          <h2>Default Location</h2><p className="dim">Pre-fills Checkin and Checkout to a Location. You can change it for each Asset.</p>
          <label htmlFor="default-location">Site / Location</label>
          <select id="default-location" value={defaultLocation?.id ?? ''} onChange={(e) => setLocation(locations.find((l) => l.id === Number(e.target.value)) ?? null)}>
            <option value="">No default Location</option>
            {defaultLocation && !locations.some((l) => l.id === defaultLocation.id) && <option value={defaultLocation.id}>{defaultLocation.name}</option>}
            {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
          {!locations.length && <p className="hint">Test your connection to load available Locations.</p>}
        </section>
        <div className="settings-footer"><button className="primary" type="submit">{busy ? 'Working…' : 'Save settings'}</button><span className="dim">Changes apply immediately after saving.</span></div>
      </fieldset>
    </form>
    {message && <p className="settings-success" role="status">{message}</p>}
    {error && <p className="message error" role="alert">{error}</p>}
    <section className="settings-about"><h2>About</h2><dl><div><dt>Snipe-IT Desktop</dt><dd>{settings.appVersion}</dd></div><div><dt>Snipe-IT server</dt><dd>{version}</dd></div></dl>
      <button className="clear-token" disabled={busy || !settings.hasToken} onClick={() => run(async () => { const saved = await window.settings.clearToken(); setApiKey(''); setVersion('Not connected'); setLocations([]); onSaved(saved); setMessage('API token cleared. You are logged out.') })}>Log out / clear token</button>
    </section>
  </div>
}
