'use client'

import { useEffect, useMemo, useState } from 'react'
import { loadCatalogue, type Song } from '@/lib/catalog'

export default function Home() {
  const [songs, setSongs] = useState<Song[]>([])
  const [query, setQuery] = useState('')

  useEffect(() => {
    loadCatalogue()
      .then(setSongs)
      .catch((e) => {
        console.error(e)
        alert('Falha ao carregar o catálogo. Confirme o arquivo em /public/data/song_full_list_v8.json')
      })
  }, [])

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return songs
    return songs.filter(s =>
      (s.title || '').toLowerCase().includes(q) ||
      (s.artist || '').toLowerCase().includes(q)
    )
  }, [songs, query])

  return (
    <main style={{ maxWidth: 720, margin: '0 auto', padding: 16 }}>
      <h1>Live Band App</h1>
      <input
        placeholder="Buscar música ou artista…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        style={{ width: '100%', padding: 12, margin: '12px 0' }}
      />
      <p style={{fontSize:12, color:'#888', marginTop:0}}>
        Mostrando {results.length} de {songs.length} músicas
      </p>

      {!results.length ? (
        <p style={{color:'#777'}}>Nenhum resultado.</p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0 }}>
          {results.map((s) => (
            <li key={s.id} style={{
              border: '1px solid #eee',
              borderRadius: 8,
              padding: 12,
              marginBottom: 8
            }}>
              <div style={{ fontWeight: 600 }}>{s.title}</div>
              <div style={{ color: '#555' }}>{s.artist}</div>
              <div style={{ fontSize: 12, color: '#777' }}>
                {(s.tags.genre || []).join(', ')} {s.year ? `• ${s.year}` : ''}
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
