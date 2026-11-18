import type { LucideIcon } from 'lucide-react'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import {
  Button,
  Card,
  Input,
  Modal,
  Table,
  useToast,
  type Column,
} from '@/design-system'

export interface CrudField<T> {
  key: keyof T & string
  label: string
  type?: string
  required?: boolean
  format?: (value: string) => string
  parse?: (value: string) => unknown
  placeholder?: string
}

interface SimpleCrudPageProps<T extends { id: string }> {
  title: string
  description: string
  icon: LucideIcon
  newLabel: string
  load: () => Promise<T[]>
  save: (item: T) => Promise<unknown>
  remove: (id: string) => Promise<void>
  columns: Column<T>[]
  fields: CrudField<T>[]
  createEmpty: () => T
  identifier: (item: T) => string
}

export function SimpleCrudPage<T extends { id: string }>({
  title,
  description,
  icon: Icon,
  newLabel,
  load,
  save,
  remove,
  columns,
  fields,
  createEmpty,
  identifier,
}: SimpleCrudPageProps<T>) {
  const { success, error: showError } = useToast()
  const [items, setItems] = useState<T[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<T | null>(null)
  const [form, setForm] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState<T | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setItems(await load())
    setLoading(false)
  }, [load])

  useEffect(() => { void refresh() }, [refresh])

  const openNew = () => {
    const empty = createEmpty()
    setEditing(empty)
    setForm(Object.fromEntries(fields.map((field) => [field.key, ''])))
  }

  const openEdit = (item: T) => {
    setEditing(item)
    setForm(Object.fromEntries(fields.map((field) => [field.key, String(item[field.key] ?? '')])))
  }

  const submit = async () => {
    if (!editing) return
    const missing = fields.find((field) => field.required && !form[field.key]?.trim())
    if (missing) {
      showError('Campo obrigatório', `Informe: ${missing.label}.`)
      return
    }
    const payload = { ...editing } as Record<string, unknown>
    fields.forEach((field) => {
      payload[field.key] = field.parse ? field.parse(form[field.key] ?? '') : (form[field.key] ?? '')
    })
    setSaving(true)
    try {
      await save(payload as T)
      success('Salvo com sucesso!')
      await refresh()
      setEditing(null)
    } catch (err) {
      showError('Não foi possível salvar', err instanceof Error ? err.message : undefined)
    } finally {
      setSaving(false)
    }
  }

  const confirmDelete = async () => {
    if (!deleting) return
    try {
      await remove(deleting.id)
      success('Registro removido.')
      await refresh()
    } catch (err) {
      showError('Não foi possível remover', err instanceof Error ? err.message : undefined)
    } finally {
      setDeleting(null)
    }
  }

  const tableColumns: Column<T>[] = [
    ...columns,
    {
      key: 'actions',
      header: 'Ações',
      render: (row) => (
        <div className="flex gap-1">
          <Button variant="ghost" size="icon" aria-label={`Editar ${identifier(row)}`} onClick={() => openEdit(row)}>
            <Pencil className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" aria-label={`Excluir ${identifier(row)}`} className="text-danger-fg" onClick={() => setDeleting(row)}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ),
    },
  ]

  return (
    <div>
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-sm bg-accent-soft text-primary-fg">
              <Icon className="h-4 w-4" />
            </span>
            <h1 className="text-2xl font-semibold tracking-tight text-txt-primary">{title}</h1>
          </div>
          <p className="mt-2 text-sm text-txt-secondary">{description}</p>
        </div>
        <Button onClick={openNew}><Plus className="h-4 w-4" /> {newLabel}</Button>
      </header>

      <Card className="p-4">
        <Table
          columns={tableColumns}
          data={items}
          isLoading={loading}
          rowKey={(row) => row.id}
          empty={
            <div className="rounded-sm border border-dashed border-line px-6 py-14 text-center">
              <Icon className="mx-auto h-8 w-8 text-txt-muted" />
              <p className="mt-3 text-sm font-medium text-txt-primary">Nenhum registro encontrado</p>
              <p className="mt-1 text-xs text-txt-secondary">Cadastre o primeiro item para começar.</p>
            </div>
          }
        />
      </Card>

      <Modal
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
        title={newLabel}
        description="Preencha os dados abaixo. Alterações são salvas somente nesta demonstração."
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)}>Cancelar</Button>
            <Button loading={saving} loadingText="Salvando..." onClick={submit}>Salvar</Button>
          </>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          {fields.map((field) => (
            <Input
              key={field.key}
              label={field.label}
              type={field.type ?? 'text'}
              placeholder={field.placeholder}
              containerClassName={field.key === 'endereco' || field.key === 'descricao' ? 'sm:col-span-2' : undefined}
              value={field.format ? field.format(form[field.key] ?? '') : (form[field.key] ?? '')}
              onChange={(event) => setForm((current) => ({ ...current, [field.key]: event.target.value }))}
            />
          ))}
        </div>
      </Modal>

      <Modal
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Confirmar exclusão"
        description={`Tem certeza que deseja excluir "${deleting ? identifier(deleting) : ''}"?`}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeleting(null)}>Cancelar</Button>
            <Button variant="danger" onClick={confirmDelete}>Excluir</Button>
          </>
        }
      >
        <p className="text-sm text-txt-secondary">Esta ação não pode ser desfeita nesta demonstração.</p>
      </Modal>
    </div>
  )
}
