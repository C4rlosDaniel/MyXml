import type { License, LicenseStatus } from '@/types'
import { apiRequest } from './api.client'
import { isApiConfigured, isMockMode } from './config'
import { findUserById, readDb, toLicense, writeDb } from './mockStore'
import { supabase } from './supabase'

function mapRow(row: Record<string, unknown>): License {
  const user = (row.profiles ?? {}) as Record<string, unknown>
  const status = String(row.status) as LicenseStatus
  const validUntil = row.valid_until ? String(row.valid_until) : null
  const effectiveStatus: LicenseStatus =
    status === 'ativo' && validUntil && new Date(validUntil) < new Date() ? 'expirado' : status

  return {
    id: String(row.id),
    userId: String(row.user_id),
    userName: String(user.full_name ?? 'Usuário'),
    userEmail: String(user.email ?? ''),
    status: effectiveStatus,
    validUntil,
    activatedBy: row.activated_by ? String(row.activated_by) : null,
    createdAt: String(row.created_at ?? new Date().toISOString()),
    updatedAt: String(row.updated_at ?? new Date().toISOString()),
  }
}

export const licenseService = {
  async getMyLicense(userId: string): Promise<License | null> {
    if (isMockMode) {
      const db = readDb()
      const license = db.licenses.find((item) => item.userId === userId)
      const user = findUserById(userId)
      return license && user ? toLicense(license, user) : null
    }
    if (!supabase) return null
    const { data, error } = await supabase
      .from('licenses')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle()
    if (error || !data) return null
    return mapRow(data as Record<string, unknown>)
  },

  async createUser(payload: {
    fullName: string
    email: string
    password: string
    days: number
    role: 'admin' | 'contador'
  }): Promise<License> {
    if (isMockMode || !isApiConfigured) {
      throw new Error('Configure a API FastAPI para gerar licenças.')
    }
    return apiRequest<License>('/licenses', {
      method: 'POST',
      body: JSON.stringify({
        full_name: payload.fullName,
        email: payload.email,
        password: payload.password,
        days: payload.days,
        role: payload.role,
      }),
    })
  },

  async listAll(): Promise<License[]> {
    if (isMockMode) {
      const db = readDb()
      return db.licenses
        .map((license) => {
          const user = findUserById(license.userId)
          return user ? toLicense(license, user) : null
        })
        .filter((item): item is License => item !== null)
    }
    if (!supabase) return []
    // TODO: mover para GET /licenses na API se a RLS não bastar
    const { data, error } = await supabase
      .from('licenses')
      .select('*, profiles!licenses_user_id_fkey(full_name, email)')
      .order('created_at', { ascending: false })
    if (error) throw new Error('Não foi possível carregar as licenças.')
    return (data ?? []).map((row) => mapRow(row as Record<string, unknown>))
  },

  async update(
    licenseId: string,
    changes: { status: LicenseStatus; validUntil: string | null; activatedBy: string | null },
  ): Promise<License> {
    if (isMockMode) {
      const db = readDb()
      const index = db.licenses.findIndex((item) => item.id === licenseId)
      if (index < 0) throw new Error('Licença não encontrada.')
      db.licenses[index] = {
        ...db.licenses[index],
        status: changes.status,
        validUntil: changes.validUntil,
        activatedBy: changes.activatedBy,
        updatedAt: new Date().toISOString(),
      }
      writeDb(db)
      const updated = db.licenses[index]
      const user = findUserById(updated.userId)
      if (!user) throw new Error('Usuário não encontrado.')
      return toLicense(updated, user)
    }

    if (!supabase) throw new Error('Supabase não configurado.')
    // TODO: validar prazo mínimo/máximo no backend antes de autorizar
    const { data, error } = await supabase
      .from('licenses')
      .update({
        status: changes.status,
        valid_until: changes.validUntil,
        activated_by: changes.activatedBy,
        updated_at: new Date().toISOString(),
      })
      .eq('id', licenseId)
      .select('*, profiles!licenses_user_id_fkey(full_name, email)')
      .single()

    if (error) throw new Error('Não foi possível atualizar a licença.')
    return mapRow(data as Record<string, unknown>)
  },
}
