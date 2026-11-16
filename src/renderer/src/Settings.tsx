// v4 Settings: a full screen under the strip (no longer a modal). Section index with scroll-spy on the left,
// label + control rows in the middle, a Connections panel on the right. Blueprint:
// docs/design/mockups/v4/screens-studio-system.html (#settings). Library parts: Button, ScrollArea, Tooltip,
// BlurFade (Reveal). Every IPC call and handler is the same as the old modal.
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Download, FileText, RefreshCw, X } from 'lucide-react'
import type { NetlifyStatus, Settings as S, SiteStatus } from '@shared/types'
import { YouTubeSettings } from './YouTubeSettings'
import { LeadSourceSettings } from './LeadSourceSettings'
import { Button, Field, Folders, Line, Row, Switch } from './settingsUi'
import { IconBtn, Reveal } from './crmUi'
import { TooltipProvider } from '@/components/lib/tooltip'
import { ScrollArea } from '@/components/lib/scroll-area'
import './system.css'

const SECS: Array<[string, Array<[string, string]>]> = [
  ['Library', [['beats', 'Beat folders'], ['loops', 'Loop folders'], ['sounds', 'Sound library folders'], ['flbeats', 'FL projects as beats'], ['flfolders', 'FL Studio project folders']]],
  ['Working', [['pitching', 'Pitching'], ['content', 'Content & store']]],
  ['Accounts', [['assistant', 'Studio Assistant'], ['youtube', 'YouTube publisher'], ['leads', 'Lead sources']]],
  ['Publishing', [['netlify', 'Netlify'], ['site', 'Beat site']]],
  ['Data', [['data', 'Your data']]]
]
const ALL = SECS.flatMap((g) => g[1].map((x) => x[0]))

