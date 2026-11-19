import { CheckCircle2, Save, Settings2, ShieldCheck, Upload } from 'lucide-react'
import { useEffect, useState, type ChangeEvent } from 'react'
import { Button, Card, Input, useToast } from '@/design-system'
import { useCompany } from '@/features/empresas/CompanyProvider'
import { formatDate } from '@/lib/masks'
import { cadastrosService } from '@/services/cadastros.service'
import { isApiConfigured } from '@/services/config'

interface CertificateStatus {
  cadastrado: boolean
  cnpj?: string
  razaoSocial?: string
  validade?: string
  titular?: string
}

export function SettingsPage() {
  const { success, info, error: showError } = useToast()
  const { selectedCompany, selectedCompanyId } = useCompany()
  const [serie, setSerie] = useState(localStorage.getItem('myxml-serie') ?? '1')
  const [proximoNumero, setProximoNumero] = useState(localStorage.getItem('myxml-numero') ?? '100')
  const [certFile, setCertFile] = useState<File | null>(null)
  const [certPassword, setCertPassword] = useState('')
  const [certStatus, setCertStatus] = useState<CertificateStatus | null>(null)
  const [uploading, setUploading] = useState(false)

  const save = () => {
    localStorage.setItem('myxml-serie', serie)
    localStorage.setItem('myxml-numero', proximoNumero)
    success('Configurações salvas.')
  }

  useEffect(() => {
    if (!isApiConfigured || !selectedCompanyId) {
      setCertStatus(null)
      return
    }
    cadastrosService
      .getCertificateStatus(selectedCompanyId)
      .then(setCertStatus)
      .catch(() => setCertStatus(null))
  }, [selectedCompanyId])

  const onCertFile = (event: ChangeEvent<HTMLInputElement>) => {
    setCertFile(event.target.files?.[0] ?? null)
  }

  const sendCertificate = async () => {
    if (!selectedCompanyId) {
      info('Selecione uma empresa no topo da tela antes de enviar o certificado.')
      return
    }
    if (!certFile) {
      showError('Selecione o arquivo .pfx do certificado.')
      return
    }
    if (!certPassword) {
      showError('Informe a senha do certificado.')
      return
    }
    if (!isApiConfigured) {
      info('O envio de certificados estará disponível em instantes.')
      return
    }

    setUploading(true)
    try {
      await cadastrosService.uploadCertificate(selectedCompanyId, certFile, certPassword)
      success('Certificado enviado!', 'Guardado em cofre criptografado no servidor.')
      setCertPassword('')
      setCertFile(null)
      setCertStatus(await cadastrosService.getCertificateStatus(selectedCompanyId))
    } catch (err) {
      showError('Não foi possível enviar o certificado', err instanceof Error ? err.message : undefined)
    } finally {
      setUploading(false)
    }
  }

  return (
    <div>
      <header className="mb-6 flex items-center gap-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-sm bg-accent-soft text-primary-fg">
          <Settings2 className="h-4 w-4" />
        </span>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-txt-primary">Configurações</h1>
          <p className="mt-1 text-sm text-txt-secondary">Numeração, certificado e preferências.</p>
        </div>
      </header>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="text-sm font-semibold text-txt-primary">Série e numeração</h2>
          <p className="mt-0.5 text-xs text-txt-secondary">Controle dos números usados na emissão.</p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Input label="Série" value={serie} onChange={(event) => setSerie(event.target.value)} />
            <Input label="Próximo número" value={proximoNumero} onChange={(event) => setProximoNumero(event.target.value)} />
          </div>
          <Button size="sm" className="mt-5" onClick={save}><Save className="h-4 w-4" /> Salvar</Button>
        </Card>

        <Card className="p-5">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-txt-primary">
            <ShieldCheck className="h-4 w-4" /> Certificado digital A1
          </h2>
          <p className="mt-1 text-xs text-txt-secondary">
            O certificado é enviado e guardado em cofre criptografado no servidor.
          </p>

          <div className="mt-4 rounded-sm border border-line bg-subtle p-4">
            <p className="text-xs font-medium text-txt-secondary">Empresa</p>
            <p className="mt-0.5 truncate text-sm font-semibold text-txt-primary">
              {selectedCompany?.nomeExibicao || selectedCompany?.razaoSocial || 'Nenhuma empresa selecionada'}
            </p>
            {certStatus?.cadastrado ? (
              <div className="mt-3 flex items-start gap-2 rounded-sm border border-success-border bg-success-soft p-3 text-xs text-success-fg">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  <p className="font-semibold">Certificado cadastrado no cofre</p>
                  <p className="mt-1">Titular: {certStatus.titular || '—'}</p>
                  <p>CNPJ: {certStatus.cnpj || '—'}</p>
                  <p>Validade: {certStatus.validade ? formatDate(certStatus.validade) : '—'}</p>
                </div>
              </div>
            ) : (
              <p className="mt-3 text-xs text-txt-muted">
                Certificado não cadastrado para a empresa selecionada.
              </p>
            )}
          </div>

          <div className="mt-4 space-y-3">
            <div>
              <label htmlFor="cert-file" className="mb-1.5 block text-xs font-medium text-txt-secondary">
                Arquivo do certificado (.pfx / .p12)
              </label>
              <input
                id="cert-file"
                type="file"
                accept=".pfx,.p12"
                onChange={onCertFile}
                className="field h-10 w-full px-3 py-2 text-xs text-txt-secondary focus:border-accent focus:ring-2 focus:ring-accent focus:outline-none"
              />
            </div>
            <Input
              label="Senha do certificado"
              type="password"
              value={certPassword}
              onChange={(event) => setCertPassword(event.target.value)}
            />
            <Button size="sm" loading={uploading} loadingText="Enviando..." onClick={sendCertificate}>
              <Upload className="h-4 w-4" /> Enviar certificado ao cofre
            </Button>
          </div>
        </Card>

        <Card className="p-5">
          <h2 className="text-sm font-semibold text-txt-primary">Sobre</h2>
          <dl className="mt-4 space-y-3 text-sm">
            <div className="flex justify-between"><dt className="text-txt-muted">Sistema</dt><dd className="font-medium text-txt-primary">MyXml Web 0.1.0</dd></div>
            <div className="flex justify-between"><dt className="text-txt-muted">Modelo</dt><dd className="font-medium text-txt-primary">NFC-e (65)</dd></div>
          </dl>
        </Card>
      </div>
    </div>
  )
}
