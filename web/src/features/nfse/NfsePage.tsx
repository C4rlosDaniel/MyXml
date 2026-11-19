import { Download, FileText, Info, Play, RefreshCw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import {
  Button,
  Card,
  Input,
  Modal,
  StatusBadge,
  Table,
  useToast,
  type Column,
} from '@/design-system'
import { useDownloadGuard } from '@/features/download/DownloadGuard'
import { useCompany } from '@/features/empresas/CompanyProvider'
import { formatCurrency, maskCnpj } from '@/lib/masks'
import {
  formatarChaveNfse,
  formatarDataNfse,
  nfseService,
  type NfseNote,
} from '@/services/nfse.service'

export function NfsePage() {
  const { success, error: showError, info } = useToast()
  const { companies, selectedCompanyId, selectCompany } = useCompany()
  const { beginDownload, endDownload } = useDownloadGuard()
  const [companyId, setCompanyId] = useState(selectedCompanyId ?? '')
  const [nsuIni, setNsuIni] = useState('')
  const [nsuFim, setNsuFim] = useState('')
  const [habilitado, setHabilitado] = useState(false)
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState(0)
  const [log, setLog] = useState<string[]>([])
  const [notes, setNotes] = useState<NfseNote[]>([])
  const [selected, setSelected] = useState<NfseNote | null>(null)
  const [downloading, setDownloading] = useState<string | null>(null)
  const timer = useRef<number | null>(null)
  const logRef = useRef<HTMLDivElement | null>(null)
  const startRef = useRef(false)
  const finishedRef = useRef(false)
  const runIdRef = useRef(0)
  const pollingRef = useRef(false)
  const jobIdRef = useRef<string | null>(null)
  const resumingRef = useRef(false)
  const resumeCountRef = useRef(0)

  useEffect(() => {
    if (selectedCompanyId) setCompanyId(selectedCompanyId)
  }, [selectedCompanyId])

  useEffect(() => {
    nfseService.config().then((cfg) => {
      setHabilitado(cfg.habilitado)
    }).catch(() => undefined)
  }, [])

  const carregarNotas = () => {
    nfseService.list(companyId || undefined).then(setNotes).catch(() => undefined)
  }

  useEffect(() => {
    nfseService.list(companyId || undefined).then(setNotes).catch(() => undefined)
  }, [companyId])

  useEffect(() => {
    const elemento = logRef.current
    if (elemento) elemento.scrollTop = elemento.scrollHeight
  }, [log])

  const pararTimers = () => {
    if (timer.current) {
      window.clearInterval(timer.current)
      timer.current = null
    }
  }

  const cancelar = () => {
    runIdRef.current += 1
    pararTimers()
    startRef.current = false
    pollingRef.current = false
    setRunning(false)
    const jobId = jobIdRef.current
    jobIdRef.current = null
    if (jobId) void nfseService.cancelJob(jobId).catch(() => undefined)
  }

  useEffect(() => () => {
    pararTimers()
    startRef.current = false
    endDownload()
  }, [endDownload])

  const buscar = async () => {
    if (startRef.current || running) return
    if (!companyId) {
      info('Selecione uma empresa.')
      return
    }
    if (!habilitado) {
      info(
        'Consulta indisponível.',
        'O download de NFS-e ainda não está liberado para esta empresa.',
      )
      return
    }

    startRef.current = true
    finishedRef.current = false
    resumingRef.current = false
    resumeCountRef.current = 0
    pararTimers()
    const runId = ++runIdRef.current
    setRunning(true)
    setProgress(0)
    setLog([`[${new Date().toLocaleTimeString('pt-BR')}] Consultando o ADN (NFS-e Nacional)...`])
    beginDownload(cancelar)

    let jobId: string
    try {
      const job = await nfseService.startDownload(
        companyId,
        nsuIni ? Number(nsuIni) : undefined,
        nsuFim ? Number(nsuFim) : undefined,
      )
      jobId = job.id
    } catch (err) {
      startRef.current = false
      setRunning(false)
      endDownload()
      showError('Não foi possível iniciar a busca', err instanceof Error ? err.message : undefined)
      return
    }
    if (runId !== runIdRef.current) return
    jobIdRef.current = jobId

    timer.current = window.setInterval(async () => {
      if (pollingRef.current || runId !== runIdRef.current) return
      pollingRef.current = true
      try {
        const job = await nfseService.getJob(jobId)
        if (runId !== runIdRef.current) return
        setProgress(job.progresso ?? 0)
        if (job.log) setLog(String(job.log).split('\n').filter(Boolean))

        // O servidor pausa a etapa para não estourar limites da plataforma.
        // Retomamos automaticamente, sem o usuário precisar clicar de novo.
        if (job.status === 'interrompido') {
          if (resumingRef.current) return
          if (resumeCountRef.current >= 20) {
            pararTimers()
            startRef.current = false
            setRunning(false)
            endDownload()
            if (finishedRef.current) return
            finishedRef.current = true
            showError(
              'Busca pausada',
              'Não foi possível retomar automaticamente. Use "Buscar NFS-e" para continuar.',
            )
            return
          }
          resumeCountRef.current += 1
          resumingRef.current = true
          void nfseService
            .resumeJob(jobId)
            .catch(() => undefined)
            .finally(() => {
              resumingRef.current = false
            })
          return
        }
        resumingRef.current = false

        if (job.status !== 'executando') {
          pararTimers()
          startRef.current = false
          setRunning(false)
          endDownload()
          if (!finishedRef.current) {
            finishedRef.current = true
            if (job.status === 'concluido') {
              success('Busca concluída!', `${job.baixadas} NFS-e nova(s).`)
            } else if (job.status === 'com_erros' && job.baixadas > 0) {
              info(
                'Busca parcial',
                `${job.baixadas} NFS-e nova(s). ${job.mensagem ?? ''}`.trim(),
              )
            } else {
              showError('Busca não concluída', job.mensagem ?? 'Tente novamente.')
            }
            carregarNotas()
          }
        }
      } catch (err) {
        pararTimers()
        startRef.current = false
        setRunning(false)
        endDownload()
        if (!finishedRef.current) {
          finishedRef.current = true
          showError('Falha ao acompanhar a busca', err instanceof Error ? err.message : undefined)
        }
      } finally {
        pollingRef.current = false
      }
    }, 1200)
  }

  const baixarXml = async (note: NfseNote) => {
    setDownloading(note.id)
    try {
      await nfseService.downloadXml(note.id)
      success('XML baixado!', 'Enviado para a pasta Downloads.')
    } catch (err) {
      showError('Não foi possível baixar o XML', err instanceof Error ? err.message : undefined)
    } finally {
      setDownloading(null)
    }
  }

  const columns: Column<NfseNote>[] = [
    {
      key: 'nsu',
      header: 'NSU',
      render: (row) => <span className="tabular text-txt-secondary">{row.nsu}</span>,
    },
    {
      key: 'chave',
      header: 'Chave',
      render: (row) => (
        <div className="max-w-[240px]">
          <p className="truncate font-mono text-xs text-txt-primary">{formatarChaveNfse(row.chave)}</p>
          <p className="text-xs text-txt-muted">Nº {row.numero || '—'} • Série {row.serie || '—'}</p>
        </div>
      ),
    },
    {
      key: 'data',
      header: 'Emissão',
      render: (row) => <span className="text-sm text-txt-secondary">{formatarDataNfse(row.emitidaEm)}</span>,
    },
    {
      key: 'valor',
      header: 'Valor',
      render: (row) => <span className="tabular text-sm font-medium text-txt-primary">{formatCurrency(row.valor)}</span>,
    },
    {
      key: 'situacao',
      header: 'Situação',
      render: (row) => <StatusBadge status={row.situacao} />,
    },
    {
      key: 'acoes',
      header: 'Ações',
      render: (row) => (
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={() => setSelected(row)}>Detalhes</Button>
          <Button
            variant="ghost"
            size="icon"
            loading={downloading === row.id}
            aria-label={`Baixar XML da NFS-e ${row.numero}`}
            onClick={() => void baixarXml(row)}
          >
            <Download className="h-4 w-4" />
          </Button>
        </div>
      ),
    },
  ]

  return (
    <div>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-txt-primary">NFS-e Nacional</h1>
        <p className="mt-1 text-sm text-txt-secondary">
          Download das notas de serviço pelo Ambiente de Dados Nacional (ADN).
        </p>
      </header>

      {!habilitado && (
        <div className="mb-5 flex items-start gap-3 rounded-sm border border-line bg-subtle p-4">
          <Info className="mt-0.5 h-5 w-5 shrink-0 text-txt-muted" />
          <div className="text-sm text-txt-secondary">
            <p className="font-semibold text-txt-primary">Consulta indisponível</p>
            <p className="mt-1">
              O download de NFS-e ainda não está liberado para esta empresa. Assim que estiver,
              os XMLs aparecerão aqui.
            </p>
          </div>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-1">
          <h2 className="text-sm font-semibold text-txt-primary">Parâmetros</h2>
          <div className="mt-4 space-y-4">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-txt-secondary" htmlFor="empresa-nfse">
                Empresa
              </label>
              <select
                id="empresa-nfse"
                className="field h-10 w-full px-3 text-sm focus:border-accent focus:ring-2 focus:ring-accent focus:outline-none"
                value={companyId}
                onChange={(event) => {
                  setCompanyId(event.target.value)
                  selectCompany(event.target.value)
                }}
              >
                <option value="">Selecione...</option>
                {companies.map((company) => (
                  <option key={company.id} value={company.id}>
                    {company.nomeExibicao || company.razaoSocial}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Input label="NSU inicial" inputMode="numeric" value={nsuIni} onChange={(event) => setNsuIni(event.target.value)} />
              <Input label="NSU final" inputMode="numeric" value={nsuFim} onChange={(event) => setNsuFim(event.target.value)} />
            </div>
            <p className="text-xs text-txt-muted">
              Deixe em branco para continuar do último número baixado.
            </p>
            <Button fullWidth loading={running} loadingText="Buscando..." disabled={!habilitado} onClick={buscar}>
              <Play className="h-4 w-4" /> Buscar NFS-e
            </Button>
          </div>
        </Card>

        <Card className="p-5 lg:col-span-2">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-txt-primary">Andamento</h2>
              <p className="mt-0.5 text-xs text-txt-muted">
                {log.length ? `${log.length} linha(s) de log` : 'Aguardando a consulta ao ADN...'}
              </p>
            </div>
            <span className="tabular text-xs text-txt-muted">{progress}%</span>
          </div>
          <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-line">
            <div
              className="h-full rounded-full bg-accent transition-[width] duration-150"
              style={{ width: `${progress}%` }}
              role="progressbar"
              aria-valuenow={progress}
              aria-valuemin={0}
              aria-valuemax={100}
            />
          </div>
          <div
            ref={logRef}
            className="mt-5 max-h-56 min-h-32 overflow-y-auto rounded-sm border border-line bg-subtle p-4 font-mono text-xs text-txt-secondary"
          >
            {log.length === 0 ? (
              <p className="text-txt-muted">O log da execução aparecerá aqui.</p>
            ) : (
              log.map((linha, index) => <p key={index} className="mb-1">{linha}</p>)
            )}
          </div>
          <div className="mt-4">
            <Button variant="secondary" size="sm" onClick={carregarNotas}>
              <RefreshCw className="h-4 w-4" /> Atualizar lista
            </Button>
          </div>
        </Card>
      </div>

      <Card className="mt-5 p-5">
        <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-txt-primary">
          <FileText className="h-4 w-4" /> NFS-e baixadas
        </h2>
        <Table
          columns={columns}
          data={notes}
          rowKey={(row) => row.id}
          empty={<p className="py-10 text-center text-sm text-txt-muted">Nenhuma NFS-e baixada ainda.</p>}
        />
      </Card>

      <Modal
        open={selected !== null}
        onOpenChange={(open) => !open && setSelected(null)}
        title={`NFS-e nº ${selected?.numero ?? ''}`}
        description="Dados extraídos do XML recebido do ADN."
        size="md"
        footer={
          <Button variant="secondary" onClick={() => setSelected(null)}>Fechar</Button>
        }
      >
        {selected && (
          <dl className="grid gap-4 text-sm sm:grid-cols-2">
            <div><dt className="text-xs text-txt-muted">NSU</dt><dd className="tabular font-medium">{selected.nsu}</dd></div>
            <div><dt className="text-xs text-txt-muted">Emissão</dt><dd className="font-medium">{formatarDataNfse(selected.emitidaEm)}</dd></div>
            <div className="sm:col-span-2">
              <dt className="text-xs text-txt-muted">Chave de acesso</dt>
              <dd className="mt-1 break-all font-mono text-xs">{formatarChaveNfse(selected.chave)}</dd>
            </div>
            <div><dt className="text-xs text-txt-muted">Prestador</dt><dd className="font-medium">{maskCnpj(selected.prestadorCnpj) || '—'}</dd></div>
            <div><dt className="text-xs text-txt-muted">Tomador</dt><dd className="font-medium">{maskCnpj(selected.tomadorCnpj) || '—'}</dd></div>
            <div><dt className="text-xs text-txt-muted">Valor</dt><dd className="font-semibold">{formatCurrency(selected.valor)}</dd></div>
            <div><dt className="text-xs text-txt-muted">Situação</dt><dd><StatusBadge status={selected.situacao} /></dd></div>
            {selected.eventos && (
              <div className="sm:col-span-2">
                <dt className="text-xs text-txt-muted">Eventos</dt>
                <dd className="mt-1 max-h-32 overflow-y-auto break-all font-mono text-[11px] text-txt-secondary">
                  {selected.eventos}
                </dd>
              </div>
            )}
          </dl>
        )}
      </Modal>
    </div>
  )
}