export function Settings({ onClose }: { onClose: () => void }) {
  const [s, setS] = useState<S | null>(null)
  const [failed, setFailed] = useState(false)
  const [dataPath, setDataPath] = useState('')
  const [msg, setMsg] = useState('')
  const [nl, setNl] = useState<NetlifyStatus | null>(null)
  const [token, setToken] = useState('')
  const [name, setName] = useState('')
  const [site, setSite] = useState<SiteStatus | null>(null)
  const [siteBusy, setSiteBusy] = useState('')
  const [siteMsg, setSiteMsg] = useState('')
  const [google, setGoogle] = useState<boolean | null>(null)
  const [leadKeys, setLeadKeys] = useState<number | null>(null)
  const [active, setActive] = useState('beats')
  const body = useRef<HTMLDivElement>(null)
  const head = useRef<HTMLHeadingElement>(null)

  const conn = useCallback(() => {
    window.api.ytStatus().then((x) => setGoogle(x.signedIn)).catch(() => setGoogle(null))
    window.api.leadsKeyStatus().then((x) => setLeadKeys(Object.values(x).filter(Boolean).length)).catch(() => setLeadKeys(null))
  }, [])
  useEffect(() => { window.api.siteStatus().then(setSite); return window.api.onSiteProgress(setSiteBusy) }, [])
  const load = () => { conn(); return window.api.getSettings().then((x) => { setS(x); setFailed(false) }, () => setFailed(true)) }
  const first = () => { load().then(); window.api.getSettings().then((x) => setName(x.producerName)).catch(() => {}); window.api.dataPath().then(setDataPath); window.api.netlifyStatus().then(setNl) }
  useEffect(first, [])

  // a full screen: focus moves in on open and back on close; any other strip tab leaves it
  useEffect(() => {
    const from = document.activeElement
    head.current?.focus({ preventScroll: true })
    const strip = document.querySelector('.strip')
    const leave = (e: Event) => { const b = (e.target as Element).closest('button'); if (b && !b.getAttribute('title')?.startsWith('Settings')) onClose() }
    strip?.addEventListener('pointerdown', leave)
    return () => { strip?.removeEventListener('pointerdown', leave); if (from instanceof HTMLElement && from.isConnected) from.focus({ preventScroll: true }) }
  }, [onClose])

  const scroller = () => body.current?.querySelector<HTMLElement>('[data-slot=scroll-area-viewport]') ?? null
  const spy = () => {
    const v = scroller()
    if (!v) return
    const top = v.getBoundingClientRect().top + 48
    let cur = ALL[0]
    for (const id of ALL) { const el = document.getElementById('set-' + id); if (el && el.getBoundingClientRect().top <= top) cur = id }
    if (v.scrollTop + v.clientHeight >= v.scrollHeight - 4) cur = ALL[ALL.length - 1]
    setActive(cur)
  }
  const jump = (id: string) => {
    const v = scroller(); const el = document.getElementById('set-' + id)
    if (!v || !el) return
    v.scrollTo({ top: v.scrollTop + el.getBoundingClientRect().top - v.getBoundingClientRect().top - 16, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
    setActive(id)
  }

  const backup = async () => setMsg('Saved to ' + (await window.api.backup()))
  const folders = (kind: 'watchFolders' | 'loopFolders' | 'projectFolders' | 'soundFolders') => s && (
    <Folders items={s[kind]} onRemove={async (f) => { await window.api.removeFolder(kind, f); load() }} onAdd={async () => { await window.api.addFolder(kind); load() }} />
  )

  const connItems: Array<[string, string, string, boolean]> = [
    ['netlify', 'Netlify', nl == null ? '…' : nl.hasToken ? 'token saved' : 'no token', !!nl?.hasToken],
    ['assistant', 'Claude CLI', s?.claudePath ? 'custom path' : 'found automatically', true],
    ['youtube', 'Google', google == null ? '…' : google ? 'signed in' : 'not signed in', !!google],
    ['leads', 'Lead sources', leadKeys == null ? '…' : `${leadKeys} of 3`, !!leadKeys],
    ['site', 'Beat site', site?.url ? (site.pending ? 'unpublished changes' : 'published') : 'not published', !!site?.url && !site.pending]
  ]

  return (
    <TooltipProvider delay={120}>
      <section className="set4 sx" aria-label="Settings">
        <nav className="set-rail" aria-label="Settings sections">
          {SECS.map(([g, list]) => (
            <div key={g}>
              <h4 className="sx-eyebrow">{g}</h4>
              {list.map(([id, label]) => <button key={id} type="button" aria-current={active === id ? 'true' : undefined} onClick={() => jump(id)}>{label}</button>)}
            </div>
          ))}
        </nav>
        <div className="set-body" ref={body} onScrollCapture={spy}>
          <div className="set-scroll-wrap">
            <ScrollBody>
              <header className="sx-head set-head">
                <div>
                  <div className="sx-eyebrow">Studio HQ</div>
                  <h1 className="sx-h1" ref={head} tabIndex={-1}>Settings</h1>
                  <p className="sx-lede">Changes save as you make them. Esc or any tab above leaves.</p>
                </div>
                <div className="set-headacts">
                  <Button onClick={backup}><Download aria-hidden="true" />Back up now</Button>
                  <IconBtn label="Close settings (Esc)" onClick={onClose}><X /></IconBtn>
                </div>
              </header>
              {failed && !s && <div className="sx-notice err" role="alert"><span>Settings did not load.</span><Button variant="outline" size="sm" onClick={first}><RefreshCw aria-hidden="true" />Try again</Button></div>}
              {!s && !failed && <div className="set-skel" aria-label="Loading settings">{[0, 1, 2, 3, 4].map((i) => <div key={i} className="sx-sk" />)}</div>}
              {s && (
                <Reveal>
                  <h2 className="set-grp"><span>01</span>Library</h2>
                  <Row id="beats" title="Beat folders" help="Every audio file in these folders is imported automatically, and new bounces appear as soon as they finish writing.">{folders('watchFolders')}</Row>
                  <Row id="loops" title="Loop folders" help="Loops you make to send to other producers. They get their own Loop Vault, organised the same way as your beats, and a folder named “ideas” or “scraps” follows the setting below too.">
                    {folders('loopFolders')}
                    <Switch checked={s.includeIdeas} onChange={async (v) => { await window.api.setSetting({ includeIdeas: v }); load() }} label="Include folders named “ideas” / “scraps”" />
                  </Row>
                  <Row id="sounds" title="Sound library folders" help="Drum kits and sample packs, scanned into the Sound Library. Files are never moved or changed.">
                    {folders('soundFolders')}
                    <Switch checked={s.includeMidiPacks} onChange={async (v) => { await window.api.setSetting({ includeMidiPacks: v }); load(); window.api.soundsScan() }} label="Also index MIDI files inside my sound folders (MIDI packs can be tens of thousands of files)" help="MIDI made from your own FL projects is always included." />
                  </Row>
                  <Row id="flbeats" title="FL projects as beats" help="Every FL Studio project in your project folders shows up in the Vault as a beat, even before you export it, so a new beat never goes missing. This is how far back to look (0 = every project you've ever made).">
                    <Field label="Show projects saved in the last (days)"><input className="sx-in set-num" inputMode="numeric" defaultValue={s.projectBeatDays} onBlur={async (e) => { const n = parseInt(e.target.value, 10); if (n >= 0) { await window.api.setSetting({ projectBeatDays: n }); window.api.reindexProjects() } }} /></Field>
                  </Row>
                  <Row id="flfolders" title="FL Studio project folders" help="Searched for .flp files to link to your bounces. FL’s Backup folders are skipped.">{folders('projectFolders')}</Row>

                  <h2 className="set-grp"><span>02</span>Working</h2>
                  <Row id="pitching" title="Pitching">
                    <div className="set-two">
                      <Field label="Your producer name (used in emails and pages)"><input className="sx-in" value={name} onChange={(e) => setName(e.target.value)} onBlur={() => window.api.setSetting({ producerName: name.trim() })} /></Field>
                      <Field label="Default follow-up after (days)"><input className="sx-in set-num" inputMode="numeric" defaultValue={s.followupDays} onBlur={(e) => { const n = parseInt(e.target.value, 10); if (n > 0) window.api.setSetting({ followupDays: n }) }} /></Field>
                    </div>
                    <Switch checked={s.notify} onChange={async (v) => { await window.api.setSetting({ notify: v }); load() }} label="Send a macOS notification when follow-ups are due" />
                  </Row>
                  <Row id="content" title="Content & store" help="Used in titles, descriptions and captions so you don't retype them.">
                    <div className="set-two">
                      <Field label="Store / lease link"><input className="sx-in" defaultValue={s.storeUrl} placeholder="https://…" onBlur={(e) => window.api.setSetting({ storeUrl: e.target.value.trim() })} /></Field>
                      <Field label="Business email"><input className="sx-in" defaultValue={s.contactEmail} onBlur={(e) => window.api.setSetting({ contactEmail: e.target.value.trim() })} /></Field>
                    </div>
                    <Field label="Default hashtags"><input className="sx-in" defaultValue={s.hashtags} onBlur={(e) => window.api.setSetting({ hashtags: e.target.value.trim() })} /></Field>
                    <Line mono actions={<Button variant="outline" size="sm" onClick={async () => { await window.api.chooseExportDir(); load() }}>Change…</Button>}>Videos are saved to: {s.exportDir}</Line>
                  </Row>

                  <h2 className="set-grp"><span>03</span>Accounts</h2>
                  <Row id="assistant" title="Studio Assistant" help={<>Leave blank to find <code className="sx-code">claude</code> automatically</>}>
                    <h4 className="set-sub">Claude CLI path</h4>
                    <Line mono actions={<>
                      <Button variant="outline" size="sm" onClick={async () => { await window.api.chooseClaudePath(); load() }}>Choose…</Button>
                      {s.claudePath && <Button variant="ghost" size="sm" onClick={async () => { await window.api.chooseClaudePath(true); load() }}>Clear</Button>}
                    </>}>{s.claudePath || 'Found automatically'}</Line>
                  </Row>
                  <YouTubeSettings s={s} reload={load} />
                  <LeadSourceSettings onChange={conn} />

                  <h2 className="set-grp"><span>04</span>Publishing</h2>
                  <Row id="netlify" title="Netlify (private pitch pages)" help="Pages and audio previews are published to your own Netlify site, under unguessable links. Create a personal access token in Netlify → User settings → Applications, and paste it here. It is stored encrypted with the macOS Keychain.">
                    {nl?.hasToken ? (
                      <Line actions={<Button variant="ghost" size="sm" onClick={async () => { await window.api.setNetlifyToken(null); setNl(await window.api.netlifyStatus()) }}>Remove</Button>}>Token saved{nl.siteUrl ? ` · ${nl.siteUrl}` : ''}</Line>
                    ) : (
                      <div className="set-inrow">
                        <input className="sx-in" type="password" value={token} placeholder="Netlify personal access token" aria-label="Netlify personal access token" onChange={(e) => setToken(e.target.value)} />
                        <Button variant="outline" disabled={!token.trim()} onClick={async () => { try { await window.api.setNetlifyToken(token); setToken(''); setNl(await window.api.netlifyStatus()) } catch (e) { setMsg(String((e as Error).message)) } }}>Save</Button>
                      </div>
                    )}
                  </Row>
                  <Row id="site" title="Beat site" help={<>Your public beat catalogue. Send beats to it with <i>Send to site</i> in any beat's panel. Every Lease button opens the store link above unless a beat has its own link. It's published to its own Netlify site, separate from your private pitch pages.</>}>
                    <Line actions={<>
                      {site?.url && <Button variant="ghost" size="sm" onClick={() => window.api.openExternal(site.url!)}>Open</Button>}
                      <Button size="sm" disabled={!!siteBusy || !nl?.hasToken} onClick={async () => { setSiteMsg(''); setSiteBusy('Publishing…'); try { const u = await window.api.sitePublish(); setSiteMsg('Published to ' + u) } catch (e) { setSiteMsg(String((e as Error).message)) } setSiteBusy(''); setSite(await window.api.siteStatus()) }}>{siteBusy || 'Publish site now'}</Button>
                    </>}>{site?.url ? site.url : 'Not published yet'} · {site?.entries.length ?? 0} beats{site?.pending ? ' · unpublished changes' : ''}</Line>
                    {!nl?.hasToken && <p className="sx-help">Publishing needs a Netlify token (above).</p>}
                    {siteMsg && <p className="sx-help" role="status">{siteMsg}</p>}
                  </Row>

                  <h2 className="set-grp"><span>05</span>Data</h2>
                  <Row id="data" title="Your data" help={<>Everything lives in one local database:<br /><code className="sx-code">{dataPath}/studio-hq.db</code></>}>
                    <div className="set-acts">
                      <Button onClick={backup}><Download aria-hidden="true" />Back up now</Button>
                      <Button variant="outline" onClick={async () => { const d = await window.api.exportCsv(); if (d) setMsg('Exported beats and sales (CSV) to ' + d) }}><FileText aria-hidden="true" />Export beats and sales (CSV)</Button>
                    </div>
                    {msg && <p className="sx-help" role="status">{msg}</p>}
                  </Row>
                </Reveal>
              )}
            </ScrollBody>
          </div>
        </div>
        <aside className="set-conn" aria-label="Connections">
          <h4 className="sx-eyebrow">Connections</h4>
          {connItems.map(([id, label, state, ok]) => (
            <button key={id} type="button" className="set-ci" onClick={() => jump(id)}>
              <i className={ok ? 'ok' : ''} aria-hidden="true" /><b>{label}</b><small>{state}</small>
            </button>
          ))}
        </aside>
      </section>
    </TooltipProvider>
  )
}

/** Library scroll area for the settings column. */
function ScrollBody({ children }: { children: ReactNode }) {
  return <ScrollArea className="set-sa"><div className="set-col">{children}</div></ScrollArea>
}
