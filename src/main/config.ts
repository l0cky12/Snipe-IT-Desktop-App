import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, rmSync, writeFileSync, renameSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { safeStorage } from 'electron'
import type { ReleaseCache } from './release'
import { BRAND_DEFAULTS, HEX, type Branding, type BrandingInput } from './branding'
import { SIDEBAR_DEFAULT, SIDEBAR_PAGES, type SidebarPage } from './sidebar'
import { END_OF_DAY, later, parseCalendar, realTime, type CalendarEntry } from './calendar'
import { FORMATS, type ExportFormat } from './report'
import { ASSET_VIEWS, LIST_SORTS, REPORT_NAMES, takesRange, type AssetView, type Config, type ListKind, type ReportKind, type StatusLabel } from './snipeit'

export type { Branding, BrandingInput } from './branding'
export type SettingsInput = { baseUrl: string; apiKey: string; defaultLocation: StatusLabel | null }
// plaintext: no OS secure storage, so the token is kept in the owner-only settings file instead.
export type Settings = Omit<SettingsInput, 'apiKey'> & { hasToken: boolean; plaintext: boolean; appVersion: string; mail: MailServer & { hasPassword: boolean; plaintext: boolean }; background: Background; appearance: Appearance; branding: Branding; sidebar: SidebarPage[]
  tempCheckout: TempCheckout; schoolCalendar: CalendarEntry[]
  /** Settings' "Maintenance type for repairs": the last step of Repair intake's Maintenance type fallback chain; null when blank. */
  repairTypeId: number | null }
/**
 * Temp checkout's settings on this PC. endOfDay: when Temp checkouts are due on a School day without a half day ("HH:MM").
 * reminder: the End-of-day reminder shows here. automatic: Automatic check-in runs here, at automaticAt ("HH:MM", after
 * endOfDay; on a half day, the same gap after that day's time). Until set, an hour after endOfDay.
 */
export type TempCheckout = { endOfDay: string; reminder: boolean; automatic: boolean; automaticAt: string }
const TEMP_CHECKOUT = { endOfDay: END_OF_DAY, reminder: true, automatic: false }
/** So schedules send with the window closed. tray: closing the window hides it to the tray. startAtLogin: hidden in the tray too when tray is on. */
export type Background = { tray: boolean; startAtLogin: boolean }
export const BACKGROUND_OFF: Background = { tray: false, startAtLogin: false }
/** Light or dark on this PC; system follows the OS. */
export const APPEARANCES = ['system', 'light', 'dark'] as const
export type Appearance = (typeof APPEARANCES)[number]
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
/**
 * ssl: TLS from the start (port 465). starttls: upgraded after connecting (port 587), never sent unencrypted.
 * domain: Reports are emailed only to an Operator whose Snipe-IT email is at it, so student information stays in the
 * organisation; blank (left out) means the sender address's domain (reportDomain).
 */
