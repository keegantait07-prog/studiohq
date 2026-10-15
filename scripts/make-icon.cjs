// Renders build/icon.png (1024x1024) with Electron itself: npx electron scripts/make-icon.cjs
const { app, BrowserWindow } = require('electron')
const { writeFileSync } = require('fs')
const { join } = require('path')

const bars = [0.28, 0.5, 0.78, 0.46, 0.95, 0.62, 0.38, 0.7, 0.3]
const html = `<!doctype html><body style="margin:0;background:transparent"><div style="width:1024px;height:1024px;display:flex;align-items:center;justify-content:center">
<div style="width:824px;height:824px;border-radius:186px;background:linear-gradient(160deg,#1b1d23,#0d0e11);box-shadow:0 24px 60px rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;gap:26px">
${bars.map((h) => `<div style="width:42px;height:${h * 520}px;border-radius:21px;background:linear-gradient(#ff8a5f,#ff6b3d)"></div>`).join('')}
</div></div></body>`

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1024, height: 1024, useContentSize: true, transparent: true, frame: false, enableLargerThanScreen: true, webPreferences: { offscreen: false } })
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
  await new Promise((r) => setTimeout(r, 400))
  let img = await win.webContents.capturePage()
  const s = img.getSize()
  if (s.width !== 1024) img = img.resize({ width: 1024, height: 1024, quality: 'best' })
  writeFileSync(join(__dirname, '../build/icon.png'), img.toPNG())
  app.quit()
})
