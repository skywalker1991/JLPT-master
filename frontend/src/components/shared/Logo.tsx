/**
 * Brand mark: two arcs with a node each, joined by a bar — the two languages
 * and what links them. Drawn in currentColor so it flips with the theme.
 */
export default function Logo({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true" fill="none">
      <path d="M5 14A11 11 0 0 1 14 5" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" />
      <path d="M27 18a11 11 0 0 1-9 9" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" />
      <circle cx="22.5" cy="7.5" r="3.1" fill="currentColor" />
      <circle cx="9.5" cy="24.5" r="3.1" fill="currentColor" />
      <rect x="11" y="14.4" width="10" height="3.2" rx="1.6" fill="currentColor" />
    </svg>
  )
}