export type MailServer = { host: string; port: number; security: 'ssl' | 'starttls'; username: string; sender: string; domain?: string }
export const reportDomain = (m: MailServer) => m.domain || m.sender.slice(m.sender.lastIndexOf('@') + 1).toLowerCase()
/** A blank password keeps the saved one, as long as the mail server's host and username are the same. */
export type MailInput = MailServer & { password: string }
const GMAIL: MailServer = { host: 'smtp.gmail.com', port: 465, security: 'ssl', username: '', sender: '' }
export type SettingsApi = {
  get(): Promise<Settings>
  save(input: SettingsInput): Promise<Settings>
  test(input: SettingsInput): Promise<{ version: string }>
  locations(input: SettingsInput): Promise<StatusLabel[]>
  clearToken(): Promise<Settings>
  saveMail(input: MailInput): Promise<Settings>
  saveBackground(input: Background): Promise<Settings>
  saveAppearance(input: Appearance): Promise<Settings>
  saveBranding(input: BrandingInput): Promise<Settings>
  /** Opens a file dialog for a PNG icon; cancelling changes nothing. */
  pickIcon(): Promise<Settings>
  removeIcon(): Promise<Settings>
  /** The sidebar's pages to show, on this PC; any order, kept in sidebar order. */
  saveSidebar(input: SidebarPage[]): Promise<Settings>
  saveTempCheckout(input: TempCheckout): Promise<Settings>
  /** The School calendar box's text; throws "Line N: …" and saves nothing when a line is bad. */
  saveSchoolCalendar(text: string): Promise<Settings>
  /** The Maintenance type for repairs as typed: a whole number above 0, or blank for none. */
  saveRepairs(maintenanceTypeId: string): Promise<Settings>
  /** Sends a test email with what's typed to the Operator's Snipe-IT email; resolves to that address. */
  testMail(input: MailInput): Promise<string>
  savedReports(): Promise<SavedReport[]>
  saveReport(report: SavedReportInput): Promise<SavedReport>
  renameReport(id: string, name: string): Promise<SavedReport[]>
  deleteReport(id: string): Promise<SavedReport[]>
  schedules(): Promise<Scheduled[]>
  /** null stops the schedule. */
  setSchedule(report: ScheduleKey, schedule: Schedule | null): Promise<Scheduled[]>
}
/** A List as the Operator saved it. label names a drilled-into filter that has no filter box ("Checked out to …").
 * view: an Assets one's View (All when left out). */
/** A List saved as a Saved Report: its search, filters, sort, Columns and, for Assets, its View. */
export type ListReportQuery = { kind: ListKind; search: string; filters: Record<string, string>; label?: string; sort: { key: string; order: 'asc' | 'desc' } | null; columns: string[]; view?: AssetView }
/** A Custom Asset Report saved as a template: its columns and filters (see CUSTOM_FILTERS). It has no search, sort or View. */
export type CustomReportQuery = { kind: 'custom'; search: ''; filters: Record<string, string>; label?: undefined; sort: null; columns: string[]; view?: undefined }
export type SavedReportQuery = ListReportQuery | CustomReportQuery
// Re-saving and renaming leave its schedule be.
export type SavedReport = SavedReportQuery & { id: string; name: string; schedule?: KeptSchedule }
/** A Saved Report that opens as a List (every one but a Custom Asset Report template). */
export type SavedListReport = Exclude<SavedReport, { kind: 'custom' }>
/** No id: a new Saved Report. An id: re-saves that one. */
export type SavedReportInput = SavedReportQuery & { id?: string; name: string }
/**
 * When a Report emails itself: every day, week (day: 0 Sunday to 6 Saturday) or month (day: 1 to 31, the month's last
 * day in a shorter month) at time ("HH:MM", local). range: a built-in Report's dates: the 1, 7 or 30 whole days before
 * the day it sends (so daily and weekly sends neither miss a day nor repeat one), or from the day of the last send. None
 * (and always for a Report not in RANGED_REPORTS, such as Warranty expiring, which looks ahead, or a Saved Report, whose List
 * has no dates): all of it. No Schedule keeps a Location or Category: an audit Report's send covers all of them.
 * format: the file it sends, HTML or PDF with the Branding; left out, CSV (so Schedules from before the choice send CSV).
 */
export type Schedule = { every: 'day' | 'week' | 'month'; day?: number; time: string; range?: 1 | 7 | 30 | 'since'; format?: ExportFormat }
/** A scheduled send: when, and the rows it sent or why it failed. */
export type LastSend = { at: string; rows: number } | { at: string; error: string }
/** A Schedule as kept. since: when it was set; last: the last send; sentAt: the last send that went out. */
export type KeptSchedule = Schedule & { since: string; last?: LastSend; sentAt?: string }
export type ScheduleKey = { saved: string } | { builtIn: ReportKind }
export type Scheduled = { report: ScheduleKey; schedule: KeptSchedule }
type Stored = { baseUrl: string; encryptedToken?: string; plainToken?: string; defaultLocation: StatusLabel | null; savedReports?: SavedReport[]
  builtInSchedules?: Partial<Record<ReportKind, KeptSchedule>>; mail?: MailServer; encryptedMailPassword?: string; plainMailPassword?: string; background?: Background; appearance?: Appearance; branding?: Partial<BrandingInput>; sidebar?: SidebarPage[]
  release?: ReleaseCache; repairTypeId?: number | null
  tempCheckout?: Partial<TempCheckout>; schoolCalendar?: CalendarEntry[]; reminderDay?: string; automaticDay?: string }

