import { createRoot } from 'react-dom/client'
import { App } from './App'
import '@fontsource-variable/archivo/wdth.css'
import '@fontsource/inter-tight/latin-400.css'
import '@fontsource/inter-tight/latin-500.css'
import '@fontsource/inter-tight/latin-600.css'
import '@fontsource/inter-tight/latin-700.css'
import './tailwind.css'
import './styles.css'
import './shell.css'
import './scene.css'
import { applyTheme, getTheme } from './themes'
import { startVizWorker } from './vizWorker'
import { installDialogA11y } from './a11y'
import { installSmoothScroll } from './smoothScroll'

if (location.hash === '#viz-worker') startVizWorker() // the hidden export window draws frames, no UI
else {
  applyTheme(getTheme())
  installDialogA11y()
  // a file dropped on the window must never navigate it (the Calendar's own drag and drop still works)
for (const t of ['dragover', 'drop']) window.addEventListener(t, (e) => e.preventDefault())

createRoot(document.getElementById('root')!).render(<App />)
installSmoothScroll()
}
