import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/AuthProvider'
import { supabase } from '../lib/supabase'
import { LOCALES, useLocale, useT, type Locale } from '../i18n'
import { common } from '../i18n/messages/common'

export function Navbar() {
  const { session, isSuperAdmin } = useAuth()
  const navigate = useNavigate()
  const { t } = useT(common)
  const { locale, setLocale } = useLocale()

  const signOut = async () => {
    await supabase.auth.signOut()
    navigate('/')
  }

  return (
    <nav className="nav">
      <Link to="/" className="brand"><img src="/logo.png" alt="LeaseIQ" /></Link>
      <div className="nav-links">
        {session ? (
          <>
            <Link to="/dashboard">{t('navDashboard')}</Link>
            <Link to="/leases">{t('navLeases')}</Link>
            <Link to="/chat">{t('navChat')}</Link>
            <Link to="/import">{t('navImport')}</Link>
            {isSuperAdmin && (
              <>
                <Link to="/settings">{t('navSettings')}</Link>
                <span className="badge nav-role" title={t('superAdminTitle')}>{t('superAdmin')}</span>
              </>
            )}
          </>
        ) : null}
        <select
          className="nav-lang"
          aria-label={t('language')}
          value={locale}
          onChange={(e) => setLocale(e.target.value as Locale)}
        >
          {LOCALES.map((l) => (
            <option key={l.code} value={l.code}>{l.name}</option>
          ))}
        </select>
        {session ? (
          <button className="btn btn-ghost" onClick={signOut}>{t('signOut')}</button>
        ) : (
          <Link to="/login" className="btn">{t('logIn')}</Link>
        )}
      </div>
    </nav>
  )
}
