import { Loader2 } from 'lucide-react'
import { useEffect } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { Logo } from '@/components/Logo'
import { useToast } from '@/design-system'
import { LicensesPage } from '@/features/admin/LicensesPage'
import { useAuth } from '@/features/auth/AuthProvider'
import { LicensePendingPage } from '@/features/auth/LicensePendingPage'
import { LoginPage } from '@/features/auth/LoginPage'
import { CompaniesPage } from '@/features/cadastros/CompaniesPage'
import { DashboardPage } from '@/features/dashboard/DashboardPage'
import { DownloadGuardProvider } from '@/features/download/DownloadGuard'
import { DownloadPage } from '@/features/download/DownloadPage'
import { CompanyProvider } from '@/features/empresas/CompanyProvider'
import { HistoryPage } from '@/features/historico/HistoryPage'
import { AppShell } from '@/features/layout/AppShell'
import { NfsePage } from '@/features/nfse/NfsePage'
import { NoteDetailPage } from '@/features/notas/NoteDetailPage'
import { NotesPage } from '@/features/notas/NotesPage'
import { SettingsPage } from '@/features/configuracoes/SettingsPage'

function Splash() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-5">
      <Logo className="h-20" />
      <Loader2 className="h-5 w-5 animate-spin text-primary-fg" aria-label="Carregando" />
    </div>
  )
}

export default function App() {
  const { profile, loading, isAuthorized } = useAuth()
  const { clear: clearToasts } = useToast()

  // Toda entrada no sistema começa clara; ao sair, limpa avisos da sessão.
  useEffect(() => {
    if (!profile) {
      document.documentElement.dataset.theme = 'light'
      localStorage.setItem('myxml-theme', 'light')
      localStorage.setItem('myxml-theme-v2', '1')
      clearToasts()
    }
  }, [profile, clearToasts])

  if (loading) return <Splash />
  if (!profile) return <LoginPage />
  if (!isAuthorized) return <LicensePendingPage />

  return (
    <DownloadGuardProvider>
      <CompanyProvider>
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={<DashboardPage />} />
            <Route path="notas" element={<NotesPage />} />
            <Route path="notas/:id" element={<NoteDetailPage />} />
            <Route path="baixar" element={<DownloadPage />} />
            <Route path="empresas" element={<CompaniesPage />} />
            <Route path="historico" element={<HistoryPage />} />
            <Route path="nfse" element={<NfsePage />} />
            <Route path="configuracoes" element={<SettingsPage />} />
            <Route
              path="admin/licencas"
              element={profile.role === 'admin' ? <LicensesPage /> : <Navigate to="/" replace />}
            />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </CompanyProvider>
    </DownloadGuardProvider>
  )
}
