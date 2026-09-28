import { useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthProvider'
import { useT } from '../i18n'
import { auth } from '../i18n/messages/auth'
import { common } from '../i18n/messages/common'

export function Login() {
  const { session } = useAuth()
  const { t } = useT(auth)
  const { t: tc } = useT(common)
  const navigate = useNavigate()
  const [mode, setMode] = useState<'login' | 'signup'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  if (session) return <Navigate to="/dashboard" replace />

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
      const { data, error } = await supabase.auth.signUp({ email, password })
      if (error) setError(error.message)
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
