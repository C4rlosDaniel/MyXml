/* ============================================================
   Empresas, histórico e downloads — modo demo (memória) ou Supabase.
   ============================================================ */

import { apiDownload, apiRequest, apiUpload } from './api.client'
import { isApiConfigured, isMockMode } from './config'
import { supabase } from './supabase'

export interface CompanyRecord {
  id: string
  cnpj: string
  razaoSocial: string
  nomeExibicao: string
  certValidade: string
}

export interface RunRecord {
  id: string
  companyId: string
  company: string
  period: string
  startedAt: string
  status: 'concluido' | 'com_erros' | 'executando' | 'falhou'
  downloaded: number
  errors: number
  user: string
}

export interface DownloadJob {
  id: string
  status: RunRecord['status']
  progresso: number
  baixadas: number
  ja_existiam: number
  erros: number
  mensagem: string | null
  log: string | null
}

let companies: CompanyRecord[] = [
  { id: 'co-1', cnpj: '30720420000103', razaoSocial: 'Villa Santa Maria Agro Ltda', nomeExibicao: 'Villa Santa Maria', certValidade: '2027-04-18' },
  // Segunda empresa de demonstração (sem notas) para validar o filtro por empresa.
  { id: 'co-2', cnpj: '12345678000190', razaoSocial: 'Agropecuária Central', nomeExibicao: 'Agropecuária Central', certValidade: '2027-08-10' },
]

const runs: RunRecord[] = [
  { id: 'run-1', companyId: 'co-1', company: 'Villa Santa Maria', period: '10/2026', startedAt: '2026-11-01T08:30:00', status: 'concluido', downloaded: 128, errors: 0, user: 'contador@myxml.com.br' },
  { id: 'run-2', companyId: 'co-1', company: 'Villa Santa Maria', period: '09/2026', startedAt: '2026-10-01T09:12:00', status: 'com_erros', downloaded: 96, errors: 2, user: 'contador@myxml.com.br' },
  { id: 'run-3', companyId: 'co-1', company: 'Villa Santa Maria', period: '08/2026', startedAt: '2026-09-01T08:05:00', status: 'concluido', downloaded: 110, errors: 0, user: 'admin@myxml.com.br' },
]

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const live = () => !isMockMode && supabase !== null

const mapCompany = (row: Record<string, unknown>): CompanyRecord => ({
  id: String(row.id), cnpj: String(row.cnpj ?? ''), razaoSocial: String(row.razao_social ?? ''),
  nomeExibicao: String(row.nome_exibicao ?? ''), certValidade: String(row.cert_validade ?? ''),
})

const mapRun = (row: Record<string, unknown>): RunRecord => {
  const company = row.companies as { razao_social?: string; nome_exibicao?: string } | null
  const user = row.profiles as { full_name?: string } | null
  return {
    id: String(row.id), companyId: String(row.company_id ?? ''),
    company: String(company?.nome_exibicao ?? company?.razao_social ?? ''),
    period: String(row.periodo_ini ?? ''), startedAt: String(row.started_at ?? ''),
    status: String(row.status ?? 'executando') as RunRecord['status'],
    downloaded: Number(row.baixadas ?? 0), errors: Number(row.erros ?? 0),
    user: String(user?.full_name ?? ''),
  }
}

