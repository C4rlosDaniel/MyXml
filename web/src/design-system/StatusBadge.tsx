import {
  Ban,
  CheckCircle2,
  Clock3,
  FileText,
  Send,
  ShieldOff,
  TimerOff,
  XCircle,
  type LucideIcon,
} from 'lucide-react'
import type { NoteStatus, LicenseStatus } from '@/types'
import { cn } from '@/lib/utils'

type Tone = 'success' | 'danger' | 'warning' | 'info' | 'neutral' | 'dark'

const toneStyles: Record<Tone, string> = {
  success: 'border-success-border bg-success-soft text-success-fg',
  danger: 'border-danger-border bg-danger-soft text-danger-fg',
  warning: 'border-warning-border bg-warning-soft text-warning-fg',
  info: 'border-info-border bg-info-soft text-info-fg',
  neutral: 'border-line bg-subtle text-txt-secondary',
  dark: 'border-line-strong bg-hover text-txt-primary',
}

type StatusConfig = { label: string; tone: Tone; icon: LucideIcon }

const noteLabels: Record<NoteStatus, StatusConfig> = {
  rascunho: { label: 'Rascunho', tone: 'neutral', icon: FileText },
  enviada: { label: 'Enviada', tone: 'info', icon: Send },
  autorizada: { label: 'Autorizada', tone: 'success', icon: CheckCircle2 },
  rejeitada: { label: 'Rejeitada', tone: 'danger', icon: XCircle },
  cancelada: { label: 'Cancelada', tone: 'dark', icon: Ban },
}

const licenseLabels: Record<LicenseStatus, StatusConfig> = {
  pendente: { label: 'Em processamento', tone: 'warning', icon: Clock3 },
  ativo: { label: 'Ativo', tone: 'success', icon: CheckCircle2 },
  bloqueado: { label: 'Bloqueado', tone: 'danger', icon: ShieldOff },
  expirado: { label: 'Expirado', tone: 'neutral', icon: TimerOff },
}

interface StatusBadgeProps {
  status: NoteStatus | LicenseStatus
  className?: string
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const config =
    status in noteLabels
      ? noteLabels[status as NoteStatus]
      : licenseLabels[status as LicenseStatus]
  const Icon = config.icon

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-sm border px-2 py-1 text-xs font-medium',
        toneStyles[config.tone],
        className,
      )}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {config.label}
    </span>
  )
}
