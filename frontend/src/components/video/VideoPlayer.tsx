interface Props {
  videoId: string | null
}

export default function VideoPlayer({ videoId }: Props) {
  return (
    <div className="bg-black rounded-xl overflow-hidden shrink-0">
      {/* Outer div holds the 16:9 ratio; inner target gets replaced by YT iframe */}
      <div className="relative w-full aspect-video">
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
