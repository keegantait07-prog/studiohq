// Asks Claude to package a beat in the researched style. Bad or missing answers fall back to the template copy.
import { buildPrompt, fallbackPackage, parsePackage, validatePackage } from '../shared/ytPackage'
import type { BeatProfile, PackageDraft, StyleProfile } from '../shared/ytTypes'

const MODEL = 'claude-sonnet-5-5'

export async function packageBeat(
  o: { beat: BeatProfile; style: StyleProfile; producer: string; apiKey: string | null; year: number },
  fetchFn: typeof fetch = fetch
): Promise<PackageDraft> {
  const fallback = () => fallbackPackage(o.beat, o.producer, o.year, o.style)
  if (!o.apiKey) return fallback()
  const { system, user } = buildPrompt(o.beat, o.style, o.producer)
  const examples = o.style.examples.map((e) => e.title)
  const messages: { role: 'user' | 'assistant'; content: string }[] = [{ role: 'user', content: user }]
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await fetchFn('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': o.apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({ model: MODEL, max_tokens: 2000, system, messages })
      })
      if (!res.ok) return fallback()
      const text = ((await res.json()) as { content?: { type: string; text?: string }[] }).content?.find((c) => c.type === 'text')?.text ?? ''
      const pkg = parsePackage(text)
      const problems = pkg ? validatePackage(pkg, examples) : ['The reply was not the JSON object that was asked for.']
      if (pkg && !problems.length) return pkg
      messages.push({ role: 'assistant', content: text }, { role: 'user', content: `Fix these problems and reply with JSON only:\n${problems.map((p) => `- ${p}`).join('\n')}` })
    }
  } catch { /* network down: use the templates */ }
  return fallback()
}
