interface Props {
  videoId: string | null
}

export default function VideoPlayer({ videoId }: Props) {
  return (
    <div className="w-full aspect-video md:aspect-auto md:flex-1 md:min-h-0 bg-black rounded-xl overflow-hidden shrink-0">
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
