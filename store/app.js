(() => {
  const S = window.STORE, BEATS = window.BEATS
  const $ = (id) => document.getElementById(id)
  const money = (n) => '$' + n.toFixed(2)
  const fmt = (s) => (isFinite(s) ? Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0') : '0:00')
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

  // ---------- wireframe mesh background ----------
  const cv = $('mesh'), g = cv.getContext('2d')
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
  let W, H, DPR
  const size = () => { DPR = Math.min(devicePixelRatio || 1, 2); W = innerWidth; H = innerHeight; cv.width = W * DPR; cv.height = H * DPR; g.setTransform(DPR, 0, 0, DPR, 0, 0) }
  addEventListener('resize', size); size()
  const COLS = 34, ROWS = 20
  function mesh(t) {
    g.clearRect(0, 0, W, H)
    const sky = g.createLinearGradient(0, 0, 0, H)
    sky.addColorStop(0, '#3a1328'); sky.addColorStop(.38, '#12060d'); sky.addColorStop(1, '#090407')
    g.fillStyle = sky; g.fillRect(0, 0, W, H)
    const horizon = H * .34, cam = 1.15
    const pts = []
    for (let r = 0; r <= ROWS; r++) {
      const row = []
      const z = r / ROWS                                  // 0 far .. 1 near
      const depth = Math.pow(z, 2.1) * .95 + .05
      const y0 = horizon + (H - horizon) * 1.12 * depth
      for (let c = 0; c <= COLS; c++) {
        const u = c / COLS - .5
        const wave = Math.sin(c * .55 + t * .55 + r * .35) * .5 + Math.sin(c * .21 - t * .4 + r * .8) * .8
        const x = W / 2 + u * W * (.35 + depth * cam * 1.9)
        row.push([x, y0 - wave * (4 + depth * 38)])
      }
      pts.push(row)
    }
    g.lineWidth = 1.4
    for (let r = 0; r <= ROWS; r++) {
      g.strokeStyle = `rgba(194,64,127,${.1 + (r / ROWS) * .55})`
      g.beginPath(); pts[r].forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.stroke()
    }
    for (let c = 0; c <= COLS; c++) {
      g.strokeStyle = 'rgba(194,64,127,.38)'
      g.beginPath(); for (let r = 0; r <= ROWS; r++) { const [x, y] = pts[r][c]; r ? g.lineTo(x, y) : g.moveTo(x, y) } g.stroke()
    }
  }
  if (reduce) mesh(0)
  else { const loop = (ms) => { if (!document.hidden) mesh(ms / 1000); requestAnimationFrame(loop) }; requestAnimationFrame(loop) }

  // ---------- generated cover art (three overlapping circles) ----------
  const PAL = [['#a33cff', '#f6e45a'], ['#ff4fa3', '#ffd25a'], ['#3c7bff', '#7dffd2'], ['#ff7a3c', '#ffe45a'], ['#7c3cff', '#ff7ab8'], ['#2fe0b0', '#f6f05a']]
  const cover = (i, uid) => {
    const [a, b] = PAL[(BEATS[i].hue ?? i) % PAL.length], k = `${uid}${i}`
    return `<svg viewBox="0 0 100 100" aria-hidden="true"><defs><linearGradient id="a${k}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>
      <linearGradient id="b${k}" x1="0" y1="0" x2="1" y2="1"><stop offset="-.4" stop-color="${a}"/><stop offset=".7" stop-color="${b}"/></linearGradient></defs>
      <rect width="100" height="100" fill="#2a0c1d"/><circle cx="30" cy="50" r="24" fill="url(#a${k})"/><circle cx="52" cy="50" r="24" fill="url(#b${k})"/><circle cx="74" cy="50" r="24" fill="${b}"/></svg>`
  }

  // ---------- page text ----------
  $('tagline').textContent = S.tagline
  $('yr').textContent = new Date().getFullYear()
  document.title = `${S.artist} — Beats`
  const links = [['Email', S.email && 'mailto:' + S.email], ['Instagram', S.instagram], ['YouTube', S.youtube]].filter((l) => l[1])
  $('links').innerHTML = links.map(([n, u]) => `<a href="${esc(u)}" target="_blank" rel="noopener">${n}</a>`).join('')

  // ---------- beat list ----------
  let filter = 'All', playing = -1
  const allTags = ['All', ...new Set(BEATS.flatMap((b) => b.tags))]
  $('filters').innerHTML = allTags.map((t) => `<button class="chip" aria-pressed="${t === 'All'}">${esc(t)}</button>`).join('')
  $('filters').addEventListener('click', (e) => {
    const b = e.target.closest('.chip'); if (!b) return
    filter = b.textContent; [...$('filters').children].forEach((c) => c.setAttribute('aria-pressed', c === b)); render()
  })
  const minPrice = Math.min(...S.licenses.map((l) => l.price))
  function render() {
    const rows = BEATS.map((b, i) => [b, i]).filter(([b]) => filter === 'All' || b.tags.includes(filter))
    $('list').innerHTML = rows.length ? rows.map(([b, i]) => `<li class="row${i === playing ? ' on' : ''}" data-i="${i}">
      <button class="cover" data-play aria-label="Play ${esc(b.title)}">${cover(i, 'l')}<span class="pl">${i === playing && !au.paused ? '&#10073;&#10073;' : '&#9654;'}</span></button>
      <div class="info"><b>${esc(b.title)}</b><span>${b.bpm} BPM · ${esc(b.key)}</span></div>
      <div class="tags">${b.tags.map((t) => `<span class="tag-pill">${esc(t)}</span>`).join('')}</div>
      <button class="buy" data-buy>From ${money(minPrice)}</button></li>`).join('') : '<li class="empty">No beats match that filter.</li>'
  }
  $('list').addEventListener('click', (e) => {
    const row = e.target.closest('.row'); if (!row) return
    const i = +row.dataset.i
    if (e.target.closest('[data-buy]')) openModal(i)
    else if (e.target.closest('[data-play]')) i === playing ? toggle() : load(i, true)
  })

  // ---------- player ----------
  const au = new Audio(); au.preload = 'none'
  const seek = $('seek')
  function load(i, play) {
    playing = i; const b = BEATS[i]
    au.src = b.audio; $('player').hidden = false
    $('pcover').innerHTML = cover(i, 'p'); $('ptitle').textContent = b.title; $('pmeta').textContent = `${b.bpm} BPM · ${b.key}`
    seek.value = 0; seek.style.setProperty('--p', '0%'); $('pcur').textContent = '0:00'; $('pdur').textContent = '0:00'
    if (play) au.play().catch(() => {})
    render()
  }
  const toggle = () => (au.paused ? au.play().catch(() => {}) : au.pause())
  const step = (d) => load((playing + d + BEATS.length) % BEATS.length, true)
  $('pp').onclick = () => (playing < 0 ? load(0, true) : toggle())
  $('prev').onclick = () => step(-1); $('next').onclick = () => step(1)
  $('pbuy').onclick = () => playing >= 0 && openModal(playing)
  au.addEventListener('play', () => { $('pp').innerHTML = '&#10073;&#10073;'; render() })
  au.addEventListener('pause', () => { $('pp').innerHTML = '&#9654;'; render() })
  au.addEventListener('ended', () => step(1))
  au.addEventListener('loadedmetadata', () => ($('pdur').textContent = fmt(au.duration)))
  au.addEventListener('timeupdate', () => {
    if (!au.duration) return
    const p = au.currentTime / au.duration; seek.value = p * 1000; seek.style.setProperty('--p', p * 100 + '%'); $('pcur').textContent = fmt(au.currentTime)
  })
  seek.addEventListener('input', () => { if (au.duration) au.currentTime = (seek.value / 1000) * au.duration })
  addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal()
    else if (e.code === 'Space' && playing >= 0 && !/INPUT|BUTTON|TEXTAREA/.test(document.activeElement.tagName)) { e.preventDefault(); toggle() }
  })

  // ---------- licenses ----------
  const tierHTML = (l, beat) => `<div class="tier"><h3>${esc(l.name)}</h3><div class="price">${money(l.price)}</div><div class="files">${esc(l.files)}</div>
    <ul>${l.perks.map((p) => `<li>${esc(p)}</li>`).join('')}</ul><button class="buy" data-lic="${l.id}">${beat == null ? 'Pick a beat' : 'Buy ' + esc(l.name)}</button></div>`
  $('tiers').innerHTML = S.licenses.map((l) => tierHTML(l, null)).join('')
  $('tiers').addEventListener('click', (e) => { if (e.target.closest('[data-lic]')) location.hash = 'beats' })

  let modalBeat = -1, lastFocus
  function openModal(i) {
    modalBeat = i; lastFocus = document.activeElement; const b = BEATS[i]
    $('mcover').innerHTML = cover(i, 'm'); $('mtitle').textContent = b.title; $('mmeta').textContent = `${b.bpm} BPM · ${b.key} · ${b.tags.join(', ')}`
    $('mtiers').innerHTML = S.licenses.map((l) => tierHTML(l, i)).join(''); $('mnote').hidden = true
    $('modal').hidden = false; document.body.style.overflow = 'hidden'; $('mclose').focus()
  }
  function closeModal() { if ($('modal').hidden) return; $('modal').hidden = true; document.body.style.overflow = ''; lastFocus && lastFocus.focus() }
  $('mclose').onclick = closeModal
  $('modal').addEventListener('click', (e) => { if (e.target === $('modal')) closeModal() })
  $('mtiers').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-lic]'); if (!btn) return
    const l = S.licenses.find((x) => x.id === btn.dataset.lic)
    if (l.checkout) {
      const u = new URL(l.checkout, location.href); u.searchParams.set('client_reference_id', BEATS[modalBeat].title.replace(/\s+/g, '-').toLowerCase() + '_' + l.id)
      window.open(u.href, '_blank', 'noopener')
    } else {
      const n = $('mnote'); n.hidden = false
      n.textContent = S.email ? `Checkout isn't connected yet. Email ${S.email} to get "${BEATS[modalBeat].title}" on the ${l.name} license.` : `Checkout isn't connected yet. Add a checkout link for the ${l.name} license in data.js.`
    }
  })

  render()
})()
