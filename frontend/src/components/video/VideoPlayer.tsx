interface Props {
  videoId: string | null
}

export default function VideoPlayer({ videoId }: Props) {
  return (
    <div className="flex-1 min-h-0 bg-black rounded-xl overflow-hidden">
      <div className="relative h-full">
        {videoId
          ? <div id="yt-player" className="absolute inset-0 w-full h-full" />
          : <div className="absolute inset-0 flex items-center justify-center text-white/20 text-sm">
              输入链接后加载视频
            </div>
        }
      </div>
    </div>
  )
}
