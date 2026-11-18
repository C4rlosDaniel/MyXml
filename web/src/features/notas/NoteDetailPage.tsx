import {
  ArrowLeft,
  Ban,
  CheckCircle2,
  Copy,
  Download,
  FilePenLine,
  FileText,
  Hash,
  Mail,
  RefreshCw,
  Send,
  XCircle,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Button, Card, StatusBadge, useToast } from '@/design-system'
import { FiscalActionModals, type FiscalAction } from '@/features/fiscal/FiscalActionModals'
import { formatChaveNfe, formatCurrency, formatDate } from '@/lib/masks'
import { notesService } from '@/services/notes.service'
import type { Note } from '@/types'

interface TimelineStep {
  label: string
  time: string
  icon: LucideIcon
  state: 'done' | 'current' | 'rejected' | 'pending'
}

function buildTimeline(note: Note): TimelineStep[] {
  const base: TimelineStep[] = [
    { label: 'Rascunho', time: formatDate(note.emitidaEm, true), icon: FileText, state: 'done' },
    { label: 'Enviada', time: formatDate(note.emitidaEm, true), icon: Send, state: 'done' },
  ]

  if (note.situacao === 'autorizada') {
    base.push({ label: 'Autorizada', time: formatDate(note.emitidaEm, true), icon: CheckCircle2, state: 'done' })
  } else if (note.situacao === 'rejeitada') {
    base.push({ label: 'Rejeitada', time: formatDate(note.emitidaEm, true), icon: XCircle, state: 'rejected' })
  } else if (note.situacao === 'cancelada') {
    base.push({ label: 'Cancelada', time: '—', icon: Ban, state: 'rejected' })
  } else {
    base.push({ label: 'Aguardando retorno', time: '—', icon: RefreshCw, state: 'current' })
  }
  return base
}

