import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/AuthProvider'
import { supabase } from '../lib/supabase'

export function Navbar() {
  const { session, isSuperAdmin } = useAuth()
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
            <Link to="/chat">Lease Assistant</Link>
            <Link to="/import">Import</Link>
            {isSuperAdmin && (
              <>
                <Link to="/settings">Settings</Link>
                <span className="badge nav-role" title="You are signed in as a super admin">Super admin</span>
              </>
            )}
            <button className="btn btn-ghost" onClick={signOut}>Sign out</button>
          </>
        ) : (
          <Link to="/login" className="btn">Log in</Link>
        )}
      </div>
    </nav>
  )
}
