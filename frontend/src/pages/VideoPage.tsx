import { useState, useEffect, useRef, useCallback } from 'react'
import clsx from 'clsx'
import { useLocation } from 'react-router-dom'
import { getSubtitles, analyzeStream, preprocess } from '../services/api'
import type { SubtitleEntry } from '../services/api'
import type { PreprocessedSentence } from '../types'
import { tokensFor } from '../utils/tokens'
import AnalysisCard from '../components/analysis/AnalysisCard'
import VideoURLBar from '../components/video/VideoURLBar'
import VideoPlayer from '../components/video/VideoPlayer'
import KaraokeBar from '../components/video/KaraokeBar'
import SubtitleList from '../components/video/SubtitleList'
import type { SubtitleState, TokenTiming } from '../components/video/types'

declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    YT: any
    onYouTubeIframeAPIReady: () => void
  }
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace YT {
    class Player {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      constructor(el: string | HTMLElement, opts: any)
      getCurrentTime(): number
      pauseVideo(): void
      playVideo(): void
      seekTo(seconds: number, allowSeekAhead: boolean): void
      destroy(): void
    }
    enum PlayerState { PLAYING = 1, PAUSED = 2 }
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
  const [mobileTab, setMobileTab] = useState<'subs' | 'analysis'>('subs')

  // Latest subtitles for callbacks that shouldn't re-subscribe on every update
  const subtitlesRef = useRef<SubtitleState[]>([])
  useEffect(() => { subtitlesRef.current = subtitles }, [subtitles])

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
      tokenizedRef.current = new Set()
      void tokenizeAround(0, states)
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }

  // Tokenising every line up front meant one request per subtitle (60+ for a
  // short video). Only the lines around the playhead — and whatever is tapped
  // — are needed, so do those and remember what's done.
  const tokenizedRef = useRef<Set<number>>(new Set())

  const tokenizeAround = useCallback(async (idx: number, source?: SubtitleState[]) => {
    const list = source ?? subtitlesRef.current
    const wanted = []
    for (let i = Math.max(0, idx - 1); i <= Math.min(list.length - 1, idx + 3); i++) {
      if (!tokenizedRef.current.has(i)) { tokenizedRef.current.add(i); wanted.push(i) }
    }
    await Promise.all(wanted.map(async i => {
      const entry = list[i].entry
      try {
        const res = await preprocess(entry.text)
        const tokens = tokensFor(entry.text, res)
        const sent = tokens.length > 0
          ? { index: 0, text: entry.text, tokens }
          : res.sentences[0] ?? null
        setSubtitles(prev => {
          const next = [...prev]
          if (!next[i]) return prev
          next[i] = { ...next[i], preprocessed: sent, tokenTimings: sent ? computeTokenTimings(entry, sent) : [] }
          return next
        })
      } catch {
        tokenizedRef.current.delete(i)   // let it be retried
      }
    }))
  }, [])

  const handleSelectSubtitle = useCallback(async (idx: number) => {
    setSelectedIdx(idx)
    setMobileTab('analysis')
    void tokenizeAround(idx)
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

  // Keep the lines around the playhead tokenised as the video plays
  useEffect(() => {
    if (currentIdx >= 0) void tokenizeAround(currentIdx)
  }, [currentIdx, tokenizeAround])

  const current  = currentIdx >= 0 ? subtitles[currentIdx] : null
  const selected = selectedIdx !== null ? subtitles[selectedIdx] : null

  return (
    <div className="flex flex-col flex-1 min-h-0 p-2 md:p-4 gap-3 md:gap-4 bg-bg overflow-hidden">

      <VideoURLBar
        value={urlInput}
        onChange={setUrlInput}
        onLoad={handleLoad}
        loading={loading}
        error={error}
      />

      <div className="flex flex-1 min-h-0 flex-col md:flex-row gap-3 md:gap-4 overflow-hidden">

        {/* Video + the line being spoken. Full width on phones, 60% beside the
            list on desktop. */}
        <div className="flex flex-col gap-3 md:gap-4 md:shrink-0 min-h-0 md:w-[60%]">
          <VideoPlayer videoId={videoId} />
          <KaraokeBar
            timings={current?.tokenTimings ?? []}
            text={current?.entry.text ?? ''}
            zh={current?.entry.zh}
            en={current?.entry.en}
            currentTime={currentTime}
          />
        </div>

        {/* Phones show one of the two panes at a time; desktop stacks both. */}
        <div className="md:hidden flex gap-1 p-1 rounded-xl bg-gray-100 shrink-0">
          {([['subs', '字幕'], ['analysis', '解析']] as const).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setMobileTab(key)}
              aria-pressed={mobileTab === key}
              className={clsx(
                'flex-1 rounded-lg py-1.5 text-xs font-semibold transition-colors',
                mobileTab === key ? 'bg-surface text-fg shadow-sm' : 'text-fg-muted',
              )}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="flex flex-col flex-1 min-h-0 gap-4">
          <div className={clsx('flex flex-1 min-h-0', mobileTab !== 'subs' && 'hidden md:flex')}>
            <SubtitleList
              subtitles={subtitles}
              currentIdx={currentIdx}
              selectedIdx={selectedIdx}
              onSelect={handleSelectSubtitle}
            />
          </div>
          <div className={clsx(
            'card flex-1 min-h-0 overflow-y-auto px-4 md:px-5 py-4 md:py-5',
            mobileTab !== 'analysis' && 'hidden md:block',
          )}>
            <AnalysisCard
              preprocessed={selected?.preprocessed ?? null}
              analysis={selected?.analysis ?? null}
            />
          </div>
        </div>

      </div>
    </div>
  )
}
