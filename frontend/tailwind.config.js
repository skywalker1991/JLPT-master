/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#FAF9F7',
        surface: '#FFFFFF',
        border: '#E8E2D9',
        fg: {
          DEFAULT: '#1C1917',
          muted: '#78716C',
          subtle: '#A8A29E',
        },
        accent: {
          DEFAULT: '#D97757',
          hover: '#C4694A',
          light: '#FDF3EE',
          border: '#F5C4A8',
          fg: '#9B3E22',
        },
        success: {
          DEFAULT: '#10B981',
          light: '#ECFDF5',
          fg: '#065F46',
        },
        danger: {
          DEFAULT: '#EF4444',
          light: '#FEF2F2',
          fg: '#991B1B',
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
        topbar: '0 1px 0 0 #E8E2D9',
      },
      keyframes: {
        shimmer: {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(200%)' },
        },
      },
      animation: {
        shimmer: 'shimmer 2s ease-in-out infinite',
      },
    },
  },
  plugins: [],
}
