import { CheckCircle2, Eye, EyeOff, KeyRound, Plus, ShieldOff, Trash2, Users } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Button,
  Card,
  Input,
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
type SensitiveAction = 'password' | 'delete'

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
  const [createOpen, setCreateOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [sensitive, setSensitive] = useState<SensitiveAction | null>(null)
  const [adminPassword, setAdminPassword] = useState('')
  const [showAdminPassword, setShowAdminPassword] = useState(false)
  const [revealedPassword, setRevealedPassword] = useState<string | null>(null)
  const [showRevealed, setShowRevealed] = useState(false)
  const [sensitiveBusy, setSensitiveBusy] = useState(false)
  const [newUser, setNewUser] = useState({
    fullName: '',
    email: '',
    password: '',
    days: '30',
    role: 'contador' as 'admin' | 'contador',
  })

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setLicenses(await licenseService.listAll())
    } catch (err) {
      showError('Não foi possível carregar as licenças.')
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

  const createUser = async () => {
    if (newUser.fullName.trim().length < 2) {
      showError('Nome obrigatório', 'Informe o nome do usuário.')
      return
    }
    if (!newUser.email.includes('@') || !newUser.email.split('@')[1]?.includes('.')) {
      showError('E-mail inválido', 'Confira o e-mail informado.')
      return
    }
    if (newUser.password.length < 6) {
      showError('Senha fraca', 'A senha deve ter pelo menos 6 caracteres.')
      return
    }

    setCreating(true)
    try {
      const license = await licenseService.createUser({
        fullName: newUser.fullName.trim(),
        email: newUser.email.trim(),
        password: newUser.password,
        days: Number(newUser.days),
        role: newUser.role,
      })
      success('Licença gerada!', `${license.userEmail} já pode acessar o sistema.`)
      setCreateOpen(false)
      setNewUser({ fullName: '', email: '', password: '', days: '30', role: 'contador' })
      await load()
    } catch (err) {
      showError('Não foi possível gerar a licença', err instanceof Error ? err.message : undefined)
    } finally {
      setCreating(false)
    }
  }

  const closeSensitive = () => {
    setSensitive(null)
    setAdminPassword('')
    setShowAdminPassword(false)
    setRevealedPassword(null)
    setShowRevealed(false)
  }

  const openSensitive = (row: License, kind: SensitiveAction) => {
    setSelected(row)
    setSensitive(kind)
    setAdminPassword('')
    setShowAdminPassword(false)
    setRevealedPassword(null)
    setShowRevealed(false)
  }

  const handleSensitive = async () => {
    if (!selected || !sensitive) return
    if (!adminPassword) {
      showError('Informe a senha do administrador.')
      return
    }
    setSensitiveBusy(true)
    try {
      if (sensitive === 'password') {
        const senha = await licenseService.getUserPassword(
          selected.id,
          adminPassword,
          profile?.id,
        )
        setRevealedPassword(senha)
        setShowRevealed(true)
      } else {
        await licenseService.deleteUser(selected.id, adminPassword, profile?.id)
        success('Usuário removido!', `${selected.userName} foi apagado do sistema.`)
        closeSensitive()
        await load()
      }
    } catch (err) {
      showError('Não foi possível concluir.', err instanceof Error ? err.message : undefined)
    } finally {
      setSensitiveBusy(false)
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
              <Button
                size="sm"
                variant="secondary"
                disabled={isSelf}
                title={isSelf ? 'Você não pode visualizar sua própria senha por aqui' : 'Visualizar senha do usuário'}
                onClick={() => openSensitive(row, 'password')}
              >
                <Eye className="h-3.5 w-3.5" />Ver senha
              </Button>
              <Button
                size="sm"
                variant="danger"
                disabled={isSelf}
                title={isSelf ? 'Você não pode apagar o próprio usuário' : 'Apagar usuário do sistema'}
                onClick={() => openSensitive(row, 'delete')}
              >
                <Trash2 className="h-3.5 w-3.5" />Apagar
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
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={load}>
            Atualizar lista
          </Button>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" /> Gerar licença
          </Button>
        </div>
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

      <Modal
        open={createOpen}
        onOpenChange={setCreateOpen}
        title="Gerar licença de acesso"
        description="O usuário será criado no Supabase Auth e liberado imediatamente pelo prazo escolhido."
        footer={
          <>
            <Button variant="secondary" onClick={() => setCreateOpen(false)}>
              Cancelar
            </Button>
            <Button loading={creating} loadingText="Criando..." onClick={createUser}>
              Gerar licença
            </Button>
          </>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Nome completo"
            containerClassName="sm:col-span-2"
            value={newUser.fullName}
            onChange={(event) => setNewUser({ ...newUser, fullName: event.target.value })}
          />
          <Input
            label="E-mail"
            type="email"
            containerClassName="sm:col-span-2"
            value={newUser.email}
            onChange={(event) => setNewUser({ ...newUser, email: event.target.value })}
          />
          <Input
            label="Senha"
            type="password"
            value={newUser.password}
            onChange={(event) => setNewUser({ ...newUser, password: event.target.value })}
          />
          <div>
            <label className="mb-1.5 block text-xs font-medium text-txt-secondary" htmlFor="novo-perfil">
              Perfil
            </label>
            <select
              id="novo-perfil"
              className="field h-10 w-full px-3 text-sm focus:border-accent focus:ring-2 focus:ring-accent focus:outline-none"
              value={newUser.role}
              onChange={(event) =>
                setNewUser({ ...newUser, role: event.target.value as 'admin' | 'contador' })
              }
            >
              <option value="contador">Contador</option>
              <option value="admin">Administrador</option>
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className="mb-1.5 block text-xs font-medium text-txt-secondary" htmlFor="novo-prazo">
              Tempo de uso
            </label>
            <select
              id="novo-prazo"
              className="field h-10 w-full px-3 text-sm focus:border-accent focus:ring-2 focus:ring-accent focus:outline-none"
              value={newUser.days}
              onChange={(event) => setNewUser({ ...newUser, days: event.target.value })}
            >
              <option value="30">30 dias</option>
              <option value="90">90 dias</option>
              <option value="180">6 meses</option>
              <option value="365">1 ano</option>
            </select>
          </div>
        </div>
      </Modal>

      <Modal
        open={sensitive !== null}
        onOpenChange={(open) => !open && closeSensitive()}
        title={sensitive === 'password' ? 'Visualizar senha do usuário' : 'Apagar usuário do sistema'}
        description={
          sensitive === 'password'
            ? `Confirme sua senha de administrador para ver a senha de ${selected?.userName ?? 'o usuário'}.`
            : `Confirme sua senha de administrador para apagar ${selected?.userName ?? 'o usuário'} do sistema.`
        }
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={closeSensitive}>
              {revealedPassword !== null ? 'Fechar' : 'Cancelar'}
            </Button>
            {revealedPassword === null && (
              <Button
                variant={sensitive === 'delete' ? 'danger' : 'primary'}
                loading={sensitiveBusy}
                loadingText="Confirmando..."
                onClick={handleSensitive}
              >
                {sensitive === 'delete' ? 'Apagar usuário' : 'Mostrar senha'}
              </Button>
            )}
          </>
        }
      >
        {revealedPassword === null ? (
          <div className="space-y-4">
            <Input
              label="Senha do administrador"
              type={showAdminPassword ? 'text' : 'password'}
              value={adminPassword}
              onChange={(event) => setAdminPassword(event.target.value)}
            />
            <button
              type="button"
              className="inline-flex items-center gap-1.5 text-xs font-medium text-primary-fg hover:underline"
              onClick={() => setShowAdminPassword((current) => !current)}
            >
              {showAdminPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              {showAdminPassword ? 'Ocultar senha do administrador' : 'Mostrar senha do administrador'}
            </button>
            {sensitive === 'delete' && (
              <div className="rounded-sm border border-danger-border bg-danger-soft p-3 text-sm text-danger-fg">
                Esta ação remove o usuário, a licença e o acesso ao sistema. Não pode ser desfeita.
              </div>
            )}
          </div>
        ) : (
          <div className="rounded-sm border border-line bg-subtle p-4">
            <p className="text-xs font-medium text-txt-secondary">Senha de {selected?.userName}</p>
            <div className="mt-2 flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-sm border border-line bg-surface px-3 py-2 text-sm text-txt-primary">
                {showRevealed ? revealedPassword : '••••••••••'}
              </code>
              <Button
                variant="ghost"
                size="icon"
                aria-label={showRevealed ? 'Ocultar senha' : 'Mostrar senha'}
                onClick={() => setShowRevealed((current) => !current)}
              >
                {showRevealed ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
            </div>
            <p className="mt-3 text-[11px] text-txt-muted">
              A senha fica registrada de forma criptografada no servidor e só é exibida a administradores.
            </p>
          </div>
        )}
      </Modal>
    </div>
  )
}
