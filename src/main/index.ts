import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'node:path'
import { readConfig } from './config'
import { createSnipeIt } from './snipeit'

app.whenReady().then(() => {
  let configError = ''
  try {
    // Installed: the per-user app data folder (the install folder is read-only). From source: the project folder.
    const configDir = app.isPackaged ? app.getPath('userData') : app.getAppPath()
    const snipeIt = createSnipeIt(readConfig(join(configDir, 'config.json')), fetch)
    // One IPC channel per SnipeIt function, named after it; the preload mirrors these.
    for (const [name, fn] of Object.entries(snipeIt))
      ipcMain.handle(`snipeit:${name}`, (_e, ...args) => (fn as (...a: unknown[]) => unknown)(...args))
  } catch (e) {
    configError = (e as Error).message
  }

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
  // The config error travels in the URL so the bridge stays SnipeIt-only.
  if (process.env.ELECTRON_RENDERER_URL) {
    const url = new URL(process.env.ELECTRON_RENDERER_URL)
    if (configError) url.searchParams.set('configError', configError)
    win.loadURL(url.toString())
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'), { query: configError ? { configError } : {} })
  }
})

app.on('window-all-closed', () => app.quit())
