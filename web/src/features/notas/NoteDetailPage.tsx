import {
  ArrowLeft,
  Ban,
  CheckCircle2,
  Copy,
  Download,
  FileText,
  RefreshCw,
  Send,
  XCircle,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Button, Card, StatusBadge, useToast } from '@/design-system'
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
  const { info, success, error: showError } = useToast()
  const [note, setNote] = useState<Note | null>(null)
  const [loading, setLoading] = useState(true)
  const [downloading, setDownloading] = useState(false)

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

  const downloadXml = async () => {
    setDownloading(true)
    try {
      await notesService.downloadXml(note.id)
      success('XML baixado!', 'Enviado para a pasta Downloads do navegador.')
    } catch (err) {
      showError('Não foi possível baixar o XML', err instanceof Error ? err.message : undefined)
    } finally {
      setDownloading(false)
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
          <Button variant="secondary" loading={downloading} loadingText="Baixando..." onClick={downloadXml}>
            <Download className="h-4 w-4" /> Baixar XML
          </Button>
        </div>
      </header>

      {note.situacao === 'rejeitada' && (
        <div className="mb-5 flex items-start gap-3 rounded-md border border-danger-border bg-danger-soft p-4">
          <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-danger-fg" />
          <div>
            <p className="text-sm font-semibold text-danger-fg">Nota rejeitada pela SEFAZ</p>
            <p className="mt-1 text-sm text-txt-secondary">
              Código 999 — rejeição simulada para demonstração. Tradução: confira os dados do destinatário e tente novamente.
            </p>
          </div>
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
    </div>
  )
}
