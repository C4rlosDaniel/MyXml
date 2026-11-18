import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type { License, Profile } from '@/types'
import { authService } from '@/services/auth.service'
import { isMockMode } from '@/services/config'
import { licenseService } from '@/services/license.service'

interface AuthContextValue {
  profile: Profile | null
  license: License | null
  loading: boolean
  isAuthorized: boolean
  mockMode: boolean
  signIn: (email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
  refreshLicense: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [license, setLicense] = useState<License | null>(null)
  const [loading, setLoading] = useState(true)

  const loadSession = useCallback(async () => {
    const current = await authService.getCurrentProfile()
    setProfile(current)
    setLicense(current ? await licenseService.getMyLicense(current.id) : null)
  }, [])

  useEffect(() => {
    loadSession().finally(() => setLoading(false))
  }, [loadSession])

  const signIn = useCallback(
    async (email: string, password: string) => {
      const logged = await authService.signIn(email, password)
      setProfile(logged)
      setLicense(await licenseService.getMyLicense(logged.id))
    },
    [],
  )

  const signOut = useCallback(async () => {
    await authService.signOut()
    setProfile(null)
    setLicense(null)
  }, [])

  const refreshLicense = useCallback(async () => {
    if (profile) setLicense(await licenseService.getMyLicense(profile.id))
  }, [profile])

  const isAuthorized = useMemo(() => {
    if (!profile) return false
    // Admin sempre acessa o painel; contador depende de licença ativa e vigente.
    if (profile.role === 'admin') return true
    if (license?.status !== 'ativo') return false
    return !license.validUntil || new Date(license.validUntil) > new Date()
  }, [profile, license])

  const value = useMemo<AuthContextValue>(
    () => ({
      profile,
      license,
      loading,
      isAuthorized,
      mockMode: isMockMode,
      signIn,
      signOut,
      refreshLicense,
    }),
    [profile, license, loading, isAuthorized, signIn, signOut, refreshLicense],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth deve ser usado dentro de AuthProvider')
  return context
}
