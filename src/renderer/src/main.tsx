import { createRoot } from 'react-dom/client'
import { App } from './App'
import '@fontsource/barlow-semi-condensed/latin-400.css'
import '@fontsource/barlow-semi-condensed/latin-500.css'
import '@fontsource/barlow-semi-condensed/latin-600.css'
import '@fontsource/ibm-plex-mono/latin-400.css'
import '@fontsource/ibm-plex-mono/latin-500.css'
import '@fontsource/ibm-plex-mono/latin-600.css'
import '@fontsource/cinzel/latin-500.css'
import '@fontsource/cinzel/latin-600.css'
import '@fontsource/source-serif-4/latin-400.css'
import '@fontsource/source-serif-4/latin-600.css'
import '@fontsource/source-serif-4/latin-400-italic.css'
import '@fontsource/caveat/latin-600.css'
import '@fontsource/ibm-plex-sans/latin-400.css'
import '@fontsource/ibm-plex-sans/latin-500.css'
import '@fontsource/ibm-plex-sans/latin-600.css'
import '@fontsource/barlow-condensed/latin-500.css'
import '@fontsource/barlow-condensed/latin-600.css'
import '@fontsource/barlow-condensed/latin-700.css'
import './styles.css'
import { applyTheme, getTheme } from './themes'
import { startVizWorker } from './vizWorker'
import { installDialogA11y } from './a11y'

if (location.hash === '#viz-worker') startVizWorker() // the hidden export window draws frames, no UI
else {
  applyTheme(getTheme())
  installDialogA11y()
  // a file dropped on the window must never navigate it (the Calendar's own drag and drop still works)
for (const t of ['dragover', 'drop']) window.addEventListener(t, (e) => e.preventDefault())

createRoot(document.getElementById('root')!).render(<App />)
}
