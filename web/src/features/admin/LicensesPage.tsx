import { CheckCircle2, KeyRound, ShieldOff, Users } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Button,
  Card,
  Modal,
  Table,
  Skeleton,
  StatusBadge,
  useToast,
  type Column,
} from '@/design-system'
import { cn } from '@/lib/utils'
import { formatDate } from '@/lib/masks'
import { licenseService } from '@/services/license.service'
import type { License, LicenseStatus } from '@/types'
import { useAuth } from '@/features/auth/AuthProvider'

type Action = 'approve' | 'block'

const DURATIONS = [
  { value: '30', label: '30 dias' },
  { value: '90', label: '90 dias' },
  { value: '180', label: '6 meses' },
  { value: '365', label: '1 ano' },
  { value: '0', label: 'Sem prazo definido' },
]

export function LicensesPage() {
  const { profile, refreshLicense } = useAuth()
  const { success, error: showError } = useToast()
  const [licenses, setLicenses] = useState<License[]>([])
  const [loading, setLoading] = useState(true)
  const [action, setAction] = useState<Action | null>(null)
  const [selected, setSelected] = useState<License | null>(null)
  const [duration, setDuration] = useState('30')
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setLicenses(await licenseService.listAll())
    } catch (err) {
      showError('Não foi possível carregar as licenças.', err instanceof Error ? err.message : undefined)
    } finally {
      setLoading(false)
    }
  }, [showError])

  useEffect(() => {
    void load()
  }, [load])

  const closeModal = () => {
    setAction(null)
    setSelected(null)
  }

  const confirm = async () => {
    if (!selected || !action) return
    setSaving(true)
    try {
      const days = Number(duration)
      const validUntil =
        days === 0 ? null : new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString()
      const status: LicenseStatus = action === 'approve' ? 'ativo' : 'bloqueado'

      await licenseService.update(selected.id, {
        status,
        validUntil: action === 'approve' ? validUntil : selected.validUntil,
        activatedBy: action === 'approve' ? (profile?.id ?? null) : selected.activatedBy,
      })

      success(
        action === 'approve' ? 'Acesso autorizado!' : 'Acesso bloqueado.',
        `${selected.userName} foi ${action === 'approve' ? 'liberado' : 'bloqueado'} no sistema.`,
      )
      if (selected.userId === profile?.id) await refreshLicense()
      await load()
      closeModal()
    } catch (err) {
      showError('Não foi possível salvar.', err instanceof Error ? err.message : undefined)
    } finally {
      setSaving(false)
    }
  }

  const columns = useMemo<Column<License>[]>(
    () => [
      {
        key: 'user',
        header: 'Usuário',
        render: (row) => (
          <div className="min-w-0">
            <p className="truncate font-semibold text-txt-primary">{row.userName}</p>
            <p className="truncate text-xs text-txt-muted">{row.userEmail}</p>
          </div>
        ),
      },
      {
        key: 'status',
        header: 'Situação',
        render: (row) => <StatusBadge status={row.status} />,
      },
      {
        key: 'validade',
        header: 'Validade',
        render: (row) =>
          row.validUntil ? formatDate(row.validUntil) : <span className="text-txt-muted">Indefinida</span>,
      },
      {
        key: 'actions',
        header: 'Ações',
        render: (row) => {
          const isSelf = row.userId === profile?.id
          return (
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="success"
                disabled={isSelf}
                title={isSelf ? 'Você não pode alterar sua própria licença' : undefined}
                onClick={() => {
                  setSelected(row)
                  setAction('approve')
                  setDuration('30')
                }}
              >
                <CheckCircle2 className="h-3.5 w-3.5" />Autorizar
              </Button>
              <Button
                size="sm"
                variant="danger"
                disabled={isSelf || row.status === 'bloqueado'}
                onClick={() => {
                  setSelected(row)
                  setAction('block')
                }}
              >
                <ShieldOff className="h-3.5 w-3.5" />Bloquear
              </Button>
            </div>
          )
        },
      },
    ],
    [profile?.id],
  )

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-txt-primary sm:text-3xl">
            Licenças de acesso
          </h1>
          <p className="mt-1.5 text-sm text-txt-secondary">
            Autorize usuários, defina o tempo de uso e bloqueie acessos quando necessário.
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={load}>
          Atualizar lista
        </Button>
      </div>

      <Card className="p-5 sm:p-6">
        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, index) => (
              <Skeleton key={index} className="h-16 w-full" />
            ))}
          </div>
        ) : (
          <Table
            columns={columns}
            data={licenses}
            rowKey={(row) => row.id}
            empty={
              <div className="flex flex-col items-center gap-3 rounded-sm surface p-10 text-center">
                <Users className="h-8 w-8 text-txt-muted" />
                <p className="text-sm font-semibold text-txt-primary">Nenhuma licença encontrada</p>
                <p className="text-xs text-txt-muted">
                  Novos usuários aparecem aqui automaticamente após o cadastro.
                </p>
              </div>
            }
          />
        )}
      </Card>

      <Modal
        open={action !== null}
        onOpenChange={(open) => !open && closeModal()}
        title={action === 'approve' ? 'Autorizar acesso' : 'Bloquear acesso'}
        description={
          action === 'approve'
            ? `Defina por quanto tempo ${selected?.userName ?? 'o usuário'} poderá usar o sistema.`
            : `O acesso de ${selected?.userName ?? 'o usuário'} será suspenso imediatamente.`
        }
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={closeModal}>
              Cancelar
            </Button>
            <Button
              variant={action === 'approve' ? 'primary' : 'danger'}
              loading={saving}
              loadingText="Salvando..."
              onClick={confirm}
            >
              {action === 'approve' ? 'Confirmar autorização' : 'Confirmar bloqueio'}
            </Button>
          </>
        }
      >
        {action === 'approve' ? (
          <fieldset>
            <legend className="mb-3 text-sm font-semibold text-txt-primary">Período de uso</legend>
            <div className="grid grid-cols-2 gap-2">
              {DURATIONS.map((option) => (
                <label
                  key={option.value}
                  className={cn(
                    'flex cursor-pointer items-center gap-2 rounded-sm border px-3 py-2.5 text-sm transition-all',
                    duration === option.value
                      ? 'border-accent-border bg-accent-soft text-accent-fg'
                      : 'border-line bg-subtle text-txt-secondary hover:border-line-strong',
                  )}
                >
                  <input
                    type="radio"
                    name="duration"
                    value={option.value}
                    checked={duration === option.value}
                    onChange={() => setDuration(option.value)}
                    className="sr-only"
                  />
                  <KeyRound className="h-4 w-4" />
                  {option.label}
                </label>
              ))}
            </div>
          </fieldset>
        ) : (
          <div className="rounded-sm border border-danger-border bg-danger-soft p-4 text-sm text-txt-secondary">
            O usuário não conseguirá entrar até que um administrador autorize o acesso novamente.
          </div>
        )}
      </Modal>
    </div>
  )
}
