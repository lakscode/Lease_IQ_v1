import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../lib/AuthProvider'

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth()
  if (loading) return <div className="center">Loading…</div>
  if (!session) return <Navigate to="/login" replace />
  return <>{children}</>
}
