export function jlptBadgeClass(level: string | null | undefined): string {
  if (!level) return 'bg-gray-100 text-fg-muted'
  const upper = level.toUpperCase()
  if (upper === 'N1') return 'bg-red-50 text-red-700 ring-1 ring-red-200/60'
  if (upper === 'N2') return 'bg-orange-50 text-orange-700 ring-1 ring-orange-200/60'
  if (upper === 'N3') return 'bg-yellow-50 text-yellow-700 ring-1 ring-yellow-200/60'
  if (upper === 'N4') return 'bg-green-50 text-green-700 ring-1 ring-green-200/60'
  if (upper === 'N5') return 'bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200/60'
  return 'bg-gray-100 text-fg-muted'
}
