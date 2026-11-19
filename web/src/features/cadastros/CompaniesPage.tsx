import { Building2, CheckCircle2, Pencil, Trash2, Upload } from 'lucide-react'
import { useCallback, useEffect, useState, type ChangeEvent } from 'react'
import { Button, Card, Input, Modal, Table, useToast, type Column } from '@/design-system'
import { useCompany } from '@/features/empresas/CompanyProvider'
import { formatDate, maskCnpj, onlyDigits } from '@/lib/masks'
import { isApiConfigured } from '@/services/config'
import { cadastrosService, type CompanyRecord } from '@/services/cadastros.service'

const emptyForm = { cnpj: '', razaoSocial: '', nomeExibicao: '', certValidade: '' }

export function CompaniesPage() {
  const { success, error: showError, info } = useToast()
  const { refreshCompanies } = useCompany()
  const [companies, setCompanies] = useState<CompanyRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [fileName, setFileName] = useState('')
  const [certFile, setCertFile] = useState<File | null>(null)
  const [password, setPassword] = useState('')
  const [validating, setValidating] = useState(false)
  const [validated, setValidated] = useState(false)
  const [deleting, setDeleting] = useState<CompanyRecord | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setCompanies(await cadastrosService.listCompanies())
    setLoading(false)
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  const openNew = () => {
    setEditingId(null)
    setForm(emptyForm)
    setFileName('')
    setCertFile(null)
    setPassword('')
    setValidated(false)
    setModalOpen(true)
  }

  const openEdit = (company: CompanyRecord) => {
    setEditingId(company.id)
    setForm({
      cnpj: company.cnpj,
      razaoSocial: company.razaoSocial,
      nomeExibicao: company.nomeExibicao,
      certValidade: company.certValidade,
    })
    setFileName('certificado.pfx')
    setValidated(true)
    setModalOpen(true)
  }

  const onFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    setFileName(file.name)
    setCertFile(file)
    setValidated(false)
  }

  const validateCertificate = async () => {
    if (!fileName) {
      showError('Selecione o certificado', 'Escolha o arquivo .pfx antes de validar.')
      return
    }
    if (!password.trim()) {
      showError('Senha obrigatória', 'Digite a senha do certificado.')
      return
    }
    setValidating(true)
    try {
      let dados = {
        cnpj: '30720420000103',
        razaoSocial: 'Villa Santa Maria Agro Ltda',
        validade: '2027-04-18T00:00:00Z',
      }
      if (isApiConfigured && certFile) {
        // A API lê o .pfx com cryptography e devolve os dados — nada fica no browser.
        dados = await cadastrosService.previewCertificate(certFile, password)
      } else {
        await new Promise((resolve) => setTimeout(resolve, 800))
      }
      setForm({
        cnpj: dados.cnpj,
        razaoSocial: dados.razaoSocial,
        nomeExibicao: dados.razaoSocial,
        certValidade: dados.validade.slice(0, 10),
      })
      setValidated(true)
      success('Certificado validado!', 'Os dados da empresa foram preenchidos automaticamente.')
    } catch (err) {
      showError('Não foi possível validar', err instanceof Error ? err.message : undefined)
    } finally {
      setValidating(false)
    }
  }

  const save = async () => {
    if (!form.cnpj.trim() || !form.razaoSocial.trim()) {
      showError('Dados incompletos', 'Valide o certificado ou preencha o CNPJ e a razão social.')
      return
    }
    const saved = await cadastrosService.saveCompany({
      id: editingId ?? crypto.randomUUID(),
      cnpj: onlyDigits(form.cnpj),
      razaoSocial: form.razaoSocial,
      nomeExibicao: form.nomeExibicao || form.razaoSocial,
      certValidade: form.certValidade,
    })

    if (isApiConfigured && certFile && password.trim()) {
      try {
        await cadastrosService.uploadCertificate(saved.id, certFile, password)
        success('Empresa e certificado salvos!', 'O certificado está no cofre criptografado.')
      } catch (err) {
        showError('Empresa salva, mas o certificado falhou', err instanceof Error ? err.message : undefined)
      }
    } else {
      success('Empresa salva com sucesso!')
    }
    setModalOpen(false)
    await refresh()
    await refreshCompanies()
  }

  const confirmDelete = async () => {
    if (!deleting) return
    await cadastrosService.deleteCompany(deleting.id)
    success('Empresa removida.')
    setDeleting(null)
    await refresh()
    await refreshCompanies()
  }

  const columns: Column<CompanyRecord>[] = [
    {
      key: 'company',
      header: 'Empresa',
      render: (row) => (
        <div>
          <p className="font-medium text-txt-primary">{row.nomeExibicao || row.razaoSocial}</p>
          <p className="text-xs text-txt-muted">{row.razaoSocial}</p>
        </div>
      ),
    },
    { key: 'cnpj', header: 'CNPJ', render: (row) => <span className="tabular">{maskCnpj(row.cnpj)}</span> },
    { key: 'validade', header: 'Validade', render: (row) => row.certValidade ? formatDate(row.certValidade) : '—' },
    {
      key: 'actions',
      header: 'Ações',
      render: (row) => (
        <div className="flex gap-1">
          <Button variant="ghost" size="icon" aria-label={`Editar ${row.nomeExibicao}`} onClick={() => openEdit(row)}>
            <Pencil className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" aria-label={`Excluir ${row.nomeExibicao}`} className="text-danger-fg" onClick={() => setDeleting(row)}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ),
    },
  ]

  return (
    <div>
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-sm bg-accent-soft text-primary-fg">
            <Building2 className="h-4 w-4" />
          </span>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-txt-primary">Empresas</h1>
            <p className="mt-1 text-sm text-txt-secondary">
              Cadastre a empresa já com o certificado digital — os dados são preenchidos automaticamente.
            </p>
          </div>
        </div>
        <Button onClick={openNew}><Upload className="h-4 w-4" /> Nova empresa com certificado</Button>
      </header>

      <Card className="p-4">
        <Table columns={columns} data={companies} isLoading={loading} rowKey={(row) => row.id} empty={<p className="py-10 text-center text-sm text-txt-muted">Nenhuma empresa cadastrada.</p>} />
      </Card>

      <Modal
        open={modalOpen}
        onOpenChange={setModalOpen}
        title={editingId ? 'Editar empresa' : 'Nova empresa com certificado'}
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setModalOpen(false)}>Cancelar</Button>
            <Button onClick={save}>Salvar empresa</Button>
          </>
        }
      >
        <div className="grid gap-5 sm:grid-cols-2">
          <div className="rounded-sm border border-line bg-subtle p-4 sm:col-span-2">
            <div className="flex flex-wrap items-center gap-3">
              <label className="cursor-pointer">
                <input type="file" accept=".pfx,.p12" className="sr-only" onChange={onFile} />
                <span className="inline-flex h-10 items-center gap-2 rounded-sm border border-line-strong bg-surface px-4 text-sm font-medium text-txt-primary hover:bg-hover">
                  <Upload className="h-4 w-4" /> Selecionar .pfx
                </span>
              </label>
              <span className="text-sm text-txt-secondary">{fileName || 'Nenhum arquivo selecionado'}</span>
              <Button variant="secondary" size="sm" loading={validating} loadingText="Validando..." onClick={validateCertificate}>
                <CheckCircle2 className="h-4 w-4" /> Validar certificado
              </Button>
            </div>
            <div className="mt-3">
              <Input label="Senha do certificado" type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
            </div>
            {validated && (
              <p className="mt-3 flex items-center gap-1.5 text-xs text-success-fg">
                <CheckCircle2 className="h-3.5 w-3.5" /> Dados extraídos do certificado e preenchidos abaixo.
              </p>
            )}
          </div>

          <Input label="CNPJ" value={maskCnpj(form.cnpj)} onChange={(event) => setForm({ ...form, cnpj: onlyDigits(event.target.value) })} />
          <Input label="Validade do certificado" placeholder="AAAA-MM-DD" value={form.certValidade} onChange={(event) => setForm({ ...form, certValidade: event.target.value })} />
          <Input label="Razão social" containerClassName="sm:col-span-2" value={form.razaoSocial} onChange={(event) => setForm({ ...form, razaoSocial: event.target.value })} />
          <Input label="Nome de exibição" containerClassName="sm:col-span-2" value={form.nomeExibicao} onChange={(event) => setForm({ ...form, nomeExibicao: event.target.value })} />
        </div>
      </Modal>

      <Modal
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Confirmar exclusão"
        description={`Excluir a empresa "${deleting?.nomeExibicao ?? ''}"?`}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeleting(null)}>Cancelar</Button>
            <Button variant="danger" onClick={confirmDelete}>Excluir</Button>
          </>
        }
      >
        <p className="text-sm text-txt-secondary">O certificado cadastrado também será removido do cofre.</p>
      </Modal>
    </div>
  )
}
