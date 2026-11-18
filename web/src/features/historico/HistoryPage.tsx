import { History } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Card, StatusBadge, Table, type Column } from '@/design-system'
import { useCompany } from '@/features/empresas/CompanyProvider'
import { formatDate } from '@/lib/masks'
import { cadastrosService, type RunRecord } from '@/services/cadastros.service'
import type { NoteStatus } from '@/types'

const columns: Column<RunRecord>[] = [
  { key: 'period', header: 'Período', render: (row) => <span className="font-medium text-txt-primary">{row.period}</span> },
  { key: 'company', header: 'Empresa', render: (row) => row.company },
  { key: 'started', header: 'Início', render: (row) => <span className="tabular">{formatDate(row.startedAt, true)}</span> },
  { key: 'downloaded', header: 'Baixadas', render: (row) => <span className="tabular text-right">{row.downloaded}</span>, headerClassName: 'text-right', cellClassName: 'text-right' },
  { key: 'errors', header: 'Erros', render: (row) => <span className="tabular text-right">{row.errors}</span>, headerClassName: 'text-right', cellClassName: 'text-right' },
  { key: 'status', header: 'Situação', render: (row) => (
    <StatusBadge status={({ concluido: 'autorizada', com_erros: 'rejeitada', executando: 'enviada', falhou: 'rejeitada' } as Record<RunRecord['status'], NoteStatus>)[row.status]} />
  ) },
  { key: 'user', header: 'Usuário', render: (row) => <span className="text-xs">{row.user}</span> },
]

export function HistoryPage() {
  const { selectedCompany, selectedCompanyId } = useCompany()
  const [runs, setRuns] = useState<RunRecord[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    cadastrosService.listRuns().then((data) => {
      setRuns(data)
      setLoading(false)
    })
  }, [])

  return (
    <div>
      <header className="mb-6 flex items-center gap-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-sm bg-accent-soft text-primary-fg">
          <History className="h-4 w-4" />
        </span>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-txt-primary">Histórico</h1>
          <p className="mt-1 text-sm text-txt-secondary">
            Execuções de {selectedCompany?.nomeExibicao || selectedCompany?.razaoSocial || '—'}.
          </p>
        </div>
      </header>

      <Card className="p-4">
        <Table
          columns={columns}
          data={runs.filter((run) => run.companyId === selectedCompanyId)}
          isLoading={loading}
          rowKey={(row) => row.id}
          empty={<p className="py-10 text-center text-sm text-txt-muted">Nenhuma execução registrada para esta empresa.</p>}
        />
      </Card>
    </div>
  )
}
