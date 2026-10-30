// Edit this file to run your store. No build step: open index.html or deploy the folder as-is.
window.STORE = {
  artist: 'SMALLS',
  tagline: 'Beats for artists who move different.',
  email: '',          // contact email shown in the footer (leave '' to hide)
  instagram: '',      // e.g. 'https://instagram.com/yourhandle'
  youtube: '',
  // Paste a checkout link per license (Stripe Payment Link, BeatStars, Gumroad, PayPal.me ...).
  // Buying opens that link in a new tab. Leave '' while testing.
  licenses: [
    { id: 'mp3',   name: 'MP3 Lease',      price: 29.99,  checkout: '', files: 'MP3',               perks: ['Up to 100k streams', '1 music video', 'Non-profit performances', 'Credit "Prod. SMALLS"'] },
    { id: 'wav',   name: 'WAV Lease',      price: 49.99,  checkout: '', files: 'MP3 + WAV',         perks: ['Up to 500k streams', '2 music videos', 'Paid performances', 'Credit "Prod. SMALLS"'] },
    { id: 'stems', name: 'Unlimited',      price: 99.99,  checkout: '', files: 'MP3 + WAV + Stems', perks: ['Unlimited streams', 'Unlimited videos', 'Radio + commercial use', 'Credit "Prod. SMALLS"'] },
    { id: 'excl',  name: 'Exclusive',      price: 349.99, checkout: '', files: 'Everything',        perks: ['Beat removed from the store', 'Full ownership of the master', 'Unlimited everything', 'Credit "Prod. SMALLS"'] }
  ]
}

// One entry per beat. audio = a short tagged preview (never the clean file).
// The placeholder previews in /audio are synthesized demos: replace them with your own.
window.BEATS = [
  { title: 'Midnight Run', bpm: 140, key: 'F#m', tags: ['Trap', 'Dark'],       audio: 'audio/midnight-run.mp3', hue: 0 },
  { title: 'Static Bloom', bpm: 128, key: 'Cm',  tags: ['Hyperpop', 'Bright'], audio: 'audio/static-bloom.mp3', hue: 1 },
  { title: 'Glass Hours',  bpm: 150, key: 'Am',  tags: ['Drill', 'Cold'],      audio: 'audio/glass-hours.mp3',  hue: 2 },
  { title: 'Paper Planes', bpm: 92,  key: 'Dm',  tags: ['R&B', 'Smooth'],      audio: 'audio/paper-planes.mp3', hue: 3 },
  { title: 'Low Tide',     bpm: 100, key: 'Gm',  tags: ['Melodic', 'Late night'], audio: 'audio/low-tide.mp3',  hue: 4 },
  { title: 'Neon Drift',   bpm: 132, key: 'Bbm', tags: ['Club', 'Synth'],      audio: 'audio/neon-drift.mp3',   hue: 5 }
]