export function NoteDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { info, success } = useToast()
  const [note, setNote] = useState<Note | null>(null)
  const [loading, setLoading] = useState(true)
  const [fiscalAction, setFiscalAction] = useState<FiscalAction | null>(null)

  useEffect(() => {
    if (!id) return
    notesService.getById(id).then((data) => {
      setNote(data)
      setLoading(false)
    })
  }, [id])

  if (loading) {
    return <div className="h-64 animate-pulse rounded-md border border-line bg-subtle" aria-label="Carregando" />
  }

  if (!note) {
    return (
      <Card className="p-10 text-center">
        <p className="text-sm font-medium text-txt-primary">Nota não encontrada.</p>
        <Button variant="secondary" size="sm" className="mt-4" onClick={() => navigate('/notas')}>Voltar</Button>
      </Card>
    )
  }

  const copyKey = async () => {
    try {
      await navigator.clipboard.writeText(note.chave)
      success('Chave copiada!')
    } catch {
      info('Copie a chave manualmente.', note.chave)
    }
  }

  return (
    <div>
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <button
            type="button"
            onClick={() => navigate('/notas')}
            className="mb-3 inline-flex items-center gap-1.5 text-xs font-medium text-txt-muted hover:text-primary-fg"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Notas fiscais
          </button>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight text-txt-primary">Nota nº {note.numero}</h1>
            <StatusBadge status={note.situacao} />
          </div>
          <p className="mt-1 text-sm text-txt-secondary">
            Série {note.serie} • Emitida em {formatDate(note.emitidaEm, true)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => info('Download disponível na Etapa 4.')}>
            <Download className="h-4 w-4" /> Baixar XML/DANFE
          </Button>
          <Button variant="secondary" onClick={() => info('Envio disponível na Etapa 4.')}>
            <Mail className="h-4 w-4" /> Reenviar e-mail
          </Button>
        </div>
      </header>

      <div className="mb-5 flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" onClick={() => setFiscalAction('cancelamento')}>
          <Ban className="h-4 w-4" /> Cancelar nota
        </Button>
        <Button variant="secondary" size="sm" onClick={() => setFiscalAction('carta-correcao')}>
          <FilePenLine className="h-4 w-4" /> Carta de Correção
        </Button>
        <Button variant="secondary" size="sm" onClick={() => setFiscalAction('inutilizacao')}>
          <Hash className="h-4 w-4" /> Inutilizar numeração
        </Button>
      </div>

      {note.situacao === 'rejeitada' && (
        <div className="mb-5 flex flex-wrap items-start justify-between gap-3 rounded-md border border-danger-border bg-danger-soft p-4">
          <div className="flex gap-3">
            <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-danger-fg" />
            <div>
              <p className="text-sm font-semibold text-danger-fg">Nota rejeitada pela SEFAZ</p>
              <p className="mt-1 text-sm text-txt-secondary">
                Código 999 — rejeição simulada para demonstração. Tradução: confira os dados do destinatário e tente novamente.
              </p>
            </div>
          </div>
          <Button size="sm" onClick={() => info('Correção disponível na Etapa 4.')}>
            <RefreshCw className="h-4 w-4" /> Corrigir e reenviar
          </Button>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card className="p-5">
            <h2 className="text-sm font-semibold text-txt-primary">Dados da nota</h2>
            <dl className="mt-4 grid gap-4 sm:grid-cols-2">
              <div>
                <dt className="text-xs text-txt-muted">Cliente</dt>
                <dd className="mt-0.5 text-sm font-medium text-txt-primary">{note.clientName ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-xs text-txt-muted">Modelo</dt>
                <dd className="mt-0.5 text-sm font-medium text-txt-primary">NFC-e ({note.modelo})</dd>
              </div>
              <div>
                <dt className="text-xs text-txt-muted">Valor total</dt>
                <dd className="tabular mt-0.5 text-sm font-semibold text-txt-primary">{formatCurrency(note.valor)}</dd>
              </div>
              <div>
                <dt className="text-xs text-txt-muted">Situação</dt>
                <dd className="mt-0.5"><StatusBadge status={note.situacao} /></dd>
              </div>
            </dl>

            <div className="mt-5 border-t border-line pt-4">
              <p className="text-xs font-medium text-txt-muted">Chave de acesso</p>
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <code className="font-mono text-sm tabular text-txt-primary">{formatChaveNfe(note.chave)}</code>
                <Button variant="ghost" size="sm" onClick={copyKey}>
                  <Copy className="h-3.5 w-3.5" /> Copiar
                </Button>
              </div>
            </div>
          </Card>

          <Card className="p-5">
            <h2 className="text-sm font-semibold text-txt-primary">Pré-visualização do DANFE</h2>
            <p className="mt-0.5 text-xs text-txt-muted">Demonstração — o PDF real vem do backend.</p>
            <div className="mx-auto mt-4 max-w-md rounded-sm border border-line bg-white p-6 shadow-xs">
              <div className="flex items-center justify-between border-b border-line pb-3">
                <span className="text-sm font-bold text-slate-900">DANFE NFC-e</span>
                <span className="text-xs text-slate-500">Nº {note.numero} • Série {note.serie}</span>
              </div>
              <div className="mt-4 text-xs text-slate-600">
                <p><strong>Cliente:</strong> {note.clientName ?? '—'}</p>
                <p className="mt-2"><strong>Emissão:</strong> {formatDate(note.emitidaEm, true)}</p>
                <p className="mt-2"><strong>Valor total:</strong> {formatCurrency(note.valor)}</p>
              </div>
              <div className="mt-6 border-t border-line pt-3 font-mono text-[10px] break-all text-slate-500">
                {note.chave}
              </div>
            </div>
          </Card>
        </div>

        <Card className="h-fit p-5">
          <h2 className="text-sm font-semibold text-txt-primary">Histórico</h2>
          <ol className="mt-5 space-y-6">
            {buildTimeline(note).map((item, index) => {
              const Icon = item.icon
              const isLast = index === buildTimeline(note).length - 1
              return (
                <li key={item.label} className="relative flex gap-3">
                  {!isLast && <span className="absolute left-4 top-8 h-full w-px bg-line" aria-hidden="true" />}
                  <span
                    className={`z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border ${
                      item.state === 'done'
                        ? 'border-success-border bg-success-soft text-success-fg'
                        : item.state === 'rejected'
                          ? 'border-danger-border bg-danger-soft text-danger-fg'
                          : 'border-accent-border bg-accent-soft text-primary-fg'
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                  </span>
                  <div className="pt-1">
                    <p className="text-sm font-medium text-txt-primary">{item.label}</p>
                    <p className="text-xs text-txt-muted">{item.time}</p>
                  </div>
                </li>
              )
            })}
          </ol>
        </Card>
      </div>

      <FiscalActionModals
        action={fiscalAction}
        note={note}
        onOpenChange={(open) => !open && setFiscalAction(null)}
      />
    </div>
  )
}
