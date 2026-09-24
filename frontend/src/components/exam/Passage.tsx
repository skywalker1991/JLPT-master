/**
 * A passage, with its blanks shown as blanks.
 *
 * 短文填空 asks its questions inside the text rather than as stems, so an item
 * arrives with nothing but four options. The paper prints the gap as a bare
 * number in the running line — 「テレビを 41 と書いていた」 — which reads as
 * part of the sentence; ingest marks them 【41】 so they can be shown as what
 * they are, and the one being answered can be told apart from the rest.
 */
export default function Passage({
  text, active, className,
}: {
  text: string
  /** The question being answered now, if any. */
  active?: number | null
  className?: string
}) {
  const parts = text.split(/【(\d{1,3})】/g)

  return (
    <div className={className}>
      {parts.map((part, i) => {
        if (i % 2 === 0) return <span key={i}>{part}</span>
        const num = Number(part)
        const here = active != null && num === active
        return (
          <span
            key={i}
            className={
              here
                ? 'inline-flex items-center justify-center min-w-[2.25rem] mx-0.5 px-1.5 rounded bg-accent text-white text-xs font-bold align-middle'
                : 'inline-flex items-center justify-center min-w-[2.25rem] mx-0.5 px-1.5 rounded border border-border text-fg-subtle text-xs font-medium align-middle'
            }
          >
            {num}
          </span>
        )
      })}
    </div>
  )
}
