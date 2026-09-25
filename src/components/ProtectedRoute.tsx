import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../lib/AuthProvider'

/** Requires a signed-in user; with superAdmin, also the super admin role. */
export function ProtectedRoute({ children, superAdmin }: { children: ReactNode; superAdmin?: boolean }) {
  const { session, loading, isSuperAdmin } = useAuth()
  if (loading) return <div className="center">Loading…</div>
  if (!session) return <Navigate to="/login" replace />
  if (superAdmin && !isSuperAdmin) return <Navigate to="/dashboard" replace />
  return <>{children}</>
}
