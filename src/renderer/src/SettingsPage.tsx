import { useEffect, useRef, useState } from 'react'
import { BRAND_DEFAULTS, HEX, type BrandingInput } from '../../main/branding'
import type { Appearance, Background, MailInput, Settings, SettingsInput, TempCheckout } from '../../main/config'
import { applyColors } from './branding'
import { formatCalendar } from '../../main/calendar'
import { ScheduledReports } from './ReportsView'

// onSaved: the connection may have changed, so the session starts over. onAppearance: only the look did.
/** Plain HTTP to another machine, LAN included: the token and data cross the network readable. Allowed, but warned (ADR 0002). */
export function unencryptedRemote(baseUrl: string) {
  let url: URL
  try { url = new URL(baseUrl.trim()) } catch { return false }
  return url.protocol === 'http:' && !['localhost', '[::1]'].includes(url.hostname) && !/^127(\.\d+){3}$/.test(url.hostname)
}

/** The page's tabs: what talks to Snipe-IT, email and the Report Schedules, the organisation's look, the Temp checkout rules, and this PC alone. */
const TABS = [['snipeit', 'Snipe-IT'], ['mail', 'Email & Reports'], ['branding', 'Branding'], ['checkouts', 'Checkouts'], ['pc', 'This PC']] as const

