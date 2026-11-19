/* NFS-e Nacional (ADN) — somente consulta/download. */

import { formatDate } from '@/lib/masks'
import { apiDownload, apiRequest } from './api.client'
import { isApiConfigured } from './config'

export interface NfseNote {
  id: string
  companyId: string
  nsu: number
  chave: string
  numero: string
  serie: string
  emitidaEm: string | null
  valor: number
  situacao: 'autorizada' | 'cancelada'
  prestadorCnpj: string
  tomadorCnpj: string
  storagePath: string | null
  eventos: string | null
}

export interface NfseJob {
  id: string
  status: 'executando' | 'concluido' | 'com_erros' | 'falhou' | 'interrompido'
  progresso: number
  baixadas: number
  ja_existiam: number
  erros: number
  mensagem: string | null
  log: string | null
  nsuIni: number
  nsuFim: number
}

type NfseRow = Record<string, unknown>

function mapNote(row: NfseRow): NfseNote {
  return {
    id: String(row.id),
    companyId: String(row.company_id),
    nsu: Number(row.nsu),
    chave: String(row.chave ?? ''),
    numero: String(row.numero ?? ''),
    serie: String(row.serie ?? ''),
    emitidaEm: row.emitida_em ? String(row.emitida_em) : null,
    valor: Number(row.valor ?? 0),
    situacao: String(row.situacao ?? 'autorizada') as NfseNote['situacao'],
    prestadorCnpj: String(row.prestador_cnpj ?? ''),
    tomadorCnpj: String(row.tomador_cnpj ?? ''),
    storagePath: row.storage_path ? String(row.storage_path) : null,
    eventos: row.eventos ? String(row.eventos) : null,
  }
}

export function formatarChaveNfse(chave: string): string {
  return chave.replace(/(\d{4})(\d{3})(\d{3})(\d{4})(\d{4})(\d{4})(\d{4})/, '$1 $2 $3 $4 $5 $6 $7')
}

export function formatarDataNfse(data: string | null): string {
  return data ? formatDate(data) : '—'
}

export const nfseService = {
  async config(): Promise<{ habilitado: boolean; ambiente: string }> {
    if (!isApiConfigured) return { habilitado: false, ambiente: 'homologacao' }
    return apiRequest('/nfse/config')
  },

  async list(companyId?: string): Promise<NfseNote[]> {
    if (!isApiConfigured) return []
    const sufixo = companyId ? `?company_id=${encodeURIComponent(companyId)}` : ''
    const resposta = await apiRequest<{ items: NfseRow[] }>(`/nfse/notes${sufixo}`)
    return (resposta.items ?? []).map(mapNote)
  },

  async startDownload(companyId: string, nsuIni?: number, nsuFim?: number): Promise<NfseJob> {
    const resposta = await apiRequest<NfseRow>('/nfse/downloads', {
      method: 'POST',
      body: JSON.stringify({
        company_id: companyId,
        nsu_ini: nsuIni ?? 0,
        nsu_fim: nsuFim ?? 0,
      }),
    })
    return {
      id: String(resposta.id),
      status: String(resposta.status ?? 'executando') as NfseJob['status'],
      progresso: Number(resposta.progresso ?? 0),
      baixadas: Number(resposta.baixadas ?? 0),
      ja_existiam: Number(resposta.ja_existiam ?? 0),
      erros: Number(resposta.erros ?? 0),
      mensagem: resposta.mensagem ? String(resposta.mensagem) : null,
      log: resposta.log ? String(resposta.log) : null,
      nsuIni: Number(resposta.nsu_ini ?? 0),
      nsuFim: Number(resposta.nsu_fim ?? 0),
    }
  },

  async getJob(jobId: string): Promise<NfseJob> {
    const resposta = await apiRequest<NfseRow>(`/nfse/downloads/${jobId}`)
    return {
      id: String(resposta.id),
      status: String(resposta.status ?? 'executando') as NfseJob['status'],
      progresso: Number(resposta.progresso ?? 0),
      baixadas: Number(resposta.baixadas ?? 0),
      ja_existiam: Number(resposta.ja_existiam ?? 0),
      erros: Number(resposta.erros ?? 0),
      mensagem: resposta.mensagem ? String(resposta.mensagem) : null,
      log: resposta.log ? String(resposta.log) : null,
      nsuIni: Number(resposta.nsu_ini ?? 0),
      nsuFim: Number(resposta.nsu_fim ?? 0),
    }
  },

  async cancelJob(jobId: string): Promise<void> {
    await apiRequest(`/nfse/downloads/${jobId}/cancel`, { method: 'POST' })
  },

  async resumeJob(jobId: string): Promise<void> {
    await apiRequest(`/nfse/downloads/${jobId}/run`, { method: 'POST' })
  },

  async downloadXml(noteId: string): Promise<void> {
    await apiDownload(`/nfse/notes/${noteId}/xml`, `NFS-e-${noteId}.xml`)
  },
}
