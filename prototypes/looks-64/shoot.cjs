// PROTOTYPE (#64): screenshots every option x screen x theme.
// xvfb-run -a -s "-screen 0 1440x1200x24" npx electron prototypes/looks-64/shoot.cjs --no-sandbox [option-a ...]
const { app, BrowserWindow } = require('electron')
const fs = require('fs'), path = require('path')
const dir = __dirname
const only = process.argv.slice(2).filter(a => a.startsWith('option-'))
const pages = (only.length ? only : fs.readdirSync(dir).filter(f => /^option-.*\.html$/.test(f)).map(f => f.slice(0, -5))).sort()
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1400, height: 860, useContentSize: true, show: true })
  for (const p of pages) for (const screen of ['workflow', 'assets']) for (const theme of ['light', 'dark']) {
    win.setContentSize(1400, screen === 'assets' ? 1100 : 860)
    await win.loadFile(path.join(dir, p + '.html'), { query: { screen, theme } })
    win.focus(); win.webContents.focus()
    await new Promise(r => setTimeout(r, 400))
    const img = await win.webContents.capturePage()
    const out = path.join(dir, `${p}-${screen}-${theme}.png`)
    fs.writeFileSync(out, img.toPNG()); console.log(out)
  }
  app.quit()
})
