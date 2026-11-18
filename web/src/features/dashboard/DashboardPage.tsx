import {
  ArrowDownRight,
  ArrowUpRight,
  Building2,
  CheckCircle2,
  Clock3,
  Download,
  FileText,
  Receipt,
  XCircle,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Card, StatusBadge, Table, useToast, type Column } from '@/design-system'
import { useCompany } from '@/features/empresas/CompanyProvider'
import { useCountUp } from '@/hooks/useCountUp'
import { formatCurrency, formatDate } from '@/lib/masks'
import { notesService } from '@/services/notes.service'
import type { Note, NoteStatus } from '@/types'

type Format = 'number' | 'currency'

interface Kpi {
  label: string
  value: number
  format: Format
  delta: number
  invert?: boolean
  icon: typeof FileText
  spark: number[]
}

function Sparkline({ points }: { points: number[] }) {
  const min = Math.min(...points)
  const max = Math.max(...points)
  const range = max - min || 1
  const coords = points
    .map((point, index) => {
      const x = (index / Math.max(points.length - 1, 1)) * 100
      const y = 28 - ((point - min) / range) * 24
      return `${x},${y}`
    })
    .join(' ')

  return (
    <svg viewBox="0 0 100 32" className="h-8 w-24" preserveAspectRatio="none" aria-hidden="true">
      <polyline points={coords} fill="none" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

function KpiCard({ kpi }: { kpi: Kpi }) {
  const animated = useCountUp(kpi.value)
  const isGood = kpi.invert ? kpi.delta < 0 : kpi.delta > 0
  const Icon = kpi.icon

  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <span className="text-xs font-medium text-txt-secondary">{kpi.label}</span>
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-sm bg-subtle text-txt-muted">
          <Icon className="h-4 w-4" />
        </span>
      </div>
      <p className="tabular mt-3 text-2xl font-semibold tracking-tight text-txt-primary">
        {kpi.format === 'currency'
          ? formatCurrency(animated)
          : Math.round(animated).toLocaleString('pt-BR')}
      </p>
      <div className="mt-3 flex items-end justify-between gap-2">
        <span className={`inline-flex items-center gap-1 text-xs font-medium ${isGood ? 'text-success-fg' : 'text-danger-fg'}`}>
          {kpi.delta > 0 ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}
          {Math.abs(kpi.delta)}% <span className="font-normal text-txt-muted">vs. mês anterior</span>
        </span>
        <span className={isGood ? 'text-success' : 'text-danger'}>
          <Sparkline points={kpi.spark} />
        </span>
      </div>
    </Card>
  )
}

function sameMonth(date: string, reference: Date) {
  const value = new Date(date)
  return value.getMonth() === reference.getMonth() && value.getFullYear() === reference.getFullYear()
}

function variation(current: number, previous: number) {
  if (previous === 0) return current > 0 ? 100 : 0
  return Math.round(((current - previous) / previous) * 100)
}

export function DashboardPage() {
  const navigate = useNavigate()
  const { info } = useToast()
  const { selectedCompany, selectedCompanyId } = useCompany()
  const [notes, setNotes] = useState<Note[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    notesService.list().then((data) => {
      setNotes(data)
      setLoading(false)
    })
  }, [])

  const companyNotes = useMemo(
    () => notes.filter((note) => note.companyId === selectedCompanyId),
    [notes, selectedCompanyId],
  )

  const kpis = useMemo<Kpi[]>(() => {
    const now = new Date()
    const previousMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    const current = companyNotes.filter((note) => sameMonth(note.emitidaEm, now))
    const previous = companyNotes.filter((note) => sameMonth(note.emitidaEm, previousMonth))

    const total = (list: Note[]) => list.reduce((sum, note) => sum + note.valor, 0)
    const count = (list: Note[], statuses: NoteStatus[]) =>
      list.filter((note) => statuses.includes(note.situacao)).length
    const spark = (list: Note[]) => {
      const values = list.slice(0, 10).map((note) => note.valor).reverse()
      return values.length >= 2 ? values : [0, 0]
    }

    return [
      {
        label: 'Notas emitidas no mês',
        value: current.length,
        format: 'number',
        delta: variation(current.length, previous.length),
        icon: Receipt,
        spark: spark(current),
      },
      {
        label: 'Valor total',
        value: total(current),
        format: 'currency',
        delta: variation(total(current), total(previous)),
        icon: CheckCircle2,
        spark: spark(current),
      },
      {
        label: 'Pendentes',
        value: count(current, ['enviada', 'rascunho']),
        format: 'number',
        delta: variation(count(current, ['enviada', 'rascunho']), count(previous, ['enviada', 'rascunho'])),
        invert: true,
        icon: Clock3,
        spark: spark(current.filter((note) => note.situacao === 'enviada' || note.situacao === 'rascunho')),
      },
      {
        label: 'Rejeitadas',
        value: count(current, ['rejeitada']),
        format: 'number',
        delta: variation(count(current, ['rejeitada']), count(previous, ['rejeitada'])),
        invert: true,
        icon: XCircle,
        spark: spark(current.filter((note) => note.situacao === 'rejeitada')),
      },
    ]
  }, [companyNotes])

  const columns: Column<Note>[] = [
    { key: 'numero', header: 'Número', render: (row) => <span className="tabular font-medium text-txt-primary">Nº {row.numero}</span> },
    { key: 'cliente', header: 'Cliente', render: (row) => <span className="truncate">{row.clientName ?? '—'}</span> },
    {
      key: 'valor', header: 'Valor',
      render: (row) => <span className="tabular text-right font-medium">{formatCurrency(row.valor)}</span>,
      headerClassName: 'text-right', cellClassName: 'text-right',
    },
    { key: 'status', header: 'Situação', render: (row) => <StatusBadge status={row.situacao} /> },
    { key: 'emissao', header: 'Emissão', render: (row) => <span className="tabular">{formatDate(row.emitidaEm, true)}</span> },
  ]

  if (!selectedCompany) {
    return (
      <div>
        <header className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight text-txt-primary">Visão geral</h1>
          <p className="mt-1 text-sm text-txt-secondary">Selecione uma empresa para ver os dados.</p>
        </header>
        <Card className="flex min-h-[320px] flex-col items-center justify-center p-8 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-accent-soft text-primary-fg">
            <Building2 className="h-6 w-6" />
          </div>
          <p className="mt-4 text-sm font-semibold text-txt-primary">Nenhuma empresa selecionada</p>
          <p className="mt-1 max-w-sm text-sm text-txt-secondary">
            Cadastre uma empresa com certificado digital para começar a baixar e acompanhar notas.
          </p>
          <Button className="mt-5" onClick={() => navigate('/empresas')}>Cadastrar empresa</Button>
        </Card>
      </div>
    )
  }

  return (
    <div>
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-txt-primary">Visão geral</h1>
          <p className="mt-1 text-sm text-txt-secondary">
            Dados de <strong className="font-semibold text-txt-primary">{selectedCompany.nomeExibicao || selectedCompany.razaoSocial}</strong>
          </p>
        </div>
        <Button onClick={() => navigate('/baixar')}>
          <Download className="h-4 w-4" /> Baixar notas
        </Button>
      </header>

      <section aria-label="Indicadores" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {kpis.map((kpi) => <KpiCard key={kpi.label} kpi={kpi} />)}
      </section>

      <section className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-txt-primary">Últimas notas</h2>
              <p className="mt-0.5 text-xs text-txt-muted">Movimentação mais recente desta empresa</p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => navigate('/notas')}>Ver todas</Button>
          </div>
          <Table
            columns={columns}
            data={companyNotes.slice(0, 5)}
            isLoading={loading}
            rowKey={(row) => row.id}
            empty={
              <div className="rounded-sm border border-dashed border-line p-10 text-center">
                <FileText className="mx-auto h-8 w-8 text-txt-muted" />
                <p className="mt-3 text-sm font-medium text-txt-primary">Nenhuma nota desta empresa</p>
                <p className="mt-1 text-xs text-txt-muted">Baixe as notas para popular o dashboard.</p>
              </div>
            }
          />
        </Card>

        <Card className="p-5">
          <h2 className="text-sm font-semibold text-txt-primary">Status do serviço</h2>
          <p className="mt-0.5 text-xs text-txt-muted">Integração fiscal</p>
          <div className="mt-5 flex items-center gap-3 rounded-sm border border-line bg-subtle p-3">
            <span className="h-2.5 w-2.5 rounded-full bg-warning" aria-hidden="true" />
            <div>
              <p className="text-sm font-medium text-txt-primary">SEFAZ-SP</p>
              <p className="text-xs text-txt-muted">Homologação • a verificar</p>
            </div>
          </div>
          <dl className="mt-4 space-y-2 text-sm text-txt-secondary">
            <div className="flex justify-between"><dt>Modelo</dt><dd className="font-medium text-txt-primary">NFC-e (65)</dd></div>
            <div className="flex justify-between"><dt>Empresa</dt><dd className="truncate pl-2 font-medium text-txt-primary">{selectedCompany.nomeExibicao || selectedCompany.razaoSocial}</dd></div>
            <div className="flex justify-between"><dt>Validade do certificado</dt><dd className="font-medium text-txt-primary">{selectedCompany.certValidade ? formatDate(selectedCompany.certValidade) : '—'}</dd></div>
          </dl>
          <Button variant="secondary" size="sm" fullWidth className="mt-5" onClick={() => info('Consulta disponível ao executar o download.')}>
            <Download className="h-4 w-4" /> Consultar status
          </Button>
        </Card>
      </section>
    </div>
  )
}
