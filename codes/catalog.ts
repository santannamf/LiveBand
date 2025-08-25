// lib/catalog.ts
export type Song = {
  id: string
  filename: string
  driveUrl?: string
  title: string
  artist: string
  year?: string
  tags: {
    genre: string[]
    epoch?: string[]
    origin: 'national' | 'international'
    voice: 'male' | 'female' | 'duet'
  }
}

export async function loadCatalogue(): Promise<Song[]> {
  const res = await fetch('/data/song_full_list_v8.json', { cache: 'no-store' })
  if (!res.ok) throw new Error(`Catalogue fetch failed: ${res.status}`)
  const data = await res.json()

  // Defensive normalization so the UI never crashes
  if (!Array.isArray(data)) return []
  return data.map((s: any) => ({
    id: String(s?.id ?? ''),
    filename: String(s?.filename ?? ''),
    driveUrl: s?.driveUrl ? String(s.driveUrl) : undefined,
    title: String(s?.title ?? ''),
    artist: String(s?.artist ?? ''),
    year: s?.year ? String(s.year) : undefined,
    tags: {
      genre: Array.isArray(s?.tags?.genre) ? s.tags.genre.map(String) : [],
      epoch: Array.isArray(s?.tags?.epoch) ? s.tags.epoch.map(String) : [],
      origin: (s?.tags?.origin === 'national' || s?.tags?.origin === 'international')
        ? s.tags.origin : 'international',
      voice: (s?.tags?.voice === 'male' || s?.tags?.voice === 'female' || s?.tags?.voice === 'duet')
        ? s.tags.voice : 'male',
    },
  }))
}
