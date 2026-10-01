import { useEffect, useState } from 'react'
import type { MailInput, Settings, SettingsInput } from '../../main/config'

export function SettingsPage({ settings, onSaved }: { settings: Settings; onSaved: (value: Settings) => void }) {
  const [baseUrl, setBaseUrl] = useState(settings.baseUrl)
  const [apiKey, setApiKey] = useState('')
  const [version, setVersion] = useState('Not connected')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  // Which section's Save or test the message is about, so it shows there.
  const [place, setPlace] = useState<'connection' | 'mail'>('connection')
  const [mail, setMail] = useState<MailInput>({ ...settings.mail, password: '' })
  const [recipient, setRecipient] = useState<{ to?: string; error?: string }>({})
  const setMailField = (change: Partial<MailInput>) => { setMail((m) => ({ ...m, ...change })); setMessage('') }
  // Default Location is no longer offered; saving clears any previously stored one.
  const input: SettingsInput = { baseUrl, apiKey, defaultLocation: null }

  useEffect(() => {
    if (!settings.hasToken) return
    let stale = false
    window.settings.test({ ...settings, apiKey: '' }).then((r) => !stale && setVersion(r.version), () => !stale && setVersion('Unavailable'))
    window.snipeIt.operatorEmail().then((to) => !stale && setRecipient({ to }), (e: Error) => !stale && setRecipient({ error: e.message }))
    return () => { stale = true }
  }, [settings])

  async function run(work: () => Promise<void>, where: typeof place = 'connection') {
    setBusy(true); setMessage(''); setError(''); setPlace(where)
    try { await work() } catch (e) { setError((e as Error).message) }
    finally { setBusy(false) }
  }

  const notes = <>
    {message && <p className="settings-success" role="status">{message}</p>}
    {error && <p className="message error" role="alert">{error}</p>}
  </>
  return <div className="settings-page">
    <header><h1>Settings</h1><p className="dim">Connect to Snipe-IT with your API token.</p></header>
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
          <div className="connection-row"><input id="api-token" type="password" autoComplete="new-password" value={apiKey} placeholder={settings.hasToken && baseUrl === settings.baseUrl ? (settings.plaintext ? 'Saved (unencrypted)' : 'Saved securely') + '. Leave blank to keep it.' : 'Paste your API token'} onChange={(e) => { setApiKey(e.target.value); setMessage(''); setVersion('Not connected') }} />
            <button type="button" onClick={() => run(async () => {
              const result = await window.settings.test(input)
              setVersion(result.version); setMessage('Connected successfully. Credentials have not been saved yet.')
            })}>Test connection</button></div>
          <p className="hint">{settings.plaintext ? 'No OS password store found: saved unencrypted, readable only by your user account.' : 'Encrypted with your OS credential store when available.'}</p>
        </section>
        <div className="settings-footer"><button className="primary" type="submit">{busy ? 'Working…' : 'Save settings'}</button><span className="dim">Changes apply immediately after saving.</span></div>
      </fieldset>
    </form>
    {place === 'connection' && notes}
    <form onSubmit={(e) => { e.preventDefault(); run(async () => {
      const saved = await window.settings.saveMail(mail)
      setMailField({ password: '' }); onSaved(saved); setMessage(!saved.mail.hasPassword ? 'Email settings saved. Enter the password to send email.' : saved.mail.plaintext ? 'Email settings saved. No OS password store was found, so the email password is stored unencrypted in a file only your user account can read.' : 'Email settings saved.')
    }, 'mail') }}>
      <fieldset disabled={busy}>
        <section className="settings-section">
          <h2>Email</h2><p className="dim">The mail server Reports are sent through. For Gmail, use an app password.</p>
          <label htmlFor="smtp-host">SMTP host</label>
          <input id="smtp-host" required value={mail.host} onChange={(e) => setMailField({ host: e.target.value })} />
          <div className="connection-row">
            <div><label htmlFor="smtp-port">Port</label>
              <input id="smtp-port" type="number" required min={1} max={65535} value={mail.port || ''} onChange={(e) => setMailField({ port: e.target.valueAsNumber || 0 })} /></div>
            <div><label htmlFor="smtp-security">Security</label>
              {/* Each security has its usual port; switching moves a usual port along with it. */}
              <select id="smtp-security" value={mail.security} onChange={(e) => { const security = e.target.value as MailInput['security']; setMailField({ security, ...([465, 587].includes(mail.port) && { port: security === 'ssl' ? 465 : 587 }) }) }}>
                <option value="ssl">SSL/TLS</option><option value="starttls">STARTTLS</option></select></div>
          </div>
          <label htmlFor="smtp-username">Username</label>
          <input id="smtp-username" required autoComplete="off" placeholder="you@nomma.net" value={mail.username} onChange={(e) => setMailField({ username: e.target.value })} />
          <label htmlFor="smtp-sender">Sender address</label>
          <input id="smtp-sender" type="email" required placeholder="you@nomma.net" value={mail.sender} onChange={(e) => setMailField({ sender: e.target.value })} />
          <label htmlFor="smtp-password">Password</label>
          <input id="smtp-password" type="password" autoComplete="new-password" value={mail.password} onChange={(e) => setMailField({ password: e.target.value })}
            placeholder={settings.mail.hasPassword && mail.host.trim() === settings.mail.host && mail.username.trim() === settings.mail.username ? (settings.mail.plaintext ? 'Saved (unencrypted)' : 'Saved securely') + '. Leave blank to keep it.' : 'App password'} />
          <label htmlFor="smtp-recipient">Recipient</label>
          <div className="connection-row"><input id="smtp-recipient" readOnly value={!settings.hasToken ? 'Connect to Snipe-IT first' : recipient.to ?? (recipient.error ? 'Unavailable' : 'Loading…')} />
            <button type="button" onClick={(e) => { if (e.currentTarget.form?.reportValidity()) run(async () => setMessage(`Test email sent to ${await window.settings.testMail(mail)}. Check that inbox.`), 'mail') }}>Send test email</button></div>
          {recipient.error && settings.hasToken && <p className="hint">{recipient.error}</p>}
          <p className="hint">Reports go only to your own Snipe-IT email address. The password is encrypted with your OS credential store when available.</p>
        </section>
        <div className="settings-footer"><button className="primary" type="submit">{busy ? 'Working…' : 'Save email settings'}</button></div>
      </fieldset>
    </form>
    {place === 'mail' && notes}
    <section className="settings-about"><h2>About</h2><dl><div><dt>Snipe-IT Desktop</dt><dd>{settings.appVersion}</dd></div><div><dt>Snipe-IT server</dt><dd>{version}</dd></div></dl>
      <button className="clear-token" disabled={busy || !settings.hasToken} onClick={() => run(async () => { const saved = await window.settings.clearToken(); setApiKey(''); setVersion('Not connected'); onSaved(saved); setMessage('API token cleared. You are logged out.') })}>Log out / clear token</button>
    </section>
  </div>
}
