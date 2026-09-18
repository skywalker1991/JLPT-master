/** @type {import('tailwindcss').Config} */
import defaultColors from 'tailwindcss/colors.js'
import plugin from 'tailwindcss/plugin.js'

// ── Theming ────────────────────────────────────────────────────────────────
// Every colour is a CSS variable (RGB triplet) so the whole UI switches
// between light and dark by toggling the `dark` class on <html>.
//
// Semantic tokens (bg, surface, fg, accent …) get hand-picked dark values.
// Tailwind's own palettes (gray-100, red-50, text-blue-700 …, used directly in
// many components) are mirrored in dark mode — shade 50 ↔ 950, 100 ↔ 900,
// 700 ↔ 300 … — so a pale badge background becomes a deep one and dark text
// becomes light, keeping contrast without touching each component. Neutral
// palettes map to a warm charcoal scale to match the app's paper tone.

const hexToRgb = hex => {
  const h = hex.replace('#', '')
  return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)).join(' ')
}

const SEMANTIC = {
  //  token            light       dark
  'bg':             ['#FAF9F7', '#171412'],
  'surface':        ['#FFFFFF', '#1F1B18'],
  'border':         ['#E8E2D9', '#352E29'],
  'fg':             ['#1C1917', '#EDE7E1'],
  'fg-muted':       ['#78716C', '#A89F97'],
  'fg-subtle':      ['#A8A29E', '#7D746C'],
  'accent':         ['#D97757', '#D97757'],
  'accent-hover':   ['#C4694A', '#E48A6B'],
  'accent-light':   ['#FDF3EE', '#2C1F19'],
  'accent-border':  ['#F5C4A8', '#5C3A2B'],
  'accent-fg':      ['#9B3E22', '#F2A98C'],
  'success':        ['#10B981', '#10B981'],
  'success-light':  ['#ECFDF5', '#0F2A20'],
  'success-fg':     ['#065F46', '#6EE7B7'],
  'danger':         ['#EF4444', '#EF4444'],
  'danger-light':   ['#FEF2F2', '#3A1616'],
  'danger-fg':      ['#991B1B', '#FCA5A5'],
  'dot':            ['#C4B49E', '#2E2823'],   // body dot pattern
}

const SHADES = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950]
const NEUTRALS = ['slate', 'gray', 'zinc', 'neutral', 'stone']
const HUES = [
  ...NEUTRALS, 'red', 'orange', 'amber', 'yellow', 'lime', 'green', 'emerald', 'teal',
  'cyan', 'sky', 'blue', 'indigo', 'violet', 'purple', 'fuchsia', 'pink', 'rose',
]
const WARM_DARK_NEUTRAL = {
  50: '#26211D', 100: '#2B2521', 200: '#383029', 300: '#4A413A', 400: '#7D746C',
  500: '#9A9189', 600: '#B5ADA5', 700: '#D0C9C2', 800: '#E3DDD7', 900: '#EDE7E1', 950: '#F5F1ED',
}
const mirror = shade => SHADES[SHADES.length - 1 - SHADES.indexOf(shade)]

// Pale tints (50/100) are used as badge/chip backgrounds; their mirrored
// shades (950/900) are too saturated on a dark page, so mix them toward the
// dark surface colour.
const DARK_SURFACE = '#1F1B18'
const mix = (a, b, t) => {
  const [x, y] = [a, b].map(h => [0, 2, 4].map(i => parseInt(h.replace('#', '').slice(i, i + 2), 16)))
  return '#' + x.map((c, i) => Math.round(c * (1 - t) + y[i] * t).toString(16).padStart(2, '0')).join('')
}
const TINT_TO_SURFACE = { 50: 0.55, 100: 0.4 }

const v = name => `rgb(var(--c-${name}) / <alpha-value>)`

const themeVars = plugin(({ addBase }) => {
  const light = { colorScheme: 'light' }
  const dark = { colorScheme: 'dark' }
  for (const [name, [l, d]] of Object.entries(SEMANTIC)) {
    light[`--c-${name}`] = hexToRgb(l)
    dark[`--c-${name}`] = hexToRgb(d)
  }
  for (const hue of HUES) {
    for (const shade of SHADES) {
      light[`--c-${hue}-${shade}`] = hexToRgb(defaultColors[hue][shade])
      const mirrored = defaultColors[hue][mirror(shade)]
      dark[`--c-${hue}-${shade}`] = hexToRgb(
        NEUTRALS.includes(hue) ? WARM_DARK_NEUTRAL[shade]
          : shade in TINT_TO_SURFACE ? mix(mirrored, DARK_SURFACE, TINT_TO_SURFACE[shade])
          : mirrored,
      )
    }
  }
  addBase({ ':root': light, ':root.dark': dark })
})

const palettes = Object.fromEntries(
  HUES.map(hue => [hue, Object.fromEntries(SHADES.map(s => [s, v(`${hue}-${s}`)]))]),
)

export default {
  darkMode: 'class',
  // `dark` is only ever added at runtime, so keep its rules from being purged
  safelist: ['dark'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ...palettes,
        bg: v('bg'),
        surface: v('surface'),
        border: v('border'),
        dot: v('dot'),
        fg: {
          DEFAULT: v('fg'),
          muted: v('fg-muted'),
          subtle: v('fg-subtle'),
        },
        accent: {
          DEFAULT: v('accent'),
          hover: v('accent-hover'),
          light: v('accent-light'),
          border: v('accent-border'),
          fg: v('accent-fg'),
        },
        success: {
          DEFAULT: v('success'),
          light: v('success-light'),
          fg: v('success-fg'),
        },
        danger: {
          DEFAULT: v('danger'),
          light: v('danger-light'),
          fg: v('danger-fg'),
        },
      },
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', 'Inter', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', '"Fira Code"', 'Consolas', 'monospace'],
      },
      fontSize: {
        '2xs': ['0.625rem', { lineHeight: '1rem' }],
      },
      boxShadow: {
        card: '0 1px 3px 0 rgba(0,0,0,0.07), 0 1px 2px -1px rgba(0,0,0,0.05)',
        'card-md': '0 4px 6px -1px rgba(0,0,0,0.07), 0 2px 4px -2px rgba(0,0,0,0.05)',
        topbar: '0 1px 0 0 rgb(var(--c-border))',
      },
      keyframes: {
        shimmer: {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(200%)' },
        },
        'slide-from-right': {
          '0%': { transform: 'translateX(24%)', opacity: '0' },
          '100%': { transform: 'translateX(0)', opacity: '1' },
        },
        'slide-from-left': {
          '0%': { transform: 'translateX(-24%)', opacity: '0' },
          '100%': { transform: 'translateX(0)', opacity: '1' },
        },
      },
      animation: {
        shimmer: 'shimmer 2s ease-in-out infinite',
        'slide-from-right': 'slide-from-right 0.22s ease-out',
        'slide-from-left': 'slide-from-left 0.22s ease-out',
      },
    },
  },
  plugins: [themeVars],
}
