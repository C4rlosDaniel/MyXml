import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { cadastrosService, type CompanyRecord } from '@/services/cadastros.service'

const STORAGE_KEY = 'myxml-company'

interface CompanyContextValue {
  companies: CompanyRecord[]
  selectedCompanyId: string | null
  selectedCompany: CompanyRecord | null
  loading: boolean
  selectCompany: (id: string) => void
  refreshCompanies: () => Promise<void>
}

const CompanyContext = createContext<CompanyContextValue | null>(null)

export function CompanyProvider({ children }: { children: ReactNode }) {
  const [companies, setCompanies] = useState<CompanyRecord[]>([])
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(() =>
    localStorage.getItem(STORAGE_KEY),
  )
  const [loading, setLoading] = useState(true)

  const refreshCompanies = useCallback(async () => {
    setLoading(true)
    const data = await cadastrosService.listCompanies()
    setCompanies(data)
    setSelectedCompanyId((current) => {
      if (current && data.some((item) => item.id === current)) return current
      const first = data[0]?.id ?? null
      if (first) localStorage.setItem(STORAGE_KEY, first)
      else localStorage.removeItem(STORAGE_KEY)
      return first
    })
    setLoading(false)
  }, [])

  useEffect(() => {
    void refreshCompanies()
  }, [refreshCompanies])

  const selectCompany = useCallback((id: string) => {
    setSelectedCompanyId(id)
    localStorage.setItem(STORAGE_KEY, id)
  }, [])

  const selectedCompany = useMemo(
    () => companies.find((item) => item.id === selectedCompanyId) ?? null,
    [companies, selectedCompanyId],
  )

  const value = useMemo<CompanyContextValue>(
    () => ({ companies, selectedCompanyId, selectedCompany, loading, selectCompany, refreshCompanies }),
    [companies, selectedCompanyId, selectedCompany, loading, selectCompany, refreshCompanies],
  )

  return <CompanyContext.Provider value={value}>{children}</CompanyContext.Provider>
}

export function useCompany() {
  const context = useContext(CompanyContext)
  if (!context) throw new Error('useCompany deve ser usado dentro de CompanyProvider')
  return context
}
