import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useT } from '../i18n'
import { auth } from '../i18n/messages/auth'

export function ForgotPassword() {
  const { t } = useT(auth)
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    })
    if (error) setError(error.message)
    else setSent(true)
    setLoading(false)
  }

  return (
    <main className="center">
      <form className="card auth-card" onSubmit={handleSubmit}>
        <h2>{t('resetTitle')}</h2>

        {sent ? (
          <p className="success">
            {t('resetSent', { email })}
          </p>
        ) : (
          <>
            <p className="muted">{t('resetIntro')}</p>
            <label>
              {t('email')}
              <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>

            {error && <p className="error">{error}</p>}

            <button className="btn" type="submit" disabled={loading}>
              {loading ? t('sending') : t('sendResetLink')}
            </button>
          </>
        )}

        <p className="muted">
          <Link to="/login" className="link">{t('backToLogin')}</Link>
        </p>
      </form>
    </main>
  )
}
