import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'

export type UserRole = 'superadmin' | 'user'

type AuthState = { session: Session | null; loading: boolean; role: UserRole | null; isSuperAdmin: boolean }

const AuthContext = createContext<AuthState>({ session: null, loading: true, role: null, isSuperAdmin: false })

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [sessionLoading, setSessionLoading] = useState(true)
  // The signed-in user's row in public.users, once loaded.
  const [account, setAccount] = useState<{ userId: string; role: UserRole } | null>(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setSessionLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  const userId = session?.user.id ?? null
  useEffect(() => {
    if (!userId) return
    let cancelled = false
    supabase
      .from('users')
      .select('role')
      .eq('id', userId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (error) console.warn('[auth] loading user role failed:', error.message)
        if (!cancelled) setAccount({ userId, role: (data?.role as UserRole | undefined) ?? 'user' })
      })
    return () => {
      cancelled = true
    }
  }, [userId])

  const role = userId && account?.userId === userId ? account.role : null
  const roleLoading = !!userId && !role

  return (
    <AuthContext.Provider
      value={{ session, loading: sessionLoading || roleLoading, role, isSuperAdmin: role === 'superadmin' }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
