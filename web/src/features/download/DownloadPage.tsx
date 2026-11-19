import { Download, FileSpreadsheet, Play } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Button, Card, useToast } from '@/design-system'
import { useCompany } from '@/features/empresas/CompanyProvider'
import { useDownloadGuard } from '@/features/download/DownloadGuard'
import { isApiConfigured } from '@/services/config'
import { cadastrosService, type CompanyRecord } from '@/services/cadastros.service'

function progressoDoLog(linhas: string[]): { atual: number; total: number } | null {
  for (let i = linhas.length - 1; i >= 0; i -= 1) {
    const encontrado = linhas[i].match(/\[(\d+)\/(\d+)\]/)
    if (encontrado) return { atual: Number(encontrado[1]), total: Number(encontrado[2]) }
  }
  return null
}

function formatarLinhaLog(linha: string): string {
  // O backend já envia "baixada do dia DD/MM/AA". Em logs antigos, a chave de
  // 44 dígitos no fim é um dado técnico e não deve aparecer na tela.
  return linha.replace(/\s+\d{44}\s*$/, '')
}

export function DownloadPage() {
  const { info, success, error: showError } = useToast()
  const { selectedCompanyId, selectCompany } = useCompany()
  const { beginDownload, endDownload } = useDownloadGuard()
  const [companies, setCompanies] = useState<CompanyRecord[]>([])
  const [companyId, setCompanyId] = useState(selectedCompanyId ?? '')
  const [period, setPeriod] = useState('')
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState(0)
  const [log, setLog] = useState<string[]>([])
  const [jobStatus, setJobStatus] = useState<string | null>(null)
  const [baixadas, setBaixadas] = useState(0)
  const timer = useRef<number | null>(null)
  const pollTimer = useRef<number | null>(null)
  const jobIdRef = useRef<string | null>(null)
  const logRef = useRef<HTMLDivElement | null>(null)
  // Travas síncronas: evitam dois cliques gerando dois jobs/intervalos de polling.
  const startRef = useRef(false)
  const runIdRef = useRef(0)
  const finishedRef = useRef(false)
  const pollingRef = useRef(false)
  const resumingRef = useRef(false)
  const resumeCountRef = useRef(0)

  // Mantém a última nota baixada sempre visível dentro do card.
  useEffect(() => {
    const elemento = logRef.current
    if (elemento) elemento.scrollTop = elemento.scrollHeight
  }, [log])

  useEffect(() => {
    cadastrosService.listCompanies().then((data) => {
      setCompanies(data)
      if (!companyId && data[0]) setCompanyId(data[0].id)
    })
    const now = new Date()
    setPeriod(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`)
  }, [])

  useEffect(() => {
    if (selectedCompanyId) setCompanyId(selectedCompanyId)
  }, [selectedCompanyId])

  const stopTimers = () => {
    if (timer.current) {
      window.clearInterval(timer.current)
      timer.current = null
    }
    if (pollTimer.current) {
      window.clearInterval(pollTimer.current)
      pollTimer.current = null
    }
  }

  // Encerra o "programa de baixar notas" quando o usuário confirma a saída da aba.
  const cancelDownload = () => {
    runIdRef.current += 1
    stopTimers()
    startRef.current = false
    pollingRef.current = false
    setRunning(false)
    const jobId = jobIdRef.current
    jobIdRef.current = null
    if (isApiConfigured && jobId) {
      void cadastrosService.cancelDownload(jobId).catch(() => undefined)
    }
  }

  useEffect(() => () => {
    stopTimers()
    startRef.current = false
    endDownload()
  }, [endDownload])

  const saveXmls = async () => {
    const jobId = jobIdRef.current
    if (!jobId) return
    try {
      await cadastrosService.downloadXmls(jobId)
      success('XMLs baixados!', 'O ZIP foi enviado para a pasta Downloads.')
    } catch (err) {
      showError('Não foi possível baixar os XMLs', err instanceof Error ? err.message : undefined)
    }
  }

  const start = async () => {
    // Trava síncrona: um clique só inicia uma execução, mesmo antes do estado
    // "running" ser propagado pelo React. Sem isso, dois jobs simultâneos geram
    // dois polling e o card de erro aparece repetidas vezes.
    if (startRef.current || running) return
    if (!companyId || !period) {
      info('Selecione a empresa e o período.')
      return
    }

    startRef.current = true
    finishedRef.current = false
    resumingRef.current = false
    resumeCountRef.current = 0
    stopTimers()
    const runId = ++runIdRef.current
    setRunning(true)
    setProgress(0)
    setJobStatus(null)
    setBaixadas(0)
    setLog([
      `[${new Date().toLocaleTimeString('pt-BR')}] Consultando SEFAZ-SP...`,
      `[${new Date().toLocaleTimeString('pt-BR')}] Período: ${period}`,
    ])
    beginDownload(cancelDownload)

    let jobId: string
    try {
      const job = await cadastrosService.startDownload(companyId, period)
      jobId = job.jobId
    } catch (err) {
      startRef.current = false
      setRunning(false)
      endDownload()
      showError('Não foi possível iniciar o download', err instanceof Error ? err.message : undefined)
      return
    }
    if (runId !== runIdRef.current) return // usuário saiu da aba enquanto iniciava
    jobIdRef.current = jobId

    if (isApiConfigured) {
      pollTimer.current = window.setInterval(async () => {
        if (pollingRef.current || runId !== runIdRef.current) return
        pollingRef.current = true
        try {
          const status = await cadastrosService.getDownloadJob(jobId)
          if (runId !== runIdRef.current) return
          setProgress(status.progresso ?? 0)
          setJobStatus(status.status)
          setBaixadas(status.baixadas ?? 0)
          if (status.log) setLog(String(status.log).split('\n').filter(Boolean))

          // O servidor pausa a etapa para não estourar limites da plataforma.
          // Aqui retomamos automaticamente, sem o usuário precisar clicar de novo.
          if (status.status === 'interrompido') {
            if (resumingRef.current) return
            if (resumeCountRef.current >= 20) {
              if (pollTimer.current) window.clearInterval(pollTimer.current)
              pollTimer.current = null
              startRef.current = false
              setRunning(false)
              endDownload()
              if (finishedRef.current) return
              finishedRef.current = true
              showError(
                'Download pausado',
                'Não foi possível retomar automaticamente. Inicie o download do mesmo período para continuar.',
              )
              return
            }
            resumeCountRef.current += 1
            resumingRef.current = true
            void cadastrosService
              .resumeDownload(jobId)
              .catch(() => undefined)
              .finally(() => {
                resumingRef.current = false
              })
            return
          }
          resumingRef.current = false

          if (status.status !== 'executando') {
            if (pollTimer.current) window.clearInterval(pollTimer.current)
            pollTimer.current = null
            startRef.current = false
            setRunning(false)
            endDownload()
            // Uma única notificação por execução, mesmo com respostas em voo.
            if (finishedRef.current) return
            finishedRef.current = true
            if (status.status === 'concluido') {
              success('Download concluído!', `${status.baixadas} notas salvas.`)
            } else if (status.status === 'com_erros' && status.baixadas > 0) {
              success(
                'Download concluído com pendências',
                `${status.baixadas} notas salvas; ${status.erros} não puderam ser baixadas.`,
              )
            } else {
              showError('Download não concluído', status.mensagem ?? 'Tente novamente.')
            }
          }
        } catch (err) {
          if (pollTimer.current) window.clearInterval(pollTimer.current)
          pollTimer.current = null
          startRef.current = false
          setRunning(false)
          endDownload()
          if (finishedRef.current) return
          finishedRef.current = true
          showError('Falha ao acompanhar o job', err instanceof Error ? err.message : undefined)
        } finally {
          pollingRef.current = false
        }
      }, 1200)
      return
    }

    const started = Date.now()
    const etapas = new Set<number>()
    timer.current = window.setInterval(() => {
      if (runId !== runIdRef.current) return
      const elapsed = Date.now() - started
      const next = Math.min(100, Math.round((elapsed / 2200) * 100))
      setProgress(next)
      if (next >= 35 && !etapas.has(35)) {
        etapas.add(35)
        setLog((current) => [...current, `[${new Date().toLocaleTimeString('pt-BR')}] Baixando XMLs...`])
      }
      if (next >= 75 && !etapas.has(75)) {
        etapas.add(75)
        setLog((current) => [...current, `[${new Date().toLocaleTimeString('pt-BR')}] Gerando arquivos...`])
      }
      if (next >= 100) {
        if (timer.current) window.clearInterval(timer.current)
        timer.current = null
        startRef.current = false
        setRunning(false)
        endDownload()
        if (finishedRef.current) return
        finishedRef.current = true
        setJobStatus('concluido')
        setBaixadas(12)
        setLog((current) => [...current, `[${new Date().toLocaleTimeString('pt-BR')}] Concluído.`])
        success('Download concluído!', '12 notas baixadas nesta simulação.')
      }
    }, 120)
  }

  const notasBaixadas = progressoDoLog(log)
  const podeBaixar =
    jobStatus !== null && jobStatus !== 'executando' && jobStatus !== 'interrompido' && baixadas > 0

  return (
    <div>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-txt-primary">Baixar notas</h1>
        <p className="mt-1 text-sm text-txt-secondary">
          Escolha a empresa, o período e o formato de saída dos arquivos.
        </p>
      </header>

      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-1">
          <h2 className="text-sm font-semibold text-txt-primary">Parâmetros</h2>
          <div className="mt-4 space-y-4">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-txt-secondary" htmlFor="empresa-download">Empresa</label>
              <select id="empresa-download" className="field h-10 w-full px-3 text-sm focus:border-accent focus:ring-2 focus:ring-accent focus:outline-none" value={companyId} onChange={(event) => {
                setCompanyId(event.target.value)
                selectCompany(event.target.value)
              }}>
                <option value="">Selecione...</option>
                {companies.map((company) => (
                  <option key={company.id} value={company.id}>{company.nomeExibicao || company.razaoSocial}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-txt-secondary" htmlFor="periodo-download">Período</label>
              <input id="periodo-download" type="month" className="field h-10 w-full px-3 text-sm focus:border-accent focus:ring-2 focus:ring-accent focus:outline-none" value={period} onChange={(event) => setPeriod(event.target.value)} />
            </div>

            <p className="text-xs text-txt-muted">
              A SEFAZ disponibiliza apenas os últimos 100 dias.
            </p>

            <Button fullWidth loading={running} loadingText="Baixando..." onClick={start}>
              <Play className="h-4 w-4" /> Baixar agora
            </Button>
          </div>
        </Card>

        <Card className="p-5 lg:col-span-2">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-txt-primary">Andamento</h2>
              <p className="mt-0.5 text-xs text-txt-muted">
                {notasBaixadas
                  ? `${notasBaixadas.atual} de ${notasBaixadas.total} notas baixadas`
                  : 'Aguardando a SEFAZ...'}
              </p>
            </div>
            <span className="tabular text-xs text-txt-muted">{progress}%</span>
          </div>
          <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-line">
            <div className="h-full rounded-full bg-accent transition-[width] duration-150" style={{ width: `${progress}%` }} role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100} aria-label="Progresso do download" />
          </div>

          <div
            ref={logRef}
            className="mt-5 max-h-56 min-h-32 overflow-y-auto rounded-sm border border-line bg-subtle p-4 font-mono text-xs text-txt-secondary"
          >
            {log.length === 0 ? (
              <p className="text-txt-muted">O log da execução aparecerá aqui.</p>
            ) : (
              log.map((line, index) => (
                <p key={index} className="mb-1">{formatarLinhaLog(line)}</p>
              ))
            )}
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={running || !podeBaixar}
              onClick={async () => {
                const jobId = jobIdRef.current
                if (!jobId) return
                try {
                  await cadastrosService.exportExcel(jobId)
                  success('Planilha baixada.')
                } catch (err) {
                  showError('Não foi possível gerar a planilha', err instanceof Error ? err.message : undefined)
                }
              }}
            >
              <FileSpreadsheet className="h-4 w-4" /> Exportar Excel
            </Button>
            <Button size="sm" disabled={running || !podeBaixar} onClick={saveXmls}>
              <Download className="h-4 w-4" /> Baixar XMLs
            </Button>
            {!podeBaixar && jobStatus && jobStatus !== 'interrompido' && baixadas === 0 && (
              <p className="w-full text-xs text-txt-muted">
                Nenhum arquivo disponível para esta execução.
              </p>
            )}
          </div>
        </Card>
      </div>
    </div>
  )
}
