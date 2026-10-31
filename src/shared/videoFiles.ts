// File names of exported videos: how a beat title becomes a file name, and how a YouTube export's name gives its beat back.
export const fileSafeTitle = (t: string): string => t.replace(/[\\/:*?"<>|]/g, '').trim() || 'Beat'

/** "Night Shift - YouTube.mp4" and "Night Shift - YouTube 2.mp4" give "Night Shift"; any other file gives null. */
export function youtubeFileTitle(name: string): string | null {
  return name.match(/^(.+) - YouTube(?: \d+)?\.mp4$/i)?.[1] ?? null
}