const isStrings = (v: unknown, of: 'array' | 'record') =>
  (of === 'array' ? Array.isArray(v) : !!v && typeof v === 'object' && !Array.isArray(v)) && Object.values(v as object).every((x) => typeof x === 'string')
// What comes from the screen, checked and with emptied filters dropped, so the store only ever holds a List it can open.
function reportQuery(r: SavedReportInput): SavedReportQuery & { name: string } {
  const name = typeof r?.name === 'string' ? r.name.trim() : ''
  if (!name) throw new Error('Name the report.')
  if (r.kind === 'custom') {
    if (!isStrings(r.filters, 'record') || !isStrings(r.columns, 'array') || r.sort !== null || r.view !== undefined) throw new Error('Invalid report')
    if (!r.columns.length) throw new Error('Choose at least one column.')
    return { name, kind: 'custom', search: '', filters: Object.fromEntries(Object.entries(r.filters).filter(([, v]) => v)), sort: null, columns: [...r.columns] }
  }
  const sorts: Record<string, string> | undefined = Object.hasOwn(LIST_SORTS, r.kind) ? LIST_SORTS[r.kind] : undefined
  if (!sorts || typeof r.search !== 'string' || !isStrings(r.filters, 'record') || !isStrings(r.columns, 'array') || (r.label !== undefined && typeof r.label !== 'string')
    || (r.sort !== null && !(Object.hasOwn(sorts, r.sort?.key) && ['asc', 'desc'].includes(r.sort.order)))
    || (r.view !== undefined && (r.kind !== 'assets' || typeof r.view !== 'string' || !Object.hasOwn(ASSET_VIEWS, r.view))))
    throw new Error('Invalid report')
  const filters = Object.fromEntries(Object.entries(r.filters).filter(([, v]) => v))
  return { name, kind: r.kind, search: r.search, filters, ...(r.label && { label: r.label }), sort: r.sort && { key: r.sort.key, order: r.sort.order }, columns: [...r.columns],
    ...(r.view && r.view !== 'all' && { view: r.view }) }
}

function checkMail(m: MailInput): MailServer {
  const host = typeof m?.host === 'string' ? m.host.trim() : ''
  if (!host) throw new Error('Enter the mail server (SMTP host).')
  if (!Number.isInteger(m.port) || m.port < 1 || m.port > 65535) throw new Error('Enter a mail server port from 1 to 65535.')
  if (!['ssl', 'starttls'].includes(m.security)) throw new Error('Choose SSL/TLS or STARTTLS security.')
  const username = typeof m.username === 'string' ? m.username.trim() : ''
  if (!username) throw new Error('Enter the email username.')
  const sender = typeof m.sender === 'string' ? m.sender.trim() : ''
  if (!/^[^\s@]+@[^\s@]+$/.test(sender)) throw new Error('Enter the sender email address.')
  if (typeof m.password !== 'string') throw new Error('Invalid email password')
  const domain = typeof m.domain === 'string' ? m.domain.trim().toLowerCase() : ''
  if (domain && !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain)) throw new Error("Enter the email domain like nomma.net, or leave it blank for the sender address's.")
  return { host, port: m.port, security: m.security, username, sender, ...(domain && { domain }) }
}

