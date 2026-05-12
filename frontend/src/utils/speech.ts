let current: HTMLAudioElement | null = null

export async function speak(text: string): Promise<void> {
  // Stop any currently playing audio
  if (current) {
    current.pause()
    current = null
  }

  const resp = await fetch(`/api/tts?text=${encodeURIComponent(text)}`)
  if (!resp.ok) return

  const blob = await resp.blob()
  const audio = new Audio(URL.createObjectURL(blob))
  current = audio

  return new Promise(resolve => {
    audio.onended = () => { current = null; resolve() }
    audio.onerror = () => { current = null; resolve() }
    audio.play()
  })
}
