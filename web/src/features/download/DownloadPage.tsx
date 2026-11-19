import { Download, FileSpreadsheet, Play } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Button, Card, useToast } from '@/design-system'
import { useCompany } from '@/features/empresas/CompanyProvider'
import { useDownloadGuard } from '@/features/download/DownloadGuard'
import { isApiConfigured } from '@/services/config'
import { cadastrosService, type CompanyRecord } from '@/services/cadastros.service'

type OutputMode = 'excel' | 'xml' | 'both'

const sampleXml = (number: string) => `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe">
  <NFe><infNFe Id="NFe3526113072042000010365001000000${number}1000000010">
    <ide><cUF>35</cUF><nNF>${number}</nNF><serie>1</serie></ide>
  </infNFe></NFe>
</nfeProc>`

function progressoDoLog(linhas: string[]): { atual: number; total: number } | null {
  for (let i = linhas.length - 1; i >= 0; i -= 1) {
    const encontrado = linhas[i].match(/\[(\d+)\/(\d+)\]/)
    if (encontrado) return { atual: Number(encontrado[1]), total: Number(encontrado[2]) }
  }
  return null
}

function formatarLinhaLog(linha: string): string {
  // O log do core traz a chave de 44 dígitos; nela os caracteres 2..8 são AAMMDD.
  const encontrado = linha.match(/^(\[\d+\/\d+\]\s+baixada\s+)(\d{44})$/)
  if (!encontrado) return linha
  const chave = encontrado[2]
  const ano = 2000 + Number(chave.slice(2, 4))
  const mes = chave.slice(4, 6)
  const dia = chave.slice(6, 8)
  return `${encontrado[1]}do dia ${dia}/${mes}/${ano}`
}

export function DownloadPage() {
  const { info, success, error: showError } = useToast()
  const { selectedCompanyId, selectCompany } = useCompany()
  const { beginDownload, endDownload } = useDownloadGuard()
  const [companies, setCompanies] = useState<CompanyRecord[]>([])
  const [companyId, setCompanyId] = useState(selectedCompanyId ?? '')
  const [period, setPeriod] = useState('')
  const [outputMode, setOutputMode] = useState<OutputMode>('excel')
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState(0)
  const [log, setLog] = useState<string[]>([])
  const timer = useRef<number | null>(null)
  const pollTimer = useRef<number | null>(null)
  const jobIdRef = useRef<string | null>(null)
  const logRef = useRef<HTMLDivElement | null>(null)
  // Travas síncronas: evitam dois cliques gerando dois jobs/intervalos de polling.
  const startRef = useRef(false)
  const runIdRef = useRef(0)
  const finishedRef = useRef(false)
  const pollingRef = useRef(false)

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
    // TODO: no backend, gerar os XMLs reais do Supabase Storage e devolver um .zip.
    // Por padrão o navegador salva tudo na pasta Downloads do usuário.
    const files = [
      { name: `NFCe-${period}-001.xml`, content: sampleXml('001') },
      { name: `NFCe-${period}-002.xml`, content: sampleXml('002') },
      { name: `NFCe-${period}-003.xml`, content: sampleXml('003') },
    ]
    try {
      files.forEach((file) => {
        const url = URL.createObjectURL(new Blob([file.content], { type: 'application/xml' }))
        const anchor = document.createElement('a')
        anchor.href = url
        anchor.download = file.name
        anchor.click()
        URL.revokeObjectURL(url)
      })
      success('XMLs baixados!', `${files.length} arquivos enviados para a pasta Downloads.`)
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
    stopTimers()
    const runId = ++runIdRef.current
    setRunning(true)
    setProgress(0)
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
      // O processamento acontece na API, em background. Aqui só acompanhamos.
      pollTimer.current = window.setInterval(async () => {
        if (pollingRef.current || runId !== runIdRef.current) return
        pollingRef.current = true
        try {
          const status = await cadastrosService.getDownloadJob(jobId)
          if (runId !== runIdRef.current) return
          setProgress(status.progresso ?? 0)
          if (status.log) setLog(String(status.log).split('\n').filter(Boolean))
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
              success('Download concluído!', `${status.baixadas} notas baixadas.`)
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
        setLog((current) => [...current, `[${new Date().toLocaleTimeString('pt-BR')}] Concluído.`])
        success('Download concluído!', '12 notas baixadas nesta simulação.')
      }
    }, 120)
  }

  const notasBaixadas = progressoDoLog(log)

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

            <fieldset>
              <legend className="mb-2 text-xs font-medium text-txt-secondary">Formato de saída</legend>
              <div className="space-y-2">
                {([
                  { value: 'excel', label: 'Planilha Excel' },
                  { value: 'xml', label: 'Somente XML' },
                  { value: 'both', label: 'XML + Excel' },
                ] as { value: OutputMode; label: string }[]).map((option) => (
                  <label key={option.value} className={`flex cursor-pointer items-center gap-2 rounded-sm border px-3 py-2.5 text-sm transition-colors ${outputMode === option.value ? 'border-accent bg-accent-soft text-primary-fg' : 'border-line bg-surface text-txt-secondary hover:bg-hover'}`}>
                    <input type="radio" name="output-mode" className="accent-[var(--primary)]" checked={outputMode === option.value} onChange={() => setOutputMode(option.value)} />
                    {option.label}
                  </label>
                ))}
              </div>
            </fieldset>

            <p className="text-xs text-txt-muted">
              Excel e XML são baixados automaticamente para a pasta padrão de Downloads do
              navegador, sem opção de destino. A SEFAZ disponibiliza apenas os últimos 100 dias.
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
            {outputMode !== 'xml' && (
              <Button
                variant="secondary"
                size="sm"
                disabled={running || progress < 100}
                onClick={async () => {
                  if (isApiConfigured && jobIdRef.current) {
                    try {
                      await cadastrosService.exportExcel(jobIdRef.current)
                      success('Planilha baixada.')
                    } catch (err) {
                      showError('Não foi possível gerar a planilha', err instanceof Error ? err.message : undefined)
                    }
                  } else {
                    info('Exportação disponível com a API conectada.')
                  }
                }}
              >
                <FileSpreadsheet className="h-4 w-4" /> Exportar Excel
              </Button>
            )}
            {outputMode !== 'excel' && (
              <Button size="sm" disabled={running || progress < 100} onClick={saveXmls}>
                <Download className="h-4 w-4" /> Salvar XMLs
              </Button>
            )}
          </div>
        </Card>
      </div>
    </div>
  )
}
