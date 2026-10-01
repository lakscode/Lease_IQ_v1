import { useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthProvider'
import { useT } from '../i18n'
import { auth } from '../i18n/messages/auth'
import { common } from '../i18n/messages/common'

/** Error returned by the identity provider in the redirect (query or hash), with the URL cleaned up. */
function readOAuthError(): string | null {
  const params = new URLSearchParams(window.location.search)
  const hash = new URLSearchParams(window.location.hash.slice(1))
  const text = params.get('error_description') ?? hash.get('error_description') ?? params.get('error') ?? hash.get('error')
  if (text) window.history.replaceState(null, '', window.location.pathname)
  return text ? text.replace(/\+/g, ' ') : null
}

function MicrosoftLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 21 21" aria-hidden>
      <rect x="1" y="1" width="9" height="9" fill="#f25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
      <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
      <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
    </svg>
  )
}

export function Login() {
  const [oauthError] = useState(readOAuthError)
  const { session } = useAuth()
  const { t } = useT(auth)
  const { t: tc } = useT(common)
  const navigate = useNavigate()
  const [mode, setMode] = useState<'login' | 'signup'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  // A failed Microsoft sign-in comes back to this page with the reason in the URL.
  const [error, setError] = useState<string | null>(oauthError)
  const [message, setMessage] = useState<string | null>(null)

  if (session) return <Navigate to="/dashboard" replace />

  const signInWithMicrosoft = async () => {
    setLoading(true)
    setError(null)
    setMessage(null)
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'azure',
      // `email` is needed for Supabase to create the account; the browser leaves for Microsoft on success.
      options: { scopes: 'openid profile email', redirectTo: `${window.location.origin}/login` },
    })
    if (error) {
      setError(error.message)
      setLoading(false)
    }
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setMessage(null)

    if (mode === 'login') {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) setError(error.message)
      else navigate('/dashboard')
    } else {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        // Back to this site after confirming; otherwise the dashboard's Site URL is used.
        options: { emailRedirectTo: `${window.location.origin}/login` },
      })
      if (error) setError(error.code === 'user_already_exists' ? t('emailExists') : error.message)
      // With email confirmation on, Supabase answers an existing address with a user that has no identities.
      else if (data.user && data.user.identities?.length === 0) setError(t('emailExists'))
      else if (!data.session) setMessage(t('confirmEmail'))
      else navigate('/dashboard')
    }
    setLoading(false)
  }

  const toggleMode = () => {
    setMode(mode === 'login' ? 'signup' : 'login')
    setError(null)
    setMessage(null)
  }

  return (
    <main className="center">
      <form className="card auth-card" onSubmit={handleSubmit}>
        <h2>{mode === 'login' ? t('welcomeBack') : t('createAccount')}</h2>

        <button className="btn btn-ghost btn-microsoft" type="button" onClick={signInWithMicrosoft} disabled={loading}>
          <MicrosoftLogo />
          {t('continueWithMicrosoft')}
        </button>
        <div className="auth-divider"><span>{t('or')}</span></div>

        <label>
          {t('email')}
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label>
          {t('password')}
          <input
            type="password"
            required
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>

        {mode === 'login' && (
          <Link to="/forgot-password" className="link forgot-link">{t('forgotPassword')}</Link>
        )}

        {error && <p className="error">{error}</p>}
        {message && <p className="success">{message}</p>}

        <button className="btn" type="submit" disabled={loading}>
          {loading ? tc('pleaseWait') : mode === 'login' ? tc('logIn') : t('signUp')}
        </button>

        <p className="muted">
          {mode === 'login' ? t('noAccount') : t('haveAccount')}{' '}
          <button type="button" className="link" onClick={toggleMode}>
            {mode === 'login' ? t('signUp') : tc('logIn')}
          </button>
        </p>
      </form>
    </main>
  )
}
