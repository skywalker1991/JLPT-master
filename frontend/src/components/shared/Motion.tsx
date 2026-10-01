/** The mark, built so its arcs, dots and bar can move on their own. */
function Mark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true" fill="none">
      <path className="logo-arc" d="M5 14A11 11 0 0 1 14 5" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" />
      <path className="logo-arc" d="M27 18a11 11 0 0 1-9 9" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" />
      <circle className="logo-dot" cx="22.5" cy="7.5" r="3.1" fill="currentColor" />
      <circle className="logo-dot" cx="9.5" cy="24.5" r="3.1" fill="currentColor" />
      <rect className="logo-bar" x="11" y="14.4" width="10" height="3.2" rx="1.6" fill="currentColor" />
    </svg>
  )
}

/**
 * 思考中: the AI is working (analysing, explaining, answering). The two
 * arcs are drawn and withdrawn in turn and never meet. Replaces spinners
 * wherever the wait is the AI's.
 */
export function Thinking({ className = 'w-5 h-5', label = '思考中' }: { className?: string; label?: string }) {
  return (
    <span role="status" aria-label={label} className="inline-flex thinking">
      <Mark className={className} />
    </span>
  )
}

/**
 * 连接成立: something is now yours — a word kept, a passage said, a day
 * done, an answer right. The arcs draw together and the dots hop once.
 * Remount (change `key`) to play it again.
 */
export function Connected({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <span className="inline-flex connected" aria-hidden="true">
      <Mark className={className} />
    </span>
  )
}
