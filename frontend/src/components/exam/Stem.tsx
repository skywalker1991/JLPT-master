/**
 * A question's stem, with the paper's underline shown as an underline.
 *
 * Three of the seven written 問題 ask about one specific word and say which by
 * underlining it. Ingest carries that through as `__…__` so it survives
 * extraction; printed literally, the question reads 「当時を__回顧__して」 and
 * the mark it is meant to carry becomes noise.
 */
export default function Stem({ text }: { text: string }) {
  const parts = text.split(/__(.+?)__/g)
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1
          ? (
            <span key={i} className="underline decoration-2 underline-offset-2 font-medium">
              {part}
            </span>
          )
          : <span key={i}>{part}</span>,
      )}
    </>
  )
}
