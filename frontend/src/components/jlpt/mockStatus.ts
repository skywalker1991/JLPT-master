/** A mock exam under way, said plainly: which part is being taken and how long is left. */
export function mockUnderway(stage: string | null | undefined, remaining: number | null | undefined, short = false): string {
  const part = stage === 'listening' ? '聴解' : '言語知識・読解'
  if (short) {
    if (remaining == null) return `模拟考中：${part}`
    if (remaining <= 0) return `模拟考中：${part} 时间已到`
    const m = Math.ceil(remaining / 60)
    return `模拟考中：${part} 还剩 ${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`
  }
  if (remaining == null) return `模拟考进行中 · 正在考 ${part}`
  if (remaining <= 0) return `模拟考进行中 · ${part} 时间已到，打开后自动交卷`
  const m = Math.ceil(remaining / 60)
  const left = m >= 60 ? `${Math.floor(m / 60)} 小时 ${m % 60} 分钟` : `${m} 分钟`
  return `模拟考进行中 · 正在考 ${part} · 还剩 ${left}`
}
