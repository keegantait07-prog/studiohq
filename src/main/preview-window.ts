// A plain window that shows the built beat site before it is published. It can do nothing but display that one file.
import { BrowserWindow, shell } from 'electron'
import { isExternalUrl } from './safe-path'

let win: BrowserWindow | null = null

export function openPreview(file: string): void {
  if (!win || win.isDestroyed()) {
    win = new BrowserWindow({ width: 1100, height: 800, title: 'Beat site preview', webPreferences: { sandbox: true, contextIsolation: true } })
    win.webContents.setWindowOpenHandler(({ url }) => {
      if (isExternalUrl(url)) void shell.openExternal(url)
      return { action: 'deny' }
    })
    win.webContents.on('will-navigate', (e) => e.preventDefault())
    win.on('closed', () => { win = null })
  }
  void win.loadFile(file)
  win.show()
}
