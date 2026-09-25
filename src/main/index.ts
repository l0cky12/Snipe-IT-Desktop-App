import { app, BrowserWindow, ipcMain, safeStorage } from 'electron'
import { join } from 'node:path'
import { createSettingsStore, type SettingsInput } from './config'
import { createSnipeIt } from './snipeit'

app.whenReady().then(() => {
  const store = createSettingsStore(join(app.getPath('userData'), 'settings.json'), safeStorage, app.getVersion())
  const client = (input?: SettingsInput) => createSnipeIt(store.credentials(input), fetch)
  ipcMain.handle('settings:get', () => store.get())
  ipcMain.handle('settings:save', (_e, input: SettingsInput) => store.save(input))
  ipcMain.handle('settings:clearToken', () => store.clearToken())
  ipcMain.handle('settings:test', (_e, input: SettingsInput) => client(input).testConnection())
  ipcMain.handle('settings:locations', (_e, input: SettingsInput) => client(input).locations())
  for (const name of ['testConnection', 'locations', 'lookup', 'getAsset', 'statusLabels', 'searchUsers', 'searchLocations', 'checkout', 'checkin', 'dashboard'] as const)
    ipcMain.handle(`snipeit:${name}`, (_e, ...args) => (client()[name] as (...a: unknown[]) => unknown)(...args))

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
