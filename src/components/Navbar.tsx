import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/AuthProvider'
import { supabase } from '../lib/supabase'

export function Navbar() {
  const { session } = useAuth()
  const navigate = useNavigate()

  const signOut = async () => {
    await supabase.auth.signOut()
    navigate('/')
  }

  return (
    <nav className="nav">
      <Link to="/" className="brand">⚡ LeaseIQ</Link>
      <div className="nav-links">
        {session ? (
          <>
            <Link to="/dashboard">Dashboard</Link>
            <Link to="/leases">Lease Abstraction</Link>
            <Link to="/settings">Settings</Link>
            <button className="btn btn-ghost" onClick={signOut}>Sign out</button>
          </>
        ) : (
          <Link to="/login" className="btn">Log in</Link>
        )}
      </div>
    </nav>
  )
}
