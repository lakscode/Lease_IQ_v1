import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../lib/AuthProvider'
import { useT } from '../i18n'
import { common } from '../i18n/messages/common'

/** Requires a signed-in user; with superAdmin, also the super admin role. */
export function ProtectedRoute({ children, superAdmin }: { children: ReactNode; superAdmin?: boolean }) {
  const { session, loading, isSuperAdmin } = useAuth()
  const { t } = useT(common)
  if (loading) return <div className="center">{t('loading')}</div>
  if (!session) return <Navigate to="/login" replace />
  if (superAdmin && !isSuperAdmin) return <Navigate to="/dashboard" replace />
  return <>{children}</>
}