export function SettingsPage({ settings, onSaved, onAppearance }: { settings: Settings; onSaved: (value: Settings) => void; onAppearance: (value: Settings) => void }) {
  const [baseUrl, setBaseUrl] = useState(settings.baseUrl)
  const [apiKey, setApiKey] = useState('')
  const [version, setVersion] = useState('Not connected')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  // Which section's Save or test the message is about, so it shows there.
  const [place, setPlace] = useState<'connection' | 'mail' | 'branding' | 'background' | 'temp' | 'calendar' | 'repairs'>('connection')
  // Every tab stays mounted, so what's typed on one survives a look at another.
  const [tab, setTab] = useState<(typeof TABS)[number][0]>('snipeit')
  const [endOfDay, setEndOfDay] = useState(settings.tempCheckout.endOfDay)
  const [automaticAt, setAutomaticAt] = useState(settings.tempCheckout.automaticAt)
  const [calendar, setCalendar] = useState(() => formatCalendar(settings.schoolCalendar))
  const [mail, setMail] = useState<MailInput>({ ...settings.mail, password: '' })
  const [appearanceError, setAppearanceError] = useState('')
  const [repairType, setRepairType] = useState(settings.repairTypeId?.toString() ?? '')
  const [brand, setBrand] = useState<BrandingInput>(() => { const { icon: _, ...b } = settings.branding; return b })
  const setBrandField = (change: Partial<BrandingInput>) => { setBrand((b) => ({ ...b, ...change })); setMessage('') }
  // The colours show on the page as typed; leaving the page puts the saved ones (as of then, hence the ref) back.
  const savedBrand = useRef(settings.branding)
  savedBrand.current = settings.branding
  useEffect(() => applyColors(brand), [brand.primary, brand.accent])
  useEffect(() => () => applyColors(savedBrand.current), [])
  const [recipient, setRecipient] = useState<{ to?: string; error?: string }>({})
  const setMailField = (change: Partial<MailInput>) => { setMail((m) => ({ ...m, ...change })); setMessage('') }
  // Default Location is no longer offered; saving clears any previously stored one.
  const input: SettingsInput = { baseUrl, apiKey, defaultLocation: null }

  // Checked on opening and after each connection save, not when other settings (Appearance, Email) change, so a
  // Test connection result stays put.
  const [connectionSaves, setConnectionSaves] = useState(0)
  useEffect(() => {
    if (!settings.hasToken) return
    let stale = false
    window.settings.test({ ...settings, apiKey: '' }).then((r) => !stale && setVersion(r.version), () => !stale && setVersion('Unavailable'))
    window.snipeIt.operatorEmail().then((to) => !stale && setRecipient({ to }), (e: Error) => !stale && setRecipient({ error: e.message }))
    return () => { stale = true }
  }, [connectionSaves, settings.hasToken])

  async function run(work: () => Promise<void>, where: typeof place = 'connection') {
    setBusy(true); setMessage(''); setError(''); setPlace(where)
    try { await work() } catch (e) { setError((e as Error).message) }
    finally { setBusy(false) }
  }

  const toggle = (change: Partial<TempCheckout>) =>
    run(async () => { onSaved(await window.settings.saveTempCheckout({ ...settings.tempCheckout, ...change })); setMessage('Saved.') }, 'temp')

  const notes = <>
    {message && <p className="settings-success" role="status">{message}</p>}
    {error && <p className="message error" role="alert">{error}</p>}
  </>
  return <>
  <header className="head"><h1>Settings</h1></header>
  <div className="view-tabs" role="tablist" aria-label="Settings">
    {TABS.map(([key, name]) => <button key={key} role="tab" aria-selected={tab === key} className={tab === key ? 'on' : undefined} onClick={() => setTab(key)}>{name}</button>)}
  </div>
  <div className="settings-page" role="tabpanel" hidden={tab !== 'snipeit'}>
    <form onSubmit={(e) => { e.preventDefault(); run(async () => {
      const saved = await window.settings.save(input)
      setApiKey(''); onSaved(saved); setConnectionSaves((n) => n + 1); setMessage(saved.plaintext ? 'Settings saved. No OS password store was found, so the API token is stored unencrypted in a file only your user account can read.' : 'Settings saved.')
    }) }}>
      <fieldset disabled={busy}>
        <section className="settings-section">
          <h2>Connection</h2><p className="dim">Use your personal Snipe-IT API token.</p>
          <label htmlFor="server-url">Snipe-IT server URL</label>
          <input id="server-url" type="url" required placeholder="https://snipeit.example.org" value={baseUrl} onChange={(e) => { setBaseUrl(e.target.value); setApiKey(''); setVersion('Not connected'); setMessage('') }} />
          {unencryptedRemote(baseUrl) && <p className="notice warning" role="status">This server uses unencrypted HTTP. Your API token and inventory data can be read by anyone on the same network. Use https:// if your server supports it.</p>}
          <label htmlFor="api-token">API token</label>
          <div className="connection-row"><input id="api-token" type="password" autoComplete="new-password" value={apiKey} placeholder={settings.hasToken && baseUrl === settings.baseUrl ? (settings.plaintext ? 'Saved (unencrypted)' : 'Saved securely') + '. Leave blank to keep it.' : 'Paste your API token'} onChange={(e) => { setApiKey(e.target.value); setMessage(''); setVersion('Not connected') }} />
            <button type="button" onClick={() => run(async () => {
              const result = await window.settings.test(input)
              setVersion(result.version); setMessage('Connected successfully. Credentials have not been saved yet.')
            })}>Test connection</button></div>
          <p className="hint">{settings.plaintext ? 'No OS password store found: saved unencrypted, readable only by your user account.' : 'Encrypted with your OS credential store when available.'}</p>
          <div className="settings-footer"><button className="primary" type="submit">{busy ? 'Working…' : 'Save settings'}</button><span className="dim">Changes apply immediately after saving.</span></div>
        </section>
      </fieldset>
    </form>
    {place === 'connection' && notes}
    <section className="settings-about"><h2>About</h2><dl><div><dt>Snipe-IT Desktop</dt><dd>{settings.appVersion}</dd></div><div><dt>Snipe-IT server</dt><dd>{version}</dd></div></dl>
      <button className="clear-token" disabled={busy || !settings.hasToken} onClick={() => run(async () => { const saved = await window.settings.clearToken(); setApiKey(''); setVersion('Not connected'); onSaved(saved); setMessage('API token cleared. You are logged out.') })}>Log out / clear token</button>
    </section>
    <form onSubmit={(e) => { e.preventDefault(); run(async () => {
      const saved = await window.settings.saveRepairs(repairType)
      setRepairType(saved.repairTypeId?.toString() ?? ''); onSaved(saved); setMessage('Repair settings saved.')
    }, 'repairs') }}>
      <fieldset disabled={busy}>
        <section className="settings-section">
          <h2>Repairs</h2><p className="dim">How Repair intake opens a repair Maintenance.</p>
          <label htmlFor="repair-type">Maintenance type for repairs</label>
          <input id="repair-type" inputMode="numeric" placeholder="Blank: found in Snipe-IT" value={repairType} onChange={(e) => { setRepairType(e.target.value); setMessage('') }} />
          <p className="hint">Only needed if your API key can't read Maintenance types and Snipe-IT has no Repair Maintenance yet. A whole number above 0, or blank.</p>
        </section>
        <div className="settings-footer"><button className="primary" type="submit">{busy ? 'Working…' : 'Save repair settings'}</button></div>
      </fieldset>
    </form>
    {place === 'repairs' && notes}
  </div>
  <div className="settings-page" role="tabpanel" hidden={tab !== 'mail'}>
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
          <div className="settings-footer"><button className="primary" type="submit">{busy ? 'Working…' : 'Save email settings'}</button></div>
        </section>
      </fieldset>
    </form>
    {place === 'mail' && notes}
    {settings.hasToken ? <ScheduledReports /> : <section className="settings-section"><h2>Scheduled Reports</h2><p className="dim">Connect to Snipe-IT first.</p></section>}
  </div>
  <div className="settings-page" role="tabpanel" hidden={tab !== 'branding'}>
    <form onSubmit={(e) => { e.preventDefault(); run(async () => {
      const saved = await window.settings.saveBranding(brand)
      const { icon: _, ...b } = saved.branding
      setBrand(b); onSaved(saved); setMessage('Branding saved.')
    }, 'branding') }}>
      <fieldset disabled={busy}>
        <section className="settings-section">
          <h2>Branding</h2><p className="dim">Your organisation's name, icon and colours, in the app and on exported Reports.</p>
          <label htmlFor="brand-name">Organisation name</label>
          <input id="brand-name" required maxLength={80} value={brand.name} onChange={(e) => setBrandField({ name: e.target.value })} />
          <label htmlFor="brand-icon">Icon</label>
          <div className="brand-icon">
            {settings.branding.icon ? <img className="logo" src={settings.branding.icon} alt="Your icon" /> : <span className="logo" aria-hidden="true">{brand.name.trim()[0] ?? ''}</span>}
            <button id="brand-icon" type="button" onClick={() => run(async () => { onSaved(await window.settings.pickIcon()) }, 'branding')}>Choose PNG…</button>
            {settings.branding.icon && <button type="button" onClick={() => run(async () => { onSaved(await window.settings.removeIcon()); setMessage('Icon removed.') }, 'branding')}>Remove</button>}
          </div>
          <p className="hint">A square PNG, 256 px or larger. Shown in the sidebar, the window and taskbar, the tray, and on exported Reports. The Start menu or launcher keeps the installed icon.</p>
          {([['primary', 'Primary colour', 'The logo tile and buttons.'], ['accent', 'Accent colour', 'The selection marker and focus ring, and buttons in the dark theme.']] as const).map(([key, name, hint]) => <div key={key}>
            <label htmlFor={`brand-${key}`}>{name}</label>
            <div className="color-row">
              <input type="color" aria-label={`${name} picker`} value={HEX.test(brand[key]) ? brand[key] : '#000000'} onChange={(e) => setBrandField({ [key]: e.target.value })} />
              <input id={`brand-${key}`} type="text" required pattern="#[0-9a-fA-F]{6}" spellCheck={false} value={brand[key]} onChange={(e) => setBrandField({ [key]: e.target.value })} />
              <span className="hint" style={{ margin: 0 }}>{hint}</span>
            </div>
          </div>)}
          <label htmlFor="brand-footer">Report footer line</label>
          <input id="brand-footer" maxLength={200} placeholder="Blank: none" value={brand.footer} onChange={(e) => setBrandField({ footer: e.target.value })} />
          <p className="hint">On exported HTML and PDF Reports, under the table on every page. The app's own name stays only on About and the installer.</p>
          <div className="settings-footer"><button className="primary" type="submit">{busy ? 'Working…' : 'Save branding'}</button>
            <button type="button" onClick={() => setBrandField({ primary: BRAND_DEFAULTS.primary, accent: BRAND_DEFAULTS.accent })}>Reset colours</button></div>
        </section>
      </fieldset>
    </form>
    {place === 'branding' && notes}
  </div>
  <div className="settings-page" role="tabpanel" hidden={tab !== 'checkouts'}>
    {/* Temp checkout and School calendar: read on this PC at each Temp checkout, so saving them never clears a Workflow. */}
    <form onSubmit={(e) => { e.preventDefault(); run(async () => { onSaved(await window.settings.saveTempCheckout({ ...settings.tempCheckout, endOfDay, automaticAt })); setMessage('Temp checkout settings saved.') }, 'temp') }}>
      <fieldset disabled={busy}>
        <section className="settings-section">
          <h2>Temp checkout</h2><p className="dim">When Temp checkouts are due back.</p>
          <label htmlFor="end-of-day">End-of-day time</label>
          <input id="end-of-day" type="time" required value={endOfDay} onChange={(e) => { setEndOfDay(e.target.value); setMessage('') }} />
          <p className="hint">A Temp checkout is due at this time on a School day, or on the next School day once it has passed. A half day in the School calendar ends at its own time.</p>
          {/* The switches save on change, with the times as saved, not as typed. */}
          <label className="check"><input type="checkbox" checked={settings.tempCheckout.reminder} onChange={(e) => toggle({ reminder: e.target.checked })} />
            <span>End-of-day reminder<span className="hint">To get it with the window closed, turn on Keep running in the tray and Start at login.</span></span></label>
          {/* The time saves with the section. Clicking it doesn't toggle the switch: a label toggles only its first control. */}
          <label className="check"><input type="checkbox" checked={settings.tempCheckout.automatic} onChange={(e) => toggle({ automatic: e.target.checked })} />
            <span>Check in Temp checkouts still out at <input className="inline-time" type="time" required value={automaticAt} aria-label="Automatic check-in time" onChange={(e) => { setAutomaticAt(e.target.value); setMessage('') }} />
              <span className="hint">Once each School day, and on a half day the same gap after its end. Each is checked in as if it came back, with an [Automatic check-in] note and its Status Label unchanged, so it leaves the Overdue list.</span></span></label>
        </section>
        <div className="settings-footer"><button className="primary" type="submit">{busy ? 'Working…' : 'Save Temp checkout settings'}</button></div>
      </fieldset>
    </form>
    {place === 'temp' && notes}
    <form onSubmit={(e) => { e.preventDefault(); run(async () => {
      const saved = await window.settings.saveSchoolCalendar(calendar)
      onSaved(saved); setCalendar(formatCalendar(saved.schoolCalendar)); setMessage('School calendar saved.')
    }, 'calendar') }}>
      <fieldset disabled={busy}>
        <section className="settings-section">
          <h2>School calendar</h2><p className="dim">Holidays, breaks and half days, typed in once a year. This PC keeps its own copy: to share it, copy the text into the same box on another PC.</p>
          <label htmlFor="school-calendar">One entry per line, each with a label</label>
          <textarea id="school-calendar" rows={8} spellCheck={false} value={calendar} onChange={(e) => { setCalendar(e.target.value); setMessage('') }}
            placeholder={'2026-11-26 Thanksgiving\n2026-11-23 to 2026-11-27 Thanksgiving break\n2026-12-18 half day 12:00 Winter concert'} />
          <p className="hint">A date, a range (date to date), or a half day with its end time; a range can be a half day too. Weekends are never School days. Leave it empty and every weekday is a School day.</p>
        </section>
        <div className="settings-footer"><button className="primary" type="submit">{busy ? 'Working…' : 'Save School calendar'}</button></div>
      </fieldset>
    </form>
    {place === 'calendar' && notes}
  </div>
  <div className="settings-page" role="tabpanel" hidden={tab !== 'pc'}>
    <fieldset disabled={busy}>
      <section className="settings-section">
        <h2>Running in the background</h2><p className="dim">So scheduled Reports and the End-of-day reminder still happen with the window closed.</p>
        {([['tray', 'Keep running in the tray', 'Closing the window hides it. Open it again from the tray icon, or by starting the app again; quit from the tray icon.'],
          ['startAtLogin', 'Start at login', 'With Keep running in the tray on too, it starts hidden in the tray.']] as const).map(([key, name, hint]) =>
          <label key={key} className="check"><input type="checkbox" checked={settings.background[key]} onChange={(e) => {
            const background: Background = { ...settings.background, [key]: e.target.checked }
            run(async () => { onSaved(await window.settings.saveBackground(background)); setMessage('Saved.') }, 'background')
          }} /><span>{name}<span className="hint">{hint}</span></span></label>)}
      </section>
    </fieldset>
    {place === 'background' && notes}
    <section className="settings-section">
      <h2>Appearance</h2><p className="dim">On this PC only. System follows your computer's light or dark setting.</p>
      <label htmlFor="appearance">Theme</label>
      <select id="appearance" value={settings.appearance} onChange={(e) => {
        const appearance = e.target.value as Appearance
        // Not through run(): it stays usable (and keeps focus) while a test or save runs, without ending that one's busy state.
        setAppearanceError('')
        window.settings.saveAppearance(appearance).then(onAppearance, (err: Error) => setAppearanceError(err.message))
      }}><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></select>
    </section>
    {appearanceError && <p className="message error" role="alert">{appearanceError}</p>}
  </div>
  </>
}
