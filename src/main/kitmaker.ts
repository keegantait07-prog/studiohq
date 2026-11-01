import { promises as fs, constants } from 'fs'
import { join } from 'path'
import { cleanName } from '../shared/kitmaker'

export interface ExportFile { from: string; folder: string; name: string }
export interface ExportResult { dir: string; copied: number; failed: string[] }

/** A folder name that does not exist yet: "Kit", then "Kit 2", "Kit 3"... An earlier export is never touched. */
async function freeDir(parent: string, name: string): Promise<string> {
  for (let i = 1; ; i++) {
    const dir = join(parent, i === 1 ? name : `${name} ${i}`)
    try { await fs.access(dir) } catch { return dir }
  }
}

/** Copies the picked sounds into a new kit folder under their new names. Originals are left alone. */
export async function exportKit(files: ExportFile[], outDir: string, kitName: string, mapPath: string | null): Promise<ExportResult> {
  const name = cleanName(kitName) || 'My Drum Kit'
  await fs.mkdir(outDir, { recursive: true })
  const dir = await freeDir(outDir, name)
  const failed: string[] = []
  const map: Record<string, string> = {}
  let copied = 0
  for (const f of files) {
    const to = join(dir, cleanName(f.folder), cleanName(f.name))
    try {
      await fs.mkdir(join(dir, cleanName(f.folder)), { recursive: true })
      await fs.copyFile(f.from, to, constants.COPYFILE_EXCL)
      map[to.slice(dir.length + 1)] = f.from
      copied++
    } catch { failed.push(f.name) }
  }
  if (mapPath) { try { await fs.writeFile(mapPath, JSON.stringify({ kit: dir, at: new Date().toISOString(), files: map }, null, 2)) } catch { /* the map is a convenience */ } }
  return { dir, copied, failed }
}
