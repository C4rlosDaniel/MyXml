import { Download, FileSpreadsheet, FolderOpen, Play } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Button, Card, useToast } from '@/design-system'
import { useCompany } from '@/features/empresas/CompanyProvider'
import { isApiConfigured } from '@/services/config'
import { cadastrosService, type CompanyRecord } from '@/services/cadastros.service'

type OutputMode = 'excel' | 'xml' | 'both'

type DirectoryHandleLike = {
  name: string
  getFileHandle: (name: string, options?: { create?: boolean }) => Promise<{
    createWritable: () => Promise<{ write: (data: string) => Promise<void>; close: () => Promise<void> }>
  }>
}

const sampleXml = (number: string) => `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe">
  <NFe><infNFe Id="NFe3526113072042000010365001000000${number}1000000010">
    <ide><cUF>35</cUF><nNF>${number}</nNF><serie>1</serie></ide>
  </infNFe></NFe>
</nfeProc>`

export function DownloadPage() {
  const { info, success, error: showError } = useToast()
  const { selectedCompanyId, selectCompany } = useCompany()
  const [companies, setCompanies] = useState<CompanyRecord[]>([])
  const [companyId, setCompanyId] = useState(selectedCompanyId ?? '')
  const [period, setPeriod] = useState('')
  const [outputMode, setOutputMode] = useState<OutputMode>('excel')
  const [folderName, setFolderName] = useState('')
  const [folderPath, setFolderPath] = useState('')
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState(0)
  const [log, setLog] = useState<string[]>([])
  const timer = useRef<number | null>(null)
  const pollTimer = useRef<number | null>(null)
  const jobIdRef = useRef<string | null>(null)
  const folderHandle = useRef<DirectoryHandleLike | null>(null)

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

  useEffect(() => () => {
    if (timer.current) window.clearInterval(timer.current)
    if (pollTimer.current) window.clearInterval(pollTimer.current)
  }, [])

  const chooseFolder = async () => {
    const picker = (window as unknown as { showDirectoryPicker?: () => Promise<DirectoryHandleLike> }).showDirectoryPicker
    if (!picker) {
      info('Navegador sem seletor de pasta', 'Informe o caminho desejado no campo abaixo.')
      return
    }
    try {
      const handle = await picker()
      folderHandle.current = handle
      setFolderName(handle.name)
      success('Pasta selecionada!', handle.name)
    } catch {
      info('Seleção cancelada.')
    }
  }

  const saveXmls = async () => {
    // TODO: no backend, gerar os XMLs reais do Supabase Storage e devolver um .zip
    const files = [
      { name: `NFCe-${period}-001.xml`, content: sampleXml('001') },
      { name: `NFCe-${period}-002.xml`, content: sampleXml('002') },
      { name: `NFCe-${period}-003.xml`, content: sampleXml('003') },
    ]
    try {
      if (folderHandle.current) {
        for (const file of files) {
          const handle = await folderHandle.current.getFileHandle(file.name, { create: true })
          const writable = await handle.createWritable()
          await writable.write(file.content)
          await writable.close()
        }
        success('XMLs salvos!', `${files.length} arquivos em ${folderName}.`)
      } else {
        files.forEach((file) => {
          const url = URL.createObjectURL(new Blob([file.content], { type: 'application/xml' }))
          const anchor = document.createElement('a')
          anchor.href = url
          anchor.download = file.name
          anchor.click()
          URL.revokeObjectURL(url)
        })
        success('XMLs enviados para download!', 'Escolha o destino na janela do navegador.')
      }
    } catch (err) {
      showError('Não foi possível salvar os XMLs', err instanceof Error ? err.message : undefined)
    }
  }

  const start = async () => {
    if (!companyId || !period) {
      info('Selecione a empresa e o período.')
      return
    }
    const job = await cadastrosService.startDownload(companyId, period)
    jobIdRef.current = job.jobId
    setRunning(true)
    setProgress(0)
    setLog([
      `[${new Date().toLocaleTimeString('pt-BR')}] Consultando SEFAZ-SP...`,
      `[${new Date().toLocaleTimeString('pt-BR')}] Período: ${period}`,
    ])

    if (isApiConfigured) {
      // O processamento acontece na API, em background. Aqui só acompanhamos.
      pollTimer.current = window.setInterval(async () => {
        try {
          const status = await cadastrosService.getDownloadJob(job.jobId)
          setProgress(status.progresso ?? 0)
          if (status.log) setLog(String(status.log).split('\n').filter(Boolean))
          if (status.status !== 'executando') {
            if (pollTimer.current) window.clearInterval(pollTimer.current)
            setRunning(false)
            if (status.status === 'concluido') {
              success('Download concluído!', `${status.baixadas} notas baixadas.`)
            } else {
              showError('Download não concluído', status.mensagem ?? 'Tente novamente.')
            }
          }
        } catch (err) {
          if (pollTimer.current) window.clearInterval(pollTimer.current)
          setRunning(false)
          showError('Falha ao acompanhar o job', err instanceof Error ? err.message : undefined)
        }
      }, 1200)
      return
    }

    const started = Date.now()
    timer.current = window.setInterval(() => {
      const elapsed = Date.now() - started
      const next = Math.min(100, Math.round((elapsed / 2200) * 100))
      setProgress(next)
      if (next >= 35 && log.length < 3) {
        setLog((current) => [...current, `[${new Date().toLocaleTimeString('pt-BR')}] Baixando XMLs...`])
      }
      if (next >= 75 && log.length < 4) {
        setLog((current) => [...current, `[${new Date().toLocaleTimeString('pt-BR')}] Gerando arquivos...`])
      }
      if (next >= 100) {
        if (timer.current) window.clearInterval(timer.current)
        setRunning(false)
        setLog((current) => [...current, `[${new Date().toLocaleTimeString('pt-BR')}] Concluído.`])
        success('Download concluído!', '12 notas baixadas nesta simulação.')
      }
    }, 120)
  }

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
                  { value: 'xml', label: 'Somente XML em pasta' },
                  { value: 'both', label: 'XML + Excel' },
                ] as { value: OutputMode; label: string }[]).map((option) => (
                  <label key={option.value} className={`flex cursor-pointer items-center gap-2 rounded-sm border px-3 py-2.5 text-sm transition-colors ${outputMode === option.value ? 'border-accent bg-accent-soft text-primary-fg' : 'border-line bg-surface text-txt-secondary hover:bg-hover'}`}>
                    <input type="radio" name="output-mode" className="accent-[var(--primary)]" checked={outputMode === option.value} onChange={() => setOutputMode(option.value)} />
                    {option.label}
                  </label>
                ))}
              </div>
            </fieldset>

            {outputMode !== 'excel' && (
              <div className="rounded-sm border border-line bg-subtle p-3">
                <p className="text-xs font-medium text-txt-secondary">Destino dos XMLs</p>
                <Button variant="secondary" size="sm" className="mt-2" onClick={chooseFolder}>
                  <FolderOpen className="h-4 w-4" /> Escolher pasta
                </Button>
                {folderName && <p className="mt-2 text-xs text-success-fg">Pasta: {folderName}</p>}
                <input
                  aria-label="Caminho da pasta"
                  className="field mt-2 h-9 w-full px-3 text-xs"
                  placeholder="Ou informe o caminho/caminho no Storage"
                  value={folderPath}
                  onChange={(event) => setFolderPath(event.target.value)}
                />
                <p className="mt-2 text-[11px] leading-relaxed text-txt-muted">
                  No navegador, o seletor grava os arquivos na pasta escolhida (Chrome/Edge). Em produção, o caminho pode apontar para uma pasta no Supabase Storage.
                </p>
              </div>
            )}

            <p className="text-xs text-txt-muted">
              A SEFAZ disponibiliza apenas os últimos 100 dias. Períodos fora dessa faixa serão avisados pelo backend.
            </p>

            <Button fullWidth loading={running} loadingText="Baixando..." onClick={start}>
              <Play className="h-4 w-4" /> Baixar agora
            </Button>
          </div>
        </Card>

        <Card className="p-5 lg:col-span-2">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-txt-primary">Andamento</h2>
            <span className="tabular text-xs text-txt-muted">{progress}%</span>
          </div>
          <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-line">
            <div className="h-full rounded-full bg-accent transition-[width] duration-150" style={{ width: `${progress}%` }} role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100} aria-label="Progresso do download" />
          </div>

          <div className="mt-5 min-h-48 rounded-sm border border-line bg-subtle p-4 font-mono text-xs text-txt-secondary">
            {log.length === 0 ? (
              <p className="text-txt-muted">O log da execução aparecerá aqui.</p>
            ) : (
              log.map((line, index) => <p key={index} className="mb-1">{line}</p>)
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