// What comes from the screen, checked, keeping only what its frequency and Report use. ranged: the Report has past dates to narrow.
function checkSchedule(s: Schedule, ranged: boolean): Schedule {
  if (!['day', 'week', 'month'].includes(s?.every)) throw new Error('Choose daily, weekly or monthly.')
  if (s.every === 'week' && !(Number.isInteger(s.day) && s.day! >= 0 && s.day! <= 6)) throw new Error('Choose the day of the week.')
  if (s.every === 'month' && !(Number.isInteger(s.day) && s.day! >= 1 && s.day! <= 31)) throw new Error('Choose a date from 1 to 31.')
  if (typeof s.time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(s.time)) throw new Error('Choose the time to send it.')
  if (s.range !== undefined && ![1, 7, 30, 'since'].includes(s.range)) throw new Error('Choose the date range.')
  if (s.format !== undefined && !Object.hasOwn(FORMATS, s.format)) throw new Error('Choose CSV, HTML or PDF.')
  return { every: s.every, ...(s.every !== 'day' && { day: s.day }), time: s.time, ...(ranged && s.range !== undefined && { range: s.range }), ...(s.format && s.format !== 'csv' && { format: s.format }) }
}

function checkBranding(b: BrandingInput): BrandingInput {
  const name = typeof b?.name === 'string' ? b.name.trim() : ''
  if (!name || name.length > 80) throw new Error('Enter the organisation name, up to 80 characters.')
  for (const [key, label] of [['primary', 'primary'], ['accent', 'accent']] as const)
    if (typeof b[key] !== 'string' || !HEX.test(b[key])) throw new Error(`Enter the ${label} colour as six hex digits, like #14285a.`)
  const footer = typeof b.footer === 'string' ? b.footer.trim() : null
  if (footer === null || footer.length > 200) throw new Error('The report footer line can be up to 200 characters.')
  return { name, primary: b.primary.toLowerCase(), accent: b.accent.toLowerCase(), footer }
}

function tempCheckout(saved?: Partial<TempCheckout>): TempCheckout {
  const t = { ...TEMP_CHECKOUT, ...saved }
  return { ...t, automaticAt: t.automaticAt ?? later(t.endOfDay, 60) ?? '23:59' }
}

