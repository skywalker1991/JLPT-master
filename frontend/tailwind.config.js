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
  //  token            紙 (light)   夜 (dark)
  // 夜 sits just off black, with ink a warm off-white and one warm accent —
  // 金茶 — kept for the thick line under a gap and the main button.
  'bg':             ['#FFFFFF', '#141414'],
  'surface':        ['#FFFFFF', '#1C1C1C'],
  'border':         ['#E6E4E1', '#2E2E2E'],
  'fg':             ['#1C1917', '#E8E6E1'],
  'fg-muted':       ['#6B6560', '#A8A49C'],
  'fg-subtle':      ['#A3A09B', '#7A766F'],
  // Ink accent: the UI itself stays neutral so colour can carry meaning
  // (JLPT levels, parts of speech, right/wrong). Matches the logo.
  'accent':         ['#1C1917', '#D6C59C'],
  'accent-hover':   ['#3A3532', '#E6C77A'],
  'accent-light':   ['#F5F4F2', '#262626'],
  'accent-border':  ['#DBD8D4', '#3A3A3A'],
  'accent-fg':      ['#1C1917', '#E8E6E1'],
  'on-accent':      ['#FFFFFF', '#141414'],   // text/icons on an accent fill
  'success':        ['#10B981', '#10B981'],
  'success-light':  ['#ECFDF5', '#0B241B'],
  'success-fg':     ['#065F46', '#6EE7B7'],
  'danger':         ['#EF4444', '#EF4444'],
  'danger-light':   ['#FEF2F2', '#2E1212'],
  'danger-fg':      ['#991B1B', '#FCA5A5'],
}

// The two optional light themes: a ground, an ink and one accent each. Only
// these tokens change; level colours and right / wrong stay the same in
// every theme — they are information, not decoration.
const LIGHT_THEMES = {
  ai: {   // 藍: cool, for long study sessions
    'bg': '#F4F6F9', 'surface': '#FFFFFF', 'border': '#DDE2EA', 'fg': '#172033', 'fg-muted': '#5A6478',
    'fg-subtle': '#8C95A5', 'accent': '#2B4C7E', 'accent-hover': '#22406D', 'accent-light': '#EAEEF4',
    'accent-border': '#CBD3DF', 'accent-fg': '#172033', 'on-accent': '#FFFFFF',
  },
  koke: { // 苔: warm, for reading and reciting
    'bg': '#F5F5EE', 'surface': '#FFFFFF', 'border': '#DFE1D3', 'fg': '#1E2418', 'fg-muted': '#5D6452',
    'fg-subtle': '#8F947F', 'accent': '#55653A', 'accent-hover': '#475630', 'accent-light': '#ECEDE3',
    'accent-border': '#D2D5C3', 'accent-fg': '#1E2418', 'on-accent': '#FFFFFF',
  },
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
  const themes = Object.fromEntries(Object.entries(LIGHT_THEMES).map(([name, tokens]) => [
    `:root[data-theme="${name}"]:not(.dark)`,
    Object.fromEntries(Object.entries(tokens).map(([k, hex]) => [`--c-${k}`, hexToRgb(hex)])),
  ]))
  addBase({ ':root': light, ':root.dark': dark, ...themes })
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
        // Panels arriving: a sheet from the bottom, a dialog or card settling in
        'sheet-up': { '0%': { transform: 'translateY(100%)' }, '100%': { transform: 'translateY(0)' } },
        'drawer-in': { '0%': { transform: 'translateX(-100%)' }, '100%': { transform: 'translateX(0)' } },
        'fade-in': { '0%': { opacity: '0' }, '100%': { opacity: '1' } },
        'pop-in': { '0%': { opacity: '0', transform: 'scale(.96) translateY(6px)' }, '100%': { opacity: '1', transform: 'none' } },
        'rise-in': { '0%': { opacity: '0', transform: 'translateY(8px)' }, '100%': { opacity: '1', transform: 'none' } },
        // Answers: a wrong pick shakes once, a right one glows once
        'nope': { '0%,100%': { transform: 'translateX(0)' }, '20%,60%': { transform: 'translateX(-5px)' }, '40%,80%': { transform: 'translateX(5px)' } },
        'yes': { '0%': { boxShadow: '0 0 0 0 rgb(var(--c-success) / .45)' }, '100%': { boxShadow: '0 0 0 10px rgb(var(--c-success) / 0)' } },
        // 逐块揭示: the text floats up as its cover fades
        'reveal': { '0%': { opacity: '0', transform: 'translateY(4px)', filter: 'blur(3px)' }, '100%': { opacity: '1', transform: 'none', filter: 'none' } },
        // A gap line drawn in when a sentence's analysis arrives
        'mark-in': { '0%': { textDecorationColor: 'transparent' }, '100%': {} },
      },
      animation: {
        'sheet-up': 'sheet-up .28s cubic-bezier(.2,.9,.3,1)',
        'drawer-in': 'drawer-in .26s cubic-bezier(.2,.9,.3,1)',
        'fade-in': 'fade-in .2s ease-out',
        'pop-in': 'pop-in .22s cubic-bezier(.2,.9,.3,1)',
        'rise-in': 'rise-in .3s cubic-bezier(.2,.9,.3,1) both',
        'nope': 'nope .38s ease-in-out',
        'yes': 'yes .7s ease-out',
        'reveal': 'reveal .35s cubic-bezier(.2,.9,.3,1)',
        'mark-in': 'mark-in .6s ease-out',
        shimmer: 'shimmer 2s ease-in-out infinite',
        'slide-from-right': 'slide-from-right 0.22s ease-out',
        'slide-from-left': 'slide-from-left 0.22s ease-out',
      },
    },
  },
  plugins: [themeVars],
}
