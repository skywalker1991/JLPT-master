import { useRef, useState } from 'react'
import { Loader2, Play, Pause, RotateCcw } from 'lucide-react'
import { makeItemAudio, mediaUrl } from '../../services/api'

/**
 * The recording a 聴解 question should have come with.
 *
 * The paper prints nothing for 聴解問題3 and 問題4 and no file we have carries
 * the audio, so the dialogue out of the 解析 booklet is spoken instead. It is
 * synthesised on the first press and kept, so meeting the question again — in
 * review, in the mistakes list, on a second sitting — plays the same recording
 * at once.
 */
export default function PlayAudio({ itemId }: { itemId: string }) {
  const [src, setSrc] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const audio = useRef<HTMLAudioElement>(null)

  async function toggle() {
    if (src) {
      const el = audio.current
      if (!el) return
      if (el.paused) { void el.play(); setPlaying(true) } else { el.pause(); setPlaying(false) }
      return
    }
    setLoading(true)
    setError(null)
    try {
      const { media_id } = await makeItemAudio(itemId)
      setSrc(mediaUrl(media_id))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  function replay() {
    const el = audio.current
    if (!el) return
    el.currentTime = 0
    void el.play()
    setPlaying(true)
  }

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={toggle}
        disabled={loading}
        className="flex items-center gap-2 px-3.5 py-2 rounded-full bg-accent text-on-accent
                   text-sm font-medium hover:bg-accent-hover disabled:opacity-50 transition-colors"
      >
        {loading ? <Loader2 className="w-4 h-4 animate-spin" />
          : playing ? <Pause className="w-4 h-4" />
          : <Play className="w-4 h-4" />}
        {loading ? '生成中' : playing ? '暂停' : src ? '播放' : '播放录音'}
      </button>

      {src && (
        <button
          onClick={replay}
          className="p-2 rounded-full text-fg-muted hover:text-fg hover:bg-bg transition-colors"
          title="从头再听"
        >
          <RotateCcw className="w-4 h-4" />
        </button>
      )}

      {error && <span className="text-xs text-danger">{error}</span>}

      {src && (
        <audio
          ref={audio}
          src={src}
          autoPlay
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
        />
      )}
    </div>
  )
}
