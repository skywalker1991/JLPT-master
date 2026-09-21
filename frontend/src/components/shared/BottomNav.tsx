import { NavLink } from 'react-router-dom'
import clsx from 'clsx'
import { NAV } from './TopNav'
import ThemeToggle from './ThemeToggle'

/** Phone navigation: a tab bar at the bottom, within thumb reach. */
export default function BottomNav() {
  return (
    <nav
      className="md:hidden shrink-0 grid grid-cols-6 bg-surface border-t border-border"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      {NAV.filter(n => n.mobile).map(({ to, end, icon: Icon, label }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          className={({ isActive }) =>
            clsx(
              'flex flex-col items-center gap-0.5 pt-2 pb-1.5 text-[10px] font-medium transition-colors',
              isActive ? 'text-accent-fg' : 'text-fg-subtle',
            )
          }
        >
          {({ isActive }) => (
            <>
              <Icon className={clsx('w-5 h-5', isActive && 'text-accent')} />
              {label}
            </>
          )}
        </NavLink>
      ))}
      <ThemeToggle variant="tab" />
    </nav>
  )
}
