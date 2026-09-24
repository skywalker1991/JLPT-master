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
  // Dark mode sits just off pure black: cards can then be lighter than the
  // page (layers read without extra borders) and colour stops glaring.
  'bg':             ['#FFFFFF', '#0D0D0D'],
  'surface':        ['#FFFFFF', '#1A1A1A'],
  'border':         ['#E6E4E1', '#2E2E2E'],
  'fg':             ['#1C1917', '#E8E8E8'],
  'fg-muted':       ['#6B6560', '#A8A8A8'],
  'fg-subtle':      ['#A3A09B', '#7A7A7A'],
  // Ink accent: the UI itself stays neutral so colour can carry meaning
  // (JLPT levels, parts of speech, right/wrong). Matches the logo.
  'accent':         ['#1C1917', '#E3E3E3'],
  'accent-hover':   ['#3A3532', '#FFFFFF'],
  'accent-light':   ['#F5F4F2', '#232323'],
  'accent-border':  ['#DBD8D4', '#3A3A3A'],
  'accent-fg':      ['#1C1917', '#EDEDED'],
  'on-accent':      ['#FFFFFF', '#141414'],   // text/icons on an accent fill
  'success':        ['#10B981', '#10B981'],
  'success-light':  ['#ECFDF5', '#0B241B'],
  'success-fg':     ['#065F46', '#6EE7B7'],
  'danger':         ['#EF4444', '#EF4444'],
  'danger-light':   ['#FEF2F2', '#2E1212'],
  'danger-fg':      ['#991B1B', '#FCA5A5'],
}

const SHADES = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950]
const NEUTRALS = ['slate', 'gray', 'zinc', 'neutral', 'stone']
const HUES = [
  ...NEUTRALS, 'red', 'orange', 'amber', 'yellow', 'lime', 'green', 'emerald', 'teal',
  'cyan', 'sky', 'blue', 'indigo', 'violet', 'purple', 'fuchsia', 'pink', 'rose',
]
// Neutral greys in dark mode: a pure-black page wants a neutral scale, not a
// warm one, or greys read brown against it.
const DARK_NEUTRAL = {
  50: '#141414', 100: '#1C1C1C', 200: '#292929', 300: '#3D3D3D', 400: '#737373',
  500: '#8C8C8C', 600: '#A3A3A3', 700: '#C7C7C7', 800: '#DEDEDE', 900: '#EDEDED', 950: '#F7F7F7',
}

const mirror = shade => SHADES[SHADES.length - 1 - SHADES.indexOf(shade)]

// Pale tints (50/100) are used as badge/chip backgrounds; their mirrored
// shades (950/900) are too saturated on a dark page, so mix them toward the
// dark surface colour.
const DARK_SURFACE = '#1A1A1A'
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
        NEUTRALS.includes(hue) ? DARK_NEUTRAL[shade]
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
        fg: {
          DEFAULT: v('fg'),
          muted: v('fg-muted'),
          subtle: v('fg-subtle'),
        },
        'on-accent': v('on-accent'),
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
        // 明朝体, for question text. The paper is set in it, and the system
        // fallback is a gothic — the difference is the first thing you notice
        // holding the real thing next to the screen.
        jp: ['"Noto Serif JP"', '"Yu Mincho"', '"Hiragino Mincho ProN"', 'serif'],
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
