import { Link } from 'react-router-dom'
import { useAuth } from '../lib/AuthProvider'
import { useT } from '../i18n'
import { landing } from '../i18n/messages/landing'

export function Landing() {
  const { session } = useAuth()
  const { t } = useT(landing)

  return (
    <main>
      <section className="hero">
        <h1>{t('heroTitle')}</h1>
        <p>{t('heroText')}</p>
        <Link to={session ? '/dashboard' : '/login'} className="btn btn-lg">
          {session ? t('goToDashboard') : t('getStarted')}
        </Link>
      </section>

      <section className="features">
        <div className="card">
          <h3>🔐 {t('authTitle')}</h3>
          <p>{t('authText')}</p>
        </div>
        <div className="card">
          <h3>🛡️ {t('protectedTitle')}</h3>
          <p>{t('protectedText')}</p>
        </div>
        <div className="card">
          <h3>⚡ {t('viteTitle')}</h3>
          <p>{t('viteText')}</p>
        </div>
      </section>
    </main>
  )
}
