import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import {
  Download,
  FileSearch,
  MoreHorizontal,
  Plus,
  Search,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Card, StatusBadge, Table, useToast, type Column } from '@/design-system'
import { useCompany } from '@/features/empresas/CompanyProvider'
import { formatChaveNfe, formatCurrency, formatDate } from '@/lib/masks'
import { notesService } from '@/services/notes.service'
import type { Note, NoteStatus } from '@/types'

const statusOptions: { value: NoteStatus | 'todos'; label: string }[] = [
  { value: 'todos', label: 'Todos os status' },
  { value: 'rascunho', label: 'Rascunho' },
  { value: 'enviada', label: 'Enviada' },
  { value: 'autorizada', label: 'Autorizada' },
  { value: 'rejeitada', label: 'Rejeitada' },
  { value: 'cancelada', label: 'Cancelada' },
]

const periodOptions = [
  { value: '30', label: 'Últimos 30 dias' },
  { value: '90', label: 'Últimos 90 dias' },
  { value: '365', label: 'Último ano' },
  { value: 'todos', label: 'Todo o período' },
]

const sortOptions = [
  { value: 'emissao-desc', label: 'Mais recentes' },
  { value: 'emissao-asc', label: 'Mais antigas' },
  { value: 'valor-desc', label: 'Maior valor' },
  { value: 'valor-asc', label: 'Menor valor' },
]

const PAGE_SIZE = 5

const selectClass =
  'field h-10 rounded-sm px-3 text-sm text-txt-primary focus:border-accent focus:ring-2 focus:ring-accent focus:outline-none'