export const cadastrosService = {
  async listCompanies(): Promise<CompanyRecord[]> {
    if (live()) {
      const { data, error } = await supabase!.from('companies').select('*').order('razao_social')
      if (error) throw new Error('Não foi possível carregar as empresas.')
      return (data ?? []).map((row) => mapCompany(row as Record<string, unknown>))
    }
    await delay(180)
    return [...companies]
  },

  async saveCompany(company: CompanyRecord, isNew = true): Promise<CompanyRecord> {
    const corpo = {
      cnpj: company.cnpj,
      razao_social: company.razaoSocial,
      nome_exibicao: company.nomeExibicao,
      cert_validade: company.certValidade || null,
    }
    // Escrita passa pela API: a RLS do Supabase só permite admin escrever em
    // companies, e o contador precisa cadastrar/editar a própria empresa.
    if (isApiConfigured) {
      const linha = isNew
        ? await apiRequest<Record<string, unknown>>('/companies', {
            method: 'POST', body: JSON.stringify(corpo),
          })
        : await apiRequest<Record<string, unknown>>(`/companies/${company.id}`, {
            method: 'PATCH', body: JSON.stringify(corpo),
          })
      return { ...company, ...mapCompany(linha) }
    }
    if (live()) {
      const { error } = await supabase!.from('companies').upsert({
        id: company.id, cnpj: company.cnpj, razao_social: company.razaoSocial,
        nome_exibicao: company.nomeExibicao, cert_validade: company.certValidade || null,
      })
      if (error) throw new Error('Não foi possível salvar a empresa.')
      return company
    }
    companies = companies.some((item) => item.id === company.id)
      ? companies.map((item) => (item.id === company.id ? company : item))
      : [company, ...companies]
    return company
  },

  async deleteCompany(id: string): Promise<void> {
    if (isApiConfigured) {
      await apiRequest(`/companies/${id}`, { method: 'DELETE' })
      return
    }
    if (live()) {
      const { error } = await supabase!.from('companies').delete().eq('id', id)
      if (error) throw new Error('Não foi possível remover a empresa.')
      return
    }
    companies = companies.filter((item) => item.id !== id)
  },

  async listRuns(): Promise<RunRecord[]> {
    if (live()) {
      const { data, error } = await supabase!
        .from('download_runs')
        .select('*, companies(razao_social, nome_exibicao), profiles(full_name)')
        .order('started_at', { ascending: false })
      if (error) throw new Error('Não foi possível carregar o histórico.')
      return (data ?? []).map((row) => mapRun(row as Record<string, unknown>))
    }
    await delay(180)
    return [...runs]
  },

  async startDownload(companyId: string, period: string): Promise<{ jobId: string }> {
    if (isApiConfigured) {
      const result = await apiRequest<{ id: string }>('/downloads', {
        method: 'POST',
        body: JSON.stringify({ company_id: companyId, period }),
      })
      return { jobId: result.id }
    }
    await delay(300)
    return { jobId: `job-${Date.now()}` }
  },

  async getDownloadJob(jobId: string): Promise<DownloadJob> {
    return apiRequest<DownloadJob>(`/downloads/${jobId}`)
  },

  /** Encerra a execução no servidor quando o usuário troca de aba. */
  async cancelDownload(jobId: string): Promise<void> {
    if (!isApiConfigured) return
    await apiRequest(`/downloads/${jobId}/cancel`, { method: 'POST' })
  },

  async exportExcel(jobId: string): Promise<void> {
    await apiDownload(`/downloads/${jobId}/excel`, `NFCe-${jobId}.xlsx`)
  },

  /** ZIP com os XMLs originais gravados pela execução. */
  async downloadXmls(jobId: string): Promise<void> {
    await apiDownload(`/downloads/${jobId}/xml`, `NFCe-${jobId}.zip`)
  },

  async previewCertificate(
    file: File,
    password: string,
  ): Promise<{ cnpj: string; razaoSocial: string; validade: string }> {
    const form = new FormData()
    form.append('arquivo', file)
    form.append('senha', password)
    return apiUpload('/companies/certificate/preview', form)
  },

  async uploadCertificate(
    companyId: string,
    file: File,
    password: string,
  ): Promise<{ cnpj: string; razaoSocial: string; validade: string }> {
    const form = new FormData()
    form.append('arquivo', file)
    form.append('senha', password)
    return apiUpload(`/companies/${companyId}/certificate`, form)
  },

  async getCertificateStatus(companyId: string): Promise<{
    cadastrado: boolean
    cnpj?: string
    razaoSocial?: string
    validade?: string
    titular?: string
  }> {
    if (!isApiConfigured) return { cadastrado: false }
    return apiRequest(`/companies/${companyId}/certificate`)
  },
}