export function createSettingsStore(path: string, storage: Pick<typeof safeStorage, 'isEncryptionAvailable' | 'getSelectedStorageBackend' | 'encryptString' | 'decryptString'>, appVersion: string) {
  function read(): Stored {
    try { return JSON.parse(readFileSync(path, 'utf8')) }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { baseUrl: '', defaultLocation: null }
      throw new Error('Could not read saved settings. Check the settings file before trying again.')
    }
  }
  const available = () => storage.isEncryptionAvailable() && !(process.platform === 'linux' && ['basic_text', 'unknown'].includes(storage.getSelectedStorageBackend()))
  function secure() {
    if (!available())
      throw new Error('OS secure storage is unavailable. Unlock your keychain or enable a system password store, then try again.')
  }
  function write(value: Stored) {
    writeFileSync(path + '.tmp', JSON.stringify(value), { mode: 0o600 })
    renameSync(path + '.tmp', path)
  }
  // The icon lives beside settings.json, not in it: a PNG in JSON would be read and parsed on every setting.
  const iconFile = join(dirname(path), 'branding-icon.png')
  const iconPath = () => (existsSync(iconFile) ? iconFile : null)
  const withoutToken = ({ encryptedToken: _, plainToken: __, ...rest }: Stored): Stored => rest
  const withoutMailPassword = ({ encryptedMailPassword: _, plainMailPassword: __, ...rest }: Stored): Stored => rest
  const savedReports = () => read().savedReports ?? []
  const gone = (): never => { throw new Error('That Saved Report no longer exists.') }
  function schedules(): Scheduled[] {
    const value = read()
    return [...Object.entries(value.builtInSchedules ?? {}).map(([builtIn, schedule]) => ({ report: { builtIn: builtIn as ReportKind }, schedule })),
      ...(value.savedReports ?? []).flatMap((r) => (r.schedule ? [{ report: { saved: r.id }, schedule: r.schedule }] : []))]
  }
  // Gives a Report the schedule change() makes of the one it has (undefined: none). A Saved Report that's gone: missing().
  function reschedule(key: ScheduleKey, change: (old?: KeptSchedule) => KeptSchedule | undefined, missing: () => void) {
    const saved = read()
    if (!key || typeof key !== 'object') throw new Error(`Unknown report: ${key}`)
    if ('builtIn' in key && Object.hasOwn(REPORT_NAMES, key.builtIn)) {
      const { [key.builtIn]: old, ...rest } = saved.builtInSchedules ?? {}
      const schedule = change(old)
      return write({ ...saved, builtInSchedules: { ...rest, ...(schedule && { [key.builtIn]: schedule }) } })
    }
    if (!('saved' in key)) throw new Error(`Unknown report: ${(key as { builtIn?: string }).builtIn}`)
    const reports = saved.savedReports ?? []
    const old = reports.find((r) => r.id === key.saved)
    if (!old) return missing()
    const { schedule: was, ...rest } = old
    const schedule = change(was)
    write({ ...saved, savedReports: reports.map((r) => (r === old ? { ...rest, ...(schedule && { schedule }) } : r)) })
  }
  function get(): Settings {
    const value = read()
    return { baseUrl: value.baseUrl, defaultLocation: value.defaultLocation, hasToken: !!(value.encryptedToken || value.plainToken), plaintext: !!value.plainToken, appVersion,
      mail: { ...(value.mail ?? GMAIL), hasPassword: !!(value.encryptedMailPassword || value.plainMailPassword), plaintext: !!value.plainMailPassword },
      background: value.background ?? BACKGROUND_OFF, appearance: value.appearance ?? 'system', sidebar: value.sidebar ?? SIDEBAR_DEFAULT, repairTypeId: value.repairTypeId ?? null,
      tempCheckout: tempCheckout(value.tempCheckout), schoolCalendar: value.schoolCalendar ?? [],
      branding: { ...BRAND_DEFAULTS, ...value.branding, icon: iconPath() && `data:image/png;base64,${readFileSync(iconFile).toString('base64')}` } }
  }
  // The saved email password, only for the host and username it was saved for, so it never goes to a changed mail server or account.
  function savedMailPassword(saved: Stored, { host, username }: MailServer) {
    if (host !== saved.mail?.host || username !== saved.mail.username) return ''
    if (saved.plainMailPassword) return saved.plainMailPassword
    if (!saved.encryptedMailPassword) return ''
    secure()
    try { return storage.decryptString(Buffer.from(saved.encryptedMailPassword, 'base64')) }
    catch { throw new Error('Could not unlock the saved email password. Enter it again.') }
  }
  function credentials(input?: SettingsInput): Config {
    const saved = read()
    const baseUrl = (input?.baseUrl ?? saved.baseUrl).trim().replace(/\/+$/, '')
    let url: URL
    try { url = new URL(baseUrl) } catch { throw new Error('Enter a valid Snipe-IT server URL.') }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash)
      throw new Error('Use an HTTP(S) server URL without credentials, query parameters, or a fragment.')
    let apiKey = input?.apiKey.trim() ?? ''
    if (!apiKey && saved.plainToken && baseUrl === saved.baseUrl) apiKey = saved.plainToken
    if (!apiKey && saved.encryptedToken && baseUrl === saved.baseUrl) {
      secure()
      try { apiKey = storage.decryptString(Buffer.from(saved.encryptedToken, 'base64')) }
      catch { throw new Error('Could not unlock the saved API token. Enter it again or clear it.') }
    }
    if (!apiKey) throw new Error('Enter an API token for this server in Settings.')
    return { baseUrl, apiKey }
  }
  return {
    get, credentials,
    save(input: SettingsInput) {
      const config = credentials(input)
      const loc = input.defaultLocation
      if (loc !== null && (!Number.isSafeInteger(loc?.id) || loc.id <= 0 || typeof loc.name !== 'string'))
        throw new Error('Choose a valid default Location.')
      const defaultLocation = loc && { id: loc.id, name: loc.name }
      const rest = withoutToken(read())
      // No keychain: fall back to the owner-only (0600) file rather than locking the Operator out every launch.
      if (!available()) write({ ...rest, baseUrl: config.baseUrl, plainToken: config.apiKey, defaultLocation })
      else write({ ...rest, baseUrl: config.baseUrl, encryptedToken: storage.encryptString(config.apiKey).toString('base64'), defaultLocation })
      return get()
    },
    clearToken() {
      write(withoutToken(read()))
      return get()
    },
    /** The mail server to send through, with its password: what's typed (input), or what's saved. */
    mailServer(input?: MailInput): MailInput {
      const saved = read()
      const server = input ? checkMail(input) : saved.mail
      const password = input?.password || (server && savedMailPassword(saved, server))
      if (!server || !password) throw new Error('Enter the email password in Settings.')
      return { ...server, password }
    },
    saveMail(input: MailInput) {
      const mail = checkMail(input)
      const saved = read()
      const password = input.password || savedMailPassword(saved, mail)
      const rest = { ...withoutMailPassword(saved), mail }
      // Like the API token: no keychain, so the owner-only (0600) file.
      if (!password) write(rest)
      else if (!available()) write({ ...rest, plainMailPassword: password })
      else write({ ...rest, encryptedMailPassword: storage.encryptString(password).toString('base64') })
      return get()
    },
    saveBackground({ tray, startAtLogin }: Background) {
      if (typeof tray !== 'boolean' || typeof startAtLogin !== 'boolean') throw new Error('Invalid background settings')
      write({ ...read(), background: { tray, startAtLogin } })
      return get()
    },
    saveAppearance(appearance: Appearance) {
      if (!APPEARANCES.includes(appearance)) throw new Error('Invalid appearance')
      write({ ...read(), appearance })
      return get()
    },
    saveBranding(input: BrandingInput) {
      write({ ...read(), branding: checkBranding(input) })
      return get()
    },
    /** The icon file for the window and tray, or null for the app's own. */
    iconPath,
    saveIcon(bytes: Uint8Array) {
      if (!(bytes instanceof Uint8Array) || !Buffer.from(bytes.subarray(0, 8)).equals(PNG)) throw new Error('Choose a PNG image.')
      if (bytes.length > 2_000_000) throw new Error('Choose a PNG under 2 MB.')
      writeFileSync(iconFile + '.tmp', bytes, { mode: 0o600 })
      renameSync(iconFile + '.tmp', iconFile)
      return get()
    },
    removeIcon() {
      rmSync(iconFile, { force: true })
      return get()
    },
    saveSidebar(sidebar: SidebarPage[]) {
      if (!Array.isArray(sidebar) || !sidebar.every((p) => SIDEBAR_PAGES.includes(p))) throw new Error('Invalid sidebar pages')
      // Kept in sidebar order, once each, so the sidebar never depends on the order the boxes were ticked.
      write({ ...read(), sidebar: SIDEBAR_PAGES.filter((p) => sidebar.includes(p)) })
      return get()
    },
    /** The newer Snipe-IT release check's cache and hidden tag, on this PC (see createReleaseCheck). */
    release: (): ReleaseCache => read().release ?? {},
    saveRelease(release: ReleaseCache) {
      write({ ...read(), release })
    },
    saveTempCheckout({ endOfDay, reminder, automatic, automaticAt }: TempCheckout) {
      if (typeof endOfDay !== 'string' || !realTime(endOfDay)) throw new Error('Enter the end-of-day time as HH:MM, like 14:50.')
      // 00:00 would read back as a date-only Expected Checkin (#71).
      if (endOfDay === '00:00') throw new Error("The end-of-day time can't be midnight.")
      if (typeof automaticAt !== 'string' || !realTime(automaticAt)) throw new Error('Enter the Automatic check-in time as HH:MM, like 15:50.')
      if (typeof reminder !== 'boolean' || typeof automatic !== 'boolean') throw new Error('Invalid Temp checkout settings')
      // Before the end-of-day time nothing is Overdue, so it would check in nothing. Only when on: off, it's no reason to refuse an end-of-day time.
      if (automatic && automaticAt <= endOfDay) throw new Error('Automatic check-in must be after the end-of-day time')
      write({ ...read(), tempCheckout: { endOfDay, reminder, automatic, automaticAt } })
      return get()
    },
    /** The last day ("YYYY-MM-DD") the End-of-day reminder ran, so a restart doesn't repeat it. */
    lastReminder: () => read().reminderDay,
    recordReminder(day: string) {
      write({ ...read(), reminderDay: day })
    },
    /** The last day Automatic check-in ran, so it never runs twice in a day. */
    lastAutomatic: () => read().automaticDay,
    recordAutomatic(day: string) {
      write({ ...read(), automaticDay: day })
    },
    saveSchoolCalendar(text: string) {
      if (typeof text !== 'string') throw new Error('Invalid School calendar')
      write({ ...read(), schoolCalendar: parseCalendar(text) })
      return get()
    },
    // Not checked against Snipe-IT: Operator keys can't read Maintenance types. A wrong id shows on Repair intake's rows.
    saveRepairs(maintenanceTypeId: string) {
      const v = typeof maintenanceTypeId === 'string' ? maintenanceTypeId.trim() : null
      if (v === null || (v && !(/^\d+$/.test(v) && Number.isSafeInteger(+v) && +v > 0))) throw new Error('Maintenance type for repairs must be a whole number above 0, or blank.')
      write({ ...read(), repairTypeId: v ? +v : null })
      return get()
    },
    savedReports,
    saveReport(input: SavedReportInput): SavedReport {
      const query = reportQuery(input)
      const saved = read()
      const reports = saved.savedReports ?? []
      if (input.id === undefined) {
        const report = { id: randomUUID(), ...query }
        write({ ...saved, savedReports: [...reports, report] })
        return report
      }
      const old = reports.find((r) => r.id === input.id) ?? gone()
      // The old label and View go, so ones the List no longer has don't linger; anything else beside the query stays.
      const { label: _, view: __, ...kept } = old
      const report = { ...kept, ...query }
      write({ ...saved, savedReports: reports.map((r) => (r === old ? report : r)) })
      return report
    },
    renameReport(id: string, name: string) {
      const saved = read()
      const reports = saved.savedReports ?? []
      const old = reports.find((r) => r.id === id) ?? gone()
      const { name: named } = reportQuery({ ...old, name })
      write({ ...saved, savedReports: reports.map((r) => (r === old ? { ...r, name: named } : r)) })
      return savedReports()
    },
    schedules,
    /**
     * since: now, so a time that passed before it was set doesn't send; a change of only the range keeps the old one, so
     * it can't skip a send that's just come due. Changing a schedule keeps its last send.
     */
    setSchedule(key: ScheduleKey, input: Schedule | null, since: Date) {
      // The Custom Asset Report has no columns of its own to send; a template (a Saved Report) does.
      if ((key as { builtIn?: unknown } | null)?.builtIn === 'custom') throw new Error('Save the Custom Asset Report as a template, then schedule the template.')
      const schedule = input && checkSchedule(input, takesRange(key))
      reschedule(key, (old) => schedule ? {
        ...schedule,
        since: old && old.every === schedule.every && old.day === schedule.day && old.time === schedule.time ? old.since : since.toISOString(),
        ...(old?.last && { last: old.last }), ...(old?.sentAt && { sentAt: old.sentAt }),
      } : undefined, gone)
      return schedules()
    },
    /** A send finishing after its schedule was stopped, or its Saved Report deleted, isn't recorded. */
    recordSend(key: ScheduleKey, last: LastSend) {
      reschedule(key, (old) => old && { ...old, last, ...('rows' in last && { sentAt: last.at }) }, () => {})
    },
    deleteReport(id: string) {
      const saved = read()
      write({ ...saved, savedReports: (saved.savedReports ?? []).filter((r) => r.id !== id) })
      return savedReports()
    },
  }
}
