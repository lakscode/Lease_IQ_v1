import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/AuthProvider'
import { supabase } from '../lib/supabase'
import { LOCALES, useLocale, useT, type Locale } from '../i18n'
import { common } from '../i18n/messages/common'

// 16px stroke icons (Lucide-style paths), drawn in currentColor.
const ICONS: Record<string, ReactNode> = {
  dashboard: <><rect x="3" y="3" width="7" height="9" rx="1" /><rect x="14" y="3" width="7" height="5" rx="1" /><rect x="14" y="12" width="7" height="9" rx="1" /><rect x="3" y="16" width="7" height="5" rx="1" /></>,
  leases: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" /></>,
  chat: <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />,
  import: <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="M17 8l-5-5-5 5M12 3v12" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></>,
  globe: <><circle cx="12" cy="12" r="10" /><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" /></>,
  chevron: <path d="M6 9l6 6 6-6" />,
  check: <path d="M20 6L9 17l-5-5" />,
  logout: <><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="M16 17l5-5-5-5M21 12H9" /></>,
  menu: <path d="M3 6h18M3 12h18M3 18h18" />,
  chevronsLeft: <path d="M11 17l-5-5 5-5M18 17l-5-5 5-5" />,
  chevronsRight: <path d="M13 17l5-5-5-5M6 17l5-5-5-5" />,
  close: <path d="M18 6L6 18M6 6l12 12" />,
}

function Icon({ name, size = 16 }: { name: keyof typeof ICONS; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {ICONS[name]}
    </svg>
  )
}

/** Open state for a popover menu that closes on outside click, Escape and navigation. */
function useMenu() {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const { pathname } = useLocation()

  useEffect(() => setOpen(false), [pathname])

  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return { open, setOpen, ref }
}

