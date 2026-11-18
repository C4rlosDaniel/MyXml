import { BadgeCheck, Save, Settings2, ShieldCheck, Upload } from 'lucide-react'
import { useState } from 'react'
import { Button, Card, Input, useToast } from '@/design-system'
import { isMockMode } from '@/services/config'

export function SettingsPage() {
  const { success, info } = useToast()
  const [serie, setSerie] = useState(localStorage.getItem('myfly-serie') ?? '1')
  const [proximoNumero, setProximoNumero] = useState(localStorage.getItem('myfly-numero') ?? '100')
  const [ambiente, setAmbiente] = useState<'homologacao' | 'producao'>('homologacao')

  const save = () => {
    localStorage.setItem('myfly-serie', serie)
    localStorage.setItem('myfly-numero', proximoNumero)
    success('Configurações salvas nesta demonstração.')
  }

  return (
    <div>
      <header className="mb-6 flex items-center gap-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-sm bg-accent-soft text-primary-fg">
          <Settings2 className="h-4 w-4" />
        </span>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-txt-primary">Configurações</h1>
          <p className="mt-1 text-sm text-txt-secondary">Ambiente, numeração, certificado e preferências.</p>
        </div>
      </header>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="text-sm font-semibold text-txt-primary">Ambiente</h2>
          <p className="mt-0.5 text-xs text-txt-secondary">O ambiente define se as notas são reais ou de teste.</p>
          <div className={`mt-4 flex items-center gap-2 rounded-sm border p-3 ${ambiente === 'producao' ? 'border-success-border bg-success-soft text-success-fg' : 'border-warning-border bg-warning-soft text-warning-fg'}`}>
            <BadgeCheck className="h-5 w-5" />
            <div>
              <p className="text-sm font-semibold">{ambiente === 'producao' ? 'Produção' : 'Homologação'}</p>
              <p className="text-xs">{ambiente === 'producao' ? 'Notas com validade fiscal real.' : 'Ambiente de testes — sem validade fiscal.'}</p>
            </div>
          </div>
          <div className="mt-4 flex gap-2">
            <Button variant={ambiente === 'homologacao' ? 'primary' : 'secondary'} size="sm" onClick={() => setAmbiente('homologacao')}>Homologação</Button>
            <Button variant={ambiente === 'producao' ? 'primary' : 'secondary'} size="sm" onClick={() => setAmbiente('producao')}>Produção</Button>
          </div>
        </Card>

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
            O certificado é enviado à API e guardado em cofre criptografado no servidor.
          </p>
          <div className="mt-4 rounded-sm border border-dashed border-line p-6 text-center">
            <Upload className="mx-auto h-6 w-6 text-txt-muted" />
            <p className="mt-2 text-sm text-txt-primary">Nenhum certificado nesta demonstração</p>
            <Button variant="secondary" size="sm" className="mt-4" onClick={() => info('Upload disponível com a API conectada.')}>Selecionar arquivo .pfx</Button>
          </div>
        </Card>

        <Card className="p-5">
          <h2 className="text-sm font-semibold text-txt-primary">Sobre</h2>
          <dl className="mt-4 space-y-3 text-sm">
            <div className="flex justify-between"><dt className="text-txt-muted">Sistema</dt><dd className="font-medium text-txt-primary">MyFly Web 0.1.0</dd></div>
            <div className="flex justify-between"><dt className="text-txt-muted">Modelo</dt><dd className="font-medium text-txt-primary">NFC-e (65)</dd></div>
            <div className="flex justify-between"><dt className="text-txt-muted">Modo</dt><dd className="font-medium text-txt-primary">{isMockMode ? 'Demonstração' : 'Conectado'}</dd></div>
          </dl>
        </Card>
      </div>
    </div>
  )
}
