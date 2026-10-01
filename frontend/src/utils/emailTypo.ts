/** The addresses people in China and Japan actually use. A sign-up is not
 *  verified by email yet, so a mistyped domain would lock someone out —
 *  the least we can do is ask "did you mean…?" before they submit. */
const COMMON = [
  'qq.com', '163.com', '126.com', 'foxmail.com', 'sina.com', 'sohu.com', 'aliyun.com', '139.com',
  'gmail.com', 'outlook.com', 'hotmail.com', 'icloud.com', 'yahoo.com', 'yahoo.co.jp',
  'docomo.ne.jp', 'ezweb.ne.jp', 'softbank.ne.jp', 'me.com',
]

function distance(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)])
  for (let j = 1; j <= b.length; j++) dp[0][j] = j
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
  }
  return dp[a.length][b.length]
}

/** "xx@qq.con" → "xx@qq.com"; null when the domain looks fine. */
export function suggestEmail(email: string): string | null {
  const at = email.lastIndexOf('@')
  if (at < 1) return null
  const domain = email.slice(at + 1).trim().toLowerCase()
  if (!domain || COMMON.includes(domain)) return null
  let best: string | null = null
  let bestD = 3
  for (const d of COMMON) {
    const dist = distance(domain, d)
    if (dist < bestD) { best = d; bestD = dist }
  }
  return best ? `${email.slice(0, at)}@${best}` : null
}