export function NotesPage() {
  const navigate = useNavigate()
  const { success, error: showError } = useToast()
  const { selectedCompany, selectedCompanyId } = useCompany()
  const [notes, setNotes] = useState<Note[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<NoteStatus | 'todos'>('todos')
  const [period, setPeriod] = useState('30')
  const [sort, setSort] = useState('emissao-desc')
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const baixarXml = async (noteId: string) => {
    try {
      await notesService.downloadXml(noteId)
      success('XML baixado!', 'Enviado para a pasta Downloads do navegador.')
    } catch (err) {
      showError('Não foi possível baixar o XML', err instanceof Error ? err.message : undefined)
    }
  }

  useEffect(() => {
    notesService.list().then((data) => {
      setNotes(data)
      setLoading(false)
    })
  }, [])

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    const cutoff = new Date()
    if (period !== 'todos') cutoff.setDate(cutoff.getDate() - Number(period))

    const result = notes.filter((note) => {
      if (note.companyId !== selectedCompanyId) return false
      if (status !== 'todos' && note.situacao !== status) return false
      if (period !== 'todos' && new Date(note.emitidaEm) < cutoff) return false
      if (!term) return true
      return [note.numero, note.chave, note.clientName ?? ''].some((field) =>
        field.toLowerCase().includes(term),
      )
    })

    const [field, direction] = sort.split('-')
    return result.sort((a, b) => {
      const left = field === 'valor' ? a.valor : new Date(a.emitidaEm).getTime()
      const right = field === 'valor' ? b.valor : new Date(b.emitidaEm).getTime()
      return direction === 'asc' ? left - right : right - left
    })
  }, [notes, selectedCompanyId, search, status, period, sort])

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const currentPage = Math.min(page, pageCount)
  const pageRows = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)

  const toggleRow = (id: string) => {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const togglePage = () => {
    const allSelected = pageRows.every((row) => selected.has(row.id))
    setSelected((current) => {
      const next = new Set(current)
      pageRows.forEach((row) => (allSelected ? next.delete(row.id) : next.add(row.id)))
      return next
    })
  }

  const clearFilters = () => {
    setSearch('')
    setStatus('todos')
    setPeriod('30')
    setSort('emissao-desc')
    setPage(1)
  }

  const columns: Column<Note>[] = [
    {
      key: 'select',
      header: 'Selecionar',
      headerRender: () => (
        <input
          type="checkbox"
          aria-label="Selecionar todas as notas da página"
          checked={pageRows.length > 0 && pageRows.every((row) => selected.has(row.id))}
          onChange={togglePage}
          className="h-4 w-4 accent-[var(--primary)]"
        />
      ),
      render: (row) => (
        <input
          type="checkbox"
          aria-label={`Selecionar nota ${row.numero}`}
          checked={selected.has(row.id)}
          onChange={() => toggleRow(row.id)}
          className="h-4 w-4 accent-[var(--primary)]"
        />
      ),
      headerClassName: 'w-10',
      cellClassName: 'w-10',
    },
    {
      key: 'numero',
      header: 'Número',
      render: (row) => (
        <div>
          <p className="tabular font-medium text-txt-primary">Nº {row.numero}</p>
          <p className="font-mono text-xs text-txt-muted">Série {row.serie}</p>
        </div>
      ),
    },
    {
      key: 'cliente',
      header: 'Cliente',
      render: (row) => <span className="truncate">{row.clientName ?? '—'}</span>,
    },
    {
      key: 'chave',
      header: 'Chave de acesso',
      render: (row) => (
        <span className="font-mono text-xs tabular text-txt-muted">{formatChaveNfe(row.chave)}</span>
      ),
    },
    {
      key: 'valor',
      header: 'Valor',
      render: (row) => <span className="tabular text-right font-medium">{formatCurrency(row.valor)}</span>,
      headerClassName: 'text-right',
      cellClassName: 'text-right',
    },
    {
      key: 'status',
      header: 'Situação',
      render: (row) => <StatusBadge status={row.situacao} />,
    },
    {
      key: 'emissao',
      header: 'Emissão',
      render: (row) => <span className="tabular">{formatDate(row.emitidaEm, true)}</span>,
    },
    {
      key: 'acoes',
      header: '',
      render: (row) => (
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button
              aria-label={`Ações da nota ${row.numero}`}
              className="focus-ring rounded-sm p-1.5 text-txt-muted hover:bg-hover hover:text-txt-primary"
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              align="end"
              sideOffset={4}
              className="surface-raised z-50 min-w-48 p-1 shadow-md"
            >
              <DropdownMenu.Item
                className="cursor-pointer rounded-sm px-3 py-2 text-sm outline-none data-[highlighted]:bg-hover"
                onSelect={() => navigate(`/notas/${row.id}`)}
              >
                Ver detalhe
              </DropdownMenu.Item>
              <DropdownMenu.Item
                className="flex cursor-pointer items-center gap-2 rounded-sm px-3 py-2 text-sm outline-none data-[highlighted]:bg-hover"
                onSelect={() => void baixarXml(row.id)}
              >
                <Download className="h-4 w-4" /> Baixar XML
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      ),
    },
  ]

  return (
    <div>
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-txt-primary">Notas fiscais</h1>
          <p className="mt-1 text-sm text-txt-secondary">
            Notas de {selectedCompany?.nomeExibicao || selectedCompany?.razaoSocial || '—'} —{' '}
            {filtered.length} resultado(s) no período.
          </p>
        </div>
        <Button onClick={() => navigate('/baixar')}>
          <Download className="h-4 w-4" /> Baixar notas
        </Button>
      </header>

      <Card className="mb-4 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-txt-muted" />
            <input
              type="search"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value)
                setPage(1)
              }}
              placeholder="Buscar por número, chave ou cliente"
              aria-label="Buscar notas"
              className="field h-10 w-full pl-9 pr-3 text-sm focus:border-accent focus:ring-2 focus:ring-accent focus:outline-none"
            />
          </div>

          <select
            aria-label="Filtrar por status"
            className={selectClass}
            value={status}
            onChange={(event) => {
              setStatus(event.target.value as NoteStatus | 'todos')
              setPage(1)
            }}
          >
            {statusOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>

          <select
            aria-label="Filtrar por período"
            className={selectClass}
            value={period}
            onChange={(event) => {
              setPeriod(event.target.value)
              setPage(1)
            }}
          >
            {periodOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>

          <select
            aria-label="Ordenar notas"
            className={selectClass}
            value={sort}
            onChange={(event) => setSort(event.target.value)}
          >
            {sortOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>

          {(search || status !== 'todos' || period !== '30') && (
            <Button variant="ghost" size="sm" onClick={clearFilters}>
              <X className="h-4 w-4" /> Limpar
            </Button>
          )}
        </div>

        {selected.size > 0 && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-sm border border-accent-border bg-accent-soft px-3 py-2">
            <span className="text-sm font-medium text-primary-fg">
              {selected.size} {selected.size === 1 ? 'nota selecionada' : 'notas selecionadas'}
            </span>
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
                Limpar seleção
              </Button>
            </div>
          </div>
        )}
      </Card>

      <Table
        columns={columns}
        data={pageRows}
        isLoading={loading}
        rowKey={(row) => row.id}
        empty={
          <Card className="flex flex-col items-center px-6 py-14 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-subtle text-txt-muted">
              <FileSearch className="h-6 w-6" />
            </div>
            <p className="mt-4 text-sm font-semibold text-txt-primary">Nenhuma nota encontrada</p>
            <p className="mt-1 max-w-sm text-sm text-txt-secondary">
              Tente ajustar os filtros ou o período da consulta.
            </p>
            <Button variant="secondary" size="sm" className="mt-5" onClick={clearFilters}>
              Limpar filtros
            </Button>
          </Card>
        }
      />

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-txt-muted">
          {filtered.length === 0
            ? 'Nenhum resultado'
            : `Exibindo ${(currentPage - 1) * PAGE_SIZE + 1}–${Math.min(currentPage * PAGE_SIZE, filtered.length)} de ${filtered.length}`}
        </p>
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            disabled={currentPage === 1}
            onClick={() => setPage((value) => Math.max(1, value - 1))}
          >
            Anterior
          </Button>
          <span className="tabular text-sm text-txt-secondary">
            {currentPage} / {pageCount}
          </span>
          <Button
            variant="secondary"
            size="sm"
            disabled={currentPage === pageCount}
            onClick={() => setPage((value) => Math.min(pageCount, value + 1))}
          >
            Próxima
          </Button>
        </div>
      </div>
    </div>
  )
}
