// Self-contained listening page for a pitch pack: no external requests, no tracking.
export interface PageTrack { title: string; file: string; bpm: number | null; key: string | null; duration: number | null; peaks: number[] }
export interface PageData { title: string; intro: string; producer: string; tracks: PageTrack[] }

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
const fmt = (s: number | null) => (s == null ? '' : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`)
const keyLabel = (k: string | null) => (k ? (k.endsWith('minor') ? k.split(' ')[0] + 'm' : k.split(' ')[0]) : '')
/** safe to embed inside a <script> block */
const json = (v: unknown) => JSON.stringify(v).replace(/</g, '\\u003c').replace(new RegExp(String.fromCharCode(0x2028)+'|'+String.fromCharCode(0x2029), 'g'), '')

export function renderPage(d: PageData): string {
  const tracks = d.tracks.map((t) => ({
    file: t.file,
    peaks: Array.from({ length: 160 }, (_, i) => t.peaks[Math.floor((i / 160) * t.peaks.length)] ?? 0)
  }))
  const intro = d.intro.trim().split(/\n{2,}/).map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('')
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${esc(d.title)}</title>
<style>
:root{--bg:#0d0e11;--panel:#15171b;--line:#25282e;--text:#eceef0;--dim:#8d929b;--accent:#ff6b3d}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:16px/1.55 -apple-system,BlinkMacSystemFont,"SF Pro Text",Inter,sans-serif}
main{max-width:720px;margin:0 auto;padding:56px 20px 80px}
.by{color:var(--accent);font-weight:600;letter-spacing:.04em;font-size:13px;text-transform:uppercase}
h1{font-size:32px;line-height:1.15;margin:8px 0 18px}.intro p{margin:0 0 12px;color:#cfd2d8}
.track{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:16px;margin-top:14px}
.top{display:flex;align-items:center;gap:14px}
.play{width:46px;height:46px;border-radius:50%;border:0;background:var(--accent);color:#140a06;font-size:15px;cursor:pointer;flex:none}
.name{flex:1;min-width:0}.name b{display:block;font-size:17px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.meta{color:var(--dim);font-size:13px}.time{color:var(--dim);font-size:13px;font-variant-numeric:tabular-nums}
canvas{width:100%;height:56px;display:block;margin-top:12px;cursor:pointer}
footer{margin-top:36px;color:var(--dim);font-size:13px}
</style></head><body><main>
<div class="by">${esc(d.producer)}</div>
<h1>${esc(d.title)}</h1>
<div class="intro">${intro}</div>
${d.tracks.map((t, i) => `<section class="track" data-i="${i}">
<div class="top"><button class="play" aria-label="Play ${esc(t.title)}">&#9654;</button>
<div class="name"><b>${esc(t.title)}</b><span class="meta">${[t.bpm ? Math.round(t.bpm) + ' BPM' : '', keyLabel(t.key)].filter(Boolean).join(' · ')}</span></div>
<span class="time">0:00 / ${fmt(t.duration)}</span></div>
<canvas></canvas></section>`).join('\n')}
<footer>Private link. Please don't share it.</footer>
</main>
<script>
const T=${json(tracks)};let cur=null;
const secs=[...document.querySelectorAll('.track')];
const f=s=>Math.floor(s/60)+':'+String(Math.floor(s%60)).padStart(2,'0');
secs.forEach((sec,i)=>{
 const a=new Audio();a.preload='none';a.src=T[i].file;
 const cv=sec.querySelector('canvas'),btn=sec.querySelector('.play'),tm=sec.querySelector('.time');
 const draw=()=>{const r=devicePixelRatio||1,w=cv.clientWidth,h=56;cv.width=w*r;cv.height=h*r;const g=cv.getContext('2d');g.scale(r,h?r:1);
  const p=a.duration?a.currentTime/a.duration:0,n=Math.floor(w/4);
  for(let k=0;k<n;k++){const v=(T[i].peaks[Math.floor(k/n*T[i].peaks.length)]||0)/255,bh=Math.max(2,v*(h-4));g.fillStyle=k/n<=p?'#ff6b3d':'#3a3d46';g.fillRect(k*4,(h-bh)/2,3,bh)}};
 a.addEventListener('timeupdate',()=>{tm.textContent=f(a.currentTime)+' / '+(a.duration?f(a.duration):'');draw()});
 a.addEventListener('play',()=>{if(cur&&cur!==a)cur.pause();cur=a;btn.innerHTML='&#10074;&#10074;'});
 a.addEventListener('pause',()=>{btn.innerHTML='&#9654;'});
 a.addEventListener('ended',()=>{const nx=secs[i+1];if(nx)nx.querySelector('.play').click()});
 btn.onclick=()=>a.paused?a.play():a.pause();
 cv.onclick=e=>{const r=cv.getBoundingClientRect();const go=()=>{a.currentTime=(e.clientX-r.left)/r.width*a.duration;a.play()};a.duration?go():(a.preload='auto',a.addEventListener('loadedmetadata',go,{once:true}),a.load())};
 draw();addEventListener('resize',draw);
});
</script></body></html>`
}
