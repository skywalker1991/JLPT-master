import { useState, useEffect, useRef, useCallback } from 'react'
import { useLocation } from 'react-router-dom'
import { getSubtitles, analyzeStream, preprocess } from '../services/api'
import type { SubtitleEntry } from '../services/api'
import type { PreprocessedSentence } from '../types'
import AnalysisCard from '../components/analysis/AnalysisCard'
import VideoURLBar from '../components/video/VideoURLBar'
import VideoPlayer from '../components/video/VideoPlayer'
import KaraokeBar from '../components/video/KaraokeBar'
import SubtitleList from '../components/video/SubtitleList'
import type { SubtitleState, TokenTiming } from '../components/video/types'

declare global {
  interface Window {
    YT: typeof YT
    onYouTubeIframeAPIReady: () => void
  }
}

function computeTokenTimings(entry: SubtitleEntry, preprocessed: PreprocessedSentence): TokenTiming[] {
  const tokens = preprocessed.tokens
  if (tokens.length === 0) return []
  const totalChars = tokens.reduce((sum, t) => sum + t.surface.length, 0)
  if (totalChars === 0) return []

  const timings: TokenTiming[] = []
  let elapsed = 0
  for (const token of tokens) {
    const ratio = token.surface.length / totalChars
    const dur = ratio * entry.duration
    timings.push({ token, start: entry.start + elapsed, end: entry.start + elapsed + dur })
    elapsed += dur
  }
  return timings
}

function loadYTScript(): Promise<void> {
  return new Promise(resolve => {
    if (window.YT?.Player) { resolve(); return }
    const existing = document.getElementById('yt-iframe-api')
    if (!existing) {
      const script = document.createElement('script')
      script.id = 'yt-iframe-api'
      script.src = 'https://www.youtube.com/iframe_api'
      document.head.appendChild(script)
    }
    window.onYouTubeIframeAPIReady = resolve
  })
}

export default function VideoPage() {
  const [urlInput, setUrlInput]       = useState('')
  const [videoId, setVideoId]         = useState<string | null>(null)
  const [subtitles, setSubtitles]     = useState<SubtitleState[]>([])
  const [loading, setLoading]         = useState(false)
  const [error, setError]             = useState<string | null>(null)
  const [currentIdx, setCurrentIdx]   = useState<number>(-1)
  const [currentTime, setCurrentTime] = useState<number>(0)
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null)

  const playerRef  = useRef<YT.Player | null>(null)
  const rafRef     = useRef<number>(0)
  const { pathname } = useLocation()
  const isActive   = pathname === '/video'

  useEffect(() => {
    if (!isActive) playerRef.current?.pauseVideo()
  }, [isActive])

  useEffect(() => {
    if (!videoId) return
    let cancelled = false

    loadYTScript().then(() => {
      if (cancelled) return
      playerRef.current = new window.YT.Player('yt-player', {
        videoId,
        width: '100%',
        height: '100%',
        playerVars: { rel: 0, modestbranding: 1 },
      })
    })

    return () => {
      cancelled = true
      playerRef.current?.destroy()
      playerRef.current = null
      cancelAnimationFrame(rafRef.current)
    }
  }, [videoId])

  useEffect(() => {
    if (!videoId || subtitles.length === 0) return

    const tick = () => {
      const player = playerRef.current
      if (player && typeof player.getCurrentTime === 'function') {
        const t = player.getCurrentTime()
        setCurrentTime(t)
        let idx = -1
        for (let i = subtitles.length - 1; i >= 0; i--) {
          if (t >= subtitles[i].entry.start) { idx = i; break }
        }
        setCurrentIdx(prev => prev !== idx ? idx : prev)
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [videoId, subtitles])

  const handleLoad = async () => {
    const trimmed = urlInput.trim()
    if (!trimmed) return
    setLoading(true)
    setError(null)
    setSubtitles([])
    setCurrentIdx(-1)
    setCurrentTime(0)
    setSelectedIdx(null)
    setVideoId(null)

    try {
      const data = await getSubtitles(trimmed)
      setVideoId(data.video_id)

      const states: SubtitleState[] = data.subtitles.map(e => ({
        entry: e, preprocessed: null, tokenTimings: [], analysis: null, isAnalyzing: false,
      }))
      setSubtitles(states)

      const batchSize = 5
      for (let i = 0; i < states.length; i += batchSize) {
        await Promise.all(
          states.slice(i, i + batchSize).map(async (s, offset) => {
            try {
              const res = await preprocess(s.entry.text)
              const sent = res.sentences[0] ?? null
              const idx = i + offset
              setSubtitles(prev => {
                const next = [...prev]
                next[idx] = {
                  ...next[idx],
                  preprocessed: sent,
                  tokenTimings: sent ? computeTokenTimings(s.entry, sent) : [],
                }
                return next
              })
            } catch { /* skip */ }
          })
        )
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }

  const handleSelectSubtitle = useCallback(async (idx: number) => {
    setSelectedIdx(idx)
    playerRef.current?.seekTo(subtitles[idx].entry.start, true)
    playerRef.current?.pauseVideo()

    if (subtitles[idx].analysis || subtitles[idx].isAnalyzing) return

    setSubtitles(prev => {
      const next = [...prev]
      next[idx] = { ...next[idx], isAnalyzing: true }
      return next
    })

    try {
      const stream = analyzeStream({ text: subtitles[idx].entry.text, type: 'text' })
      for await (const sentence of stream) {
        setSubtitles(prev => {
          const next = [...prev]
          next[idx] = { ...next[idx], analysis: sentence, isAnalyzing: false }
          return next
        })
        break
      }
    } catch {
      setSubtitles(prev => {
        const next = [...prev]
        next[idx] = { ...next[idx], isAnalyzing: false }
        return next
      })
    }
  }, [subtitles])

  const current  = currentIdx >= 0 ? subtitles[currentIdx] : null
  const selected = selectedIdx !== null ? subtitles[selectedIdx] : null

  return (
    <div className="flex flex-col flex-1 min-h-0 p-4 gap-4 bg-bg overflow-hidden">

      <VideoURLBar
        value={urlInput}
        onChange={setUrlInput}
        onLoad={handleLoad}
        loading={loading}
        error={error}
      />

      <div className="flex flex-1 min-h-0 gap-4 overflow-hidden">

        {/* Left: Video + karaoke */}
        <div className="flex flex-col gap-4 shrink-0" style={{ width: '60%' }}>
          <VideoPlayer videoId={videoId} />
          <KaraokeBar
            timings={current?.tokenTimings ?? []}
            text={current?.entry.text ?? ''}
            zh={current?.entry.zh}
            en={current?.entry.en}
            currentTime={currentTime}
          />
        </div>

        {/* Right: Subtitle list + Analysis */}
        <div className="flex flex-col flex-1 min-h-0 gap-4 overflow-hidden">
          <SubtitleList
            subtitles={subtitles}
            currentIdx={currentIdx}
            selectedIdx={selectedIdx}
            onSelect={handleSelectSubtitle}
          />
          <div className="card flex-1 min-h-0 overflow-y-auto px-5 py-5">
            <AnalysisCard
              preprocessed={selected?.preprocessed ?? null}
              analysis={selected?.analysis ?? null}
              isEmpty={selectedIdx === null}
            />
          </div>
        </div>

      </div>
    </div>
  )
}
