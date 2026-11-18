import { Clock3, LogOut, RefreshCw, ShieldAlert, TimerOff } from 'lucide-react'
import { Logo } from '@/components/Logo'
import { Button, Card, Modal, useToast } from '@/design-system'
import type { LicenseStatus } from '@/types'
import { useAuth } from './AuthProvider'

const content: Record<
  Exclude<LicenseStatus, 'ativo'>,
  { title: string; description: string; icon: typeof Clock3 }
> = {
  pendente: {
    title: 'Aguardando liberação',
    description:
      'Seu cadastro foi recebido. O administrador precisa autorizar seu acesso e definir o período de uso antes que você possa baixar notas.',
    icon: Clock3,
  },
  bloqueado: {
    title: 'Acesso bloqueado',
    description:
      'Seu acesso foi suspenso pelo administrador. Entre em contato com o suporte para saber como regularizar a situação.',
    icon: ShieldAlert,
  },
  expirado: {
    title: 'Período de uso encerrado',
    description:
      'Sua licença venceu. Solicite ao administrador uma renovação para voltar a utilizar o sistema.',
    icon: TimerOff,
  },
}

export function LicensePendingPage() {
  const { profile, license, refreshLicense, signOut } = useAuth()
  const { success, error: showError } = useToast()
  const status = (license?.status ?? 'pendente') as Exclude<LicenseStatus, 'ativo'>
  const config = content[status]
  const Icon = config.icon

  const handleRefresh = async () => {
    await refreshLicense()
    success('Status atualizado.')
  }

  const handleSignOut = async () => {
    await signOut()
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-12">
      <Card variant="raised" className="w-full max-w-lg p-8 text-center sm:p-10">
        <Logo className="mx-auto mb-7 h-16" />

        <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full border border-warning-border bg-warning-soft text-warning-fg">
          <Icon className="h-7 w-7" aria-hidden="true" />
        </div>

        <h1 className="text-2xl font-extrabold text-txt-primary">{config.title}</h1>
        <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-txt-secondary">
          {config.description}
        </p>

        <div className="mt-6 rounded-sm surface p-4 text-left text-sm">
          <p className="text-xs uppercase tracking-wider text-txt-muted">Conta</p>
          <p className="mt-1 font-semibold text-txt-primary">{profile?.email}</p>
          {license?.validUntil && (
            <p className="mt-3 text-xs text-txt-muted">
              Validade anterior: {new Date(license.validUntil).toLocaleDateString('pt-BR')}
            </p>
          )}
        </div>

        <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:justify-center">
          <Button onClick={handleRefresh}>
            <RefreshCw className="h-4 w-4" /> Atualizar status
          </Button>
          <Button variant="secondary" onClick={handleSignOut}>
            <LogOut className="h-4 w-4" /> Sair
          </Button>
        </div>
      </Card>
    </div>
  )
}