function LanguageMenu() {
  const { t } = useT(common)
  const { locale, setLocale } = useLocale()
  const menu = useMenu()

  return (
    <div className="nav-menu" ref={menu.ref}>
      <button
        className="nav-icon-btn nav-lang-btn"
        aria-haspopup="menu"
        aria-expanded={menu.open}
        aria-label={t('language')}
        title={t('language')}
        onClick={() => menu.setOpen(!menu.open)}
      >
        <Icon name="globe" />
        <span>{locale.toUpperCase()}</span>
        <Icon name="chevron" size={14} />
      </button>
      {menu.open && (
        <div className="nav-popover" role="menu">
          {LOCALES.map((l) => (
            <button
              key={l.code}
              role="menuitemradio"
              aria-checked={l.code === locale}
              className="nav-popover-item"
              onClick={() => {
                setLocale(l.code as Locale)
                menu.setOpen(false)
              }}
            >
              <span className="nav-lang-code">{l.code.toUpperCase()}</span>
              <span className="nav-popover-grow">{l.name}</span>
              {l.code === locale && <Icon name="check" size={14} />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function AccountMenu({ email, isSuperAdmin, onSignOut }: { email: string; isSuperAdmin: boolean; onSignOut: () => void }) {
  const { t } = useT(common)
  const menu = useMenu()

  return (
    <div className="nav-menu" ref={menu.ref}>
      <button
        className="nav-avatar"
        aria-haspopup="menu"
        aria-expanded={menu.open}
        aria-label={t('accountMenu')}
        title={email}
        onClick={() => menu.setOpen(!menu.open)}
      >
        {email.charAt(0).toUpperCase() || '?'}
      </button>
      {menu.open && (
        <div className="nav-popover nav-account" role="menu">
          <div className="nav-account-head">
            <span className="muted small">{t('signedInAs')}</span>
            <strong title={email}>{email}</strong>
            {isSuperAdmin && <span className="badge nav-role" title={t('superAdminTitle')}>{t('superAdmin')}</span>}
          </div>
          {isSuperAdmin && (
            <Link to="/settings" role="menuitem" className="nav-popover-item">
              <Icon name="settings" />
              <span className="nav-popover-grow">{t('navSettings')}</span>
            </Link>
          )}
          <button role="menuitem" className="nav-popover-item" onClick={onSignOut}>
            <Icon name="logout" />
            <span className="nav-popover-grow">{t('signOut')}</span>
          </button>
        </div>
      )}
    </div>
  )
}

const SIDEBAR_KEY = 'leaseiq.sidebarCollapsed'

function initialCollapsed() {
  try {
    return localStorage.getItem(SIDEBAR_KEY) === '1'
  } catch {
    return false
  }
}

export function Navbar() {
  const { session, isSuperAdmin } = useAuth()
  const navigate = useNavigate()
  const { t } = useT(common)
  const { locale, setLocale } = useLocale()
  const mobile = useMenu()
  const [collapsed, setCollapsed] = useState(initialCollapsed)

  const toggleSidebar = () => {
    const next = !collapsed
    setCollapsed(next)
    try {
      localStorage.setItem(SIDEBAR_KEY, next ? '1' : '0')
    } catch {
      // Not remembered across visits; still applies now.
    }
  }

  // The page reserves room on the right for the sidebar (see body.has-sidebar in index.css).
  useEffect(() => {
    const classes = document.body.classList
    classes.toggle('has-sidebar', !!session)
    classes.toggle('sidebar-collapsed', collapsed)
    return () => classes.remove('has-sidebar', 'sidebar-collapsed')
  }, [session, collapsed])

  const signOut = async () => {
    await supabase.auth.signOut()
    navigate('/')
  }

  const links = session
    ? [
        { to: '/dashboard', icon: 'dashboard', label: t('navDashboard') },
        { to: '/leases', icon: 'leases', label: t('navLeases') },
        { to: '/chat', icon: 'chat', label: t('navChat') },
        { to: '/import', icon: 'import', label: t('navImport') },
        ...(isSuperAdmin ? [{ to: '/settings', icon: 'settings', label: t('navSettings') }] : []),
      ]
    : []
  const email = session?.user.email ?? ''

  const linkList = (withTooltips: boolean) =>
    links.map((l) => (
      <NavLink key={l.to} to={l.to} className="nav-link" title={withTooltips ? l.label : undefined}>
        <Icon name={l.icon} size={18} />
        <span className="sidebar-label">{l.label}</span>
      </NavLink>
    ))

  return (
    <>
      <header className="nav">
        <div className="nav-inner">
          <Link to={session ? '/dashboard' : '/'} className="brand">
            <img src="/logo.png" alt="LeaseIQ" />
          </Link>

          <div className="nav-right">
            <LanguageMenu />
            {session ? (
              <AccountMenu email={email} isSuperAdmin={isSuperAdmin} onSignOut={signOut} />
            ) : (
              <Link to="/login" className="btn nav-login">{t('logIn')}</Link>
            )}
            {session && (
              <button
                className="nav-icon-btn nav-burger"
                aria-expanded={mobile.open}
                aria-controls="nav-mobile"
                aria-label={t('openMenu')}
                onClick={() => mobile.setOpen(true)}
              >
                <Icon name="menu" size={20} />
              </button>
            )}
          </div>
        </div>
      </header>

      {session && (
        <aside className={`sidebar${collapsed ? ' is-collapsed' : ''}`}>
          <div className="sidebar-head">
            <span className="sidebar-title">{t('menu')}</span>
            <button
              className="nav-icon-btn sidebar-toggle"
              aria-expanded={!collapsed}
              aria-label={collapsed ? t('expandMenu') : t('collapseMenu')}
              title={collapsed ? t('expandMenu') : t('collapseMenu')}
              onClick={toggleSidebar}
            >
              <Icon name={collapsed ? 'chevronsLeft' : 'chevronsRight'} size={18} />
            </button>
          </div>
          <nav aria-label={t('mainNavigation')}>{linkList(collapsed)}</nav>
        </aside>
      )}

      {session && mobile.open && (
        <>
          <div className="nav-scrim" aria-hidden />
          <div className="nav-mobile" id="nav-mobile" ref={mobile.ref} role="dialog" aria-modal="true" aria-label={t('menu')}>
            <div className="nav-mobile-head">
              <span className="sidebar-title">{t('menu')}</span>
              <button className="nav-icon-btn" aria-label={t('closeMenu')} onClick={() => mobile.setOpen(false)}>
                <Icon name="close" size={20} />
              </button>
            </div>
            <nav aria-label={t('mainNavigation')}>{linkList(false)}</nav>
            <div className="nav-mobile-section">
              <span className="muted small">{t('language')}</span>
              <div className="nav-mobile-langs">
                {LOCALES.map((l) => (
                  <button
                    key={l.code}
                    className={`nav-chip${l.code === locale ? ' is-active' : ''}`}
                    aria-pressed={l.code === locale}
                    onClick={() => setLocale(l.code as Locale)}
                  >
                    {l.name}
                  </button>
                ))}
              </div>
            </div>
            <div className="nav-mobile-section nav-mobile-account">
              <div>
                <span className="muted small">{t('signedInAs')}</span>
                <strong>{email}</strong>
              </div>
              <button className="btn btn-ghost" onClick={signOut}>
                <Icon name="logout" />
                {t('signOut')}
              </button>
            </div>
          </div>
        </>
      )}
    </>
  )
}
