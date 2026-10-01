/** A 文の組み立て question: the sentence with its four numbered slots, ★ marking the one asked. */
export default function SentenceOrderStem({ stem }: { stem: string }) {
  const parts = stem.split(/(\[_\d+★?_\])/g)
  return (
    <p className="text-base text-fg leading-relaxed">
      {parts.map((part, i) => {
        const star = /\[_(\d+)★_\]/.exec(part)
        const plain = /\[_(\d+)_\]/.exec(part)
        if (star) return (
          <span key={i} className="inline-flex items-center justify-center w-8 h-8 mx-0.5 rounded-lg bg-accent text-on-accent text-xs font-bold align-middle">★</span>
        )
        if (plain) return (
          <span key={i} className="inline-flex items-center justify-center w-8 h-8 mx-0.5 rounded-lg bg-border/60 text-fg-muted text-xs font-bold align-middle">{plain[1]}</span>
        )
        return <span key={i}>{part}</span>
      })}
    </p>
  )
}
