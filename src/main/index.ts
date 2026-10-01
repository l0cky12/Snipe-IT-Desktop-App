import { app, BrowserWindow, ipcMain, safeStorage } from 'electron'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSettingsStore, type MailInput, type SavedReportInput, type Schedule, type ScheduleKey, type SettingsInput } from './config'
import { sendMail } from './mail'
import { createReportScheduler, reportRunner, type ReportRef } from './scheduler'
import { createSnipeIt } from './snipeit'

/** Opens the Assets' Labels, one PDF, to print or save: Snipe-IT's, or the app's own (ownLabelHtml, see labelHtml) when Snipe-IT can't make them. */
export type LabelApi = { print(assetTags: string[], ownLabelHtml: string): Promise<'snipeit' | 'own'> }

// A Label PDF in its own window, in Chromium's PDF viewer: its Print button opens the system print dialog, which can also
// save it as a PDF, as can its Download button. ponytail: Electron 44 can't open that dialog for a PDF by itself
// (webContents.print() and the viewer's window.print() never show it), so the Operator clicks Print; call print() once it can.
async function showLabel(parent: BrowserWindow | null, dir: string, name: string, pdf: Buffer) {
  const file = join(dir, `${name.replace(/[^\w.-]+/g, '_')}.pdf`)
  await writeFile(file, pdf)
  const win = new BrowserWindow({ parent: parent ?? undefined, width: 560, height: 460, backgroundColor: '#0d1117', webPreferences: { plugins: true } })
  win.setMenuBarVisibility(false)
  win.on('closed', () => rm(dir, { recursive: true, force: true }))
  await win.loadFile(file, { hash: 'navpanes=0' })
}

// The app's own Labels (a page of HTML from the screen, see labelHtml) as a PDF of Label-sized pages. From a file, as a
// data: URL of many Labels would pass Chromium's 2 MB URL limit.
async function ownLabelPdf(dir: string, html: string): Promise<Buffer> {
  if (typeof html !== 'string') throw new Error('Invalid Label')
  const file = join(dir, 'labels.html')
  await writeFile(file, html)
  const win = new BrowserWindow({ show: false, webPreferences: { javascript: false } })
  try {
    await win.loadFile(file)
    return await win.webContents.printToPDF({ pageSize: { width: 2.25, height: 1.25 }, margins: { top: 0, bottom: 0, left: 0, right: 0 }, printBackground: true })
  } finally {
    win.destroy()
  }
}

app.whenReady().then(() => {
  const store = createSettingsStore(join(app.getPath('userData'), 'settings.json'), safeStorage, app.getVersion())
  const client = (input?: SettingsInput) => createSnipeIt(store.credentials(input), fetch)
  ipcMain.handle('settings:get', () => store.get())
  ipcMain.handle('settings:save', (_e, input: SettingsInput) => store.save(input))
  ipcMain.handle('settings:clearToken', () => store.clearToken())
  ipcMain.handle('settings:saveMail', (_e, input: MailInput) => store.saveMail(input))
  ipcMain.handle('settings:testMail', async (_e, input: MailInput) => {
    const server = store.mailServer(input)
    const to = await client().operatorEmail()
    await sendMail(server, { to, subject: 'Snipe-IT Desktop test email', text: 'This is a test email from Snipe-IT Desktop. Your email settings work, so Reports can be emailed to you here.' })
    return to
  })
  // Kept here, not in the window's storage, so the Report scheduler can read them with the window closed.
  ipcMain.handle('settings:savedReports', () => store.savedReports())
  ipcMain.handle('settings:saveReport', (_e, report: SavedReportInput) => store.saveReport(report))
  ipcMain.handle('settings:renameReport', (_e, id: string, name: string) => store.renameReport(id, name))
  ipcMain.handle('settings:deleteReport', (_e, id: string) => store.deleteReport(id))
  ipcMain.handle('settings:schedules', () => store.schedules())
  ipcMain.handle('settings:setSchedule', (_e, report: ScheduleKey, schedule: Schedule | null) => store.setSchedule(report, schedule, new Date()))
  const scheduler = createReportScheduler({
    now: () => new Date(),
    run: (ref) => reportRunner(client(), store.savedReports)(ref),
    recipient: () => client().operatorEmail(),
    send: (mail) => sendMail(store.mailServer(), mail),
    schedules: store.schedules,
    recordSend: store.recordSend,
  })
  ipcMain.handle('reports:emailNow', (_e, ref: ReportRef) => scheduler.emailNow(ref))
  // At launch, sending what came due while the app was closed, then every minute.
  const tick = () => scheduler.tick().catch((e: Error) => console.error('Report scheduler:', e.message))
  tick()
  setInterval(tick, 60_000)
  ipcMain.handle('settings:test', (_e, input: SettingsInput) => client(input).testConnection())
  ipcMain.handle('settings:locations', (_e, input: SettingsInput) => client(input).locations())
  for (const name of ['testConnection', 'operatorEmail', 'locations', 'lookup', 'getAsset', 'statusLabels', 'searchUsers', 'searchLocations', 'checkout', 'checkin', 'dashboard', 'list', 'exportList', 'names', 'updateStatus', 'report', 'record', 'form', 'customFields', 'save', 'remove', 'canManagePermissions', 'userAccess', 'groups', 'group', 'setUserGroups', 'saveGroup', 'canImport', 'imports', 'uploadImport', 'processImport', 'deleteImport'] as const)
    ipcMain.handle(`snipeit:${name}`, (_e, ...args) => (client()[name] as (...a: unknown[]) => unknown)(...args))
  // Snipe-IT's Labels, so they match the web UI's; the app's own when Snipe-IT can't make them over the API.
  ipcMain.handle('label:print', async (e, assetTags: string[], ownLabelHtml: string) => {
    const pdf = await client().labelPdf(assetTags)
    const dir = await mkdtemp(join(tmpdir(), 'snipe-it-label-'))
    try {
      const name = assetTags.length === 1 ? `${assetTags[0]} label` : `${assetTags.length} labels`
      await showLabel(BrowserWindow.fromWebContents(e.sender), dir, name, pdf ? Buffer.from(pdf, 'base64') : await ownLabelPdf(dir, ownLabelHtml))
    } catch (err) {
      await rm(dir, { recursive: true, force: true })
      throw err
    }
    return pdf ? 'snipeit' : 'own'
  })

  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    backgroundColor: '#0d1117',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  win.setMenuBarVisibility(false)
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(join(__dirname, '../renderer/index.html'))
})

app.on('window-all-closed', () => app.quit())
