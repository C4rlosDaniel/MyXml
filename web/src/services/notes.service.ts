import type { Note, NoteStatus } from '@/types'
import { apiDownload } from './api.client'
import { isApiConfigured, isMockMode } from './config'
import { supabase } from './supabase'

/* ============================================================
   Notas — dados mockados ou Supabase (conforme .env.local).
   Nenhuma regra fiscal aqui.
   ============================================================ */

const mockNotes: Note[] = [
  {
    id: 'n-001', companyId: 'co-1', chave: '35261130720420000103650010000001231000000010',
    numero: '123', serie: '1', modelo: '65', emitidaEm: '2026-11-18T14:32:00',
    valor: 258.9, situacao: 'autorizada', clientName: 'Villa Santa Maria Ltda',
  },
  {
    id: 'n-002', companyId: 'co-1', chave: '35261130720420000103650010000001221000000020',
    numero: '122', serie: '1', modelo: '65', emitidaEm: '2026-11-18T11:07:00',
    valor: 119.5, situacao: 'autorizada', clientName: 'Agropecuária Central',
  },
  {
    id: 'n-003', companyId: 'co-1', chave: '35261130720420000103650010000001211000000030',
    numero: '121', serie: '1', modelo: '65', emitidaEm: '2026-11-17T18:45:00',
    valor: 432.0, situacao: 'rejeitada', clientName: 'Mercado Bom Preço',
  },
  {
    id: 'n-004', companyId: 'co-1', chave: '35261130720420000103650010000001201000000040',
    numero: '120', serie: '1', modelo: '65', emitidaEm: '2026-11-17T09:12:00',
    valor: 87.35, situacao: 'autorizada', clientName: 'Villa Santa Maria Ltda',
  },
  {
    id: 'n-005', companyId: 'co-1', chave: '35261130720420000103650010000001191000000050',
    numero: '119', serie: '1', modelo: '65', emitidaEm: '2026-11-16T16:20:00',
    valor: 156.8, situacao: 'enviada', clientName: 'Transportes Rápidos',
  },
  {
    id: 'n-006', companyId: 'co-1', chave: '35261130720420000103650010000001181000000060',
    numero: '118', serie: '1', modelo: '65', emitidaEm: '2026-11-15T13:55:00',
    valor: 64.9, situacao: 'cancelada', clientName: 'Loja do Bairro',
  },
  {
    id: 'n-007', companyId: 'co-1', chave: '35261130720420000103650010000001171000000070',
    numero: '117', serie: '1', modelo: '65', emitidaEm: '2026-11-14T10:03:00',
    valor: 312.45, situacao: 'autorizada', clientName: 'Agropecuária Central',
  },
  {
    id: 'n-008', companyId: 'co-1', chave: '35261130720420000103650010000001161000000080',
    numero: '116', serie: '1', modelo: '65', emitidaEm: '2026-11-13T08:41:00',
    valor: 95.0, situacao: 'rascunho', clientName: 'Mercado Bom Preço',
  },
  // Mês anterior (usado apenas para calcular as variações do dashboard).
  {
    id: 'n-009', companyId: 'co-1', chave: '35261030720420000103650010000001151000000090',
    numero: '115', serie: '1', modelo: '65', emitidaEm: '2026-10-28T15:10:00',
    valor: 210.0, situacao: 'autorizada', clientName: 'Agropecuária Central',
  },
  {
    id: 'n-010', companyId: 'co-1', chave: '35261030720420000103650010000001141000000100',
    numero: '114', serie: '1', modelo: '65', emitidaEm: '2026-10-22T10:25:00',
    valor: 175.5, situacao: 'rejeitada', clientName: 'Mercado Bom Preço',
  },
]

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

type NoteRow = Record<string, unknown> & { companies?: { razao_social?: string | null } | null }

function mapRow(row: NoteRow): Note {
  const company = row.companies
  return {
    id: String(row.id),
    companyId: String(row.company_id),
    chave: String(row.chave ?? ''),
    numero: String(row.numero ?? ''),
    serie: String(row.serie ?? ''),
    modelo: String(row.modelo ?? '65'),
    emitidaEm: String(row.emitida_em ?? new Date().toISOString()),
    valor: Number(row.valor ?? 0),
    situacao: String(row.situacao ?? 'rascunho') as NoteStatus,
    clientName: String(row.client_name ?? company?.razao_social ?? ''),
  }
}

export const notesService = {
  async list(): Promise<Note[]> {
    if (!isMockMode && supabase) {
      // RLS no Supabase limita as notas às empresas do usuário.
      const { data, error } = await supabase
        .from('notes')
        .select('id, company_id, chave, numero, serie, modelo, emitida_em, valor, situacao, client_name, companies(razao_social)')
        .order('emitida_em', { ascending: false })

      if (error) throw new Error('Não foi possível carregar as notas.')
      return (data ?? []).map((row) => mapRow(row as NoteRow))
    }

    await delay(250)
    return [...mockNotes]
  },

  async getById(id: string): Promise<Note | null> {
    if (!isMockMode && supabase) {
      const { data, error } = await supabase
        .from('notes')
        .select('id, company_id, chave, numero, serie, modelo, emitida_em, valor, situacao, client_name, companies(razao_social)')
        .eq('id', id)
        .maybeSingle()
      if (error) throw new Error('Não foi possível carregar a nota.')
      return data ? mapRow(data as NoteRow) : null
    }

    await delay(150)
    return mockNotes.find((note) => note.id === id) ?? null
  },

  /** Baixa o XML original da nota, lido do Storage pela API. */
  async downloadXml(noteId: string): Promise<void> {
    if (!isApiConfigured) throw new Error('O download do XML estará disponível em instantes.')
    await apiDownload(`/notes/${noteId}/xml`, `NFCe-${noteId}.xml`)
  },
}
