import type { Profile } from '@/types'
import { isMockMode } from './config'
import {
  findUserByEmail,
  findUserById,
  readDb,
  toProfile,
  writeDb,
} from './mockStore'
import { supabase } from './supabase'

function translateAuthError(message: string): string {
  const lower = message.toLowerCase()
  if (lower.includes('invalid login') || lower.includes('invalid credentials')) {
    return 'E-mail ou senha incorretos.'
  }
  if (lower.includes('email not confirmed')) {
    return 'Confirme seu e-mail antes de entrar.'
  }
  if (lower.includes('too many requests')) {
    return 'Muitas tentativas. Aguarde um instante e tente novamente.'
  }
  return 'Não foi possível entrar. Tente novamente.'
}

function mapProfile(row: Record<string, unknown>): Profile {
  return {
    id: String(row.id),
    fullName: String(row.full_name ?? row.email ?? 'Usuário'),
    email: String(row.email ?? ''),
    role: row.role === 'admin' ? 'admin' : 'contador',
    createdAt: String(row.created_at ?? new Date().toISOString()),
  }
}

export const authService = {
  async signIn(email: string, password: string): Promise<Profile> {
    if (isMockMode) {
      const user = findUserByEmail(email)
      if (!user || user.password !== password) {
        throw new Error('E-mail ou senha incorretos.')
      }
      const db = readDb()
      db.sessionUserId = user.id
      writeDb(db)
      return toProfile(user)
    }

    if (!supabase) throw new Error('Não foi possível conectar. Tente novamente em instantes.')
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw new Error(translateAuthError(error.message))

    const userId = data.user.id
    // TODO: garantir que o trigger `handle_new_user` criou o profile (migration 0001)
    const { data: profileRow, error: profileError } = await supabase
      .from('profiles')
      .select('id, full_name, role, created_at')
      .eq('id', userId)
      .maybeSingle()

    if (profileError) throw new Error('Não foi possível carregar seu perfil.')

    if (profileRow) return mapProfile(profileRow)

    // Fallback: perfil ainda não criado pelo trigger
    return {
      id: userId,
      fullName: String(data.user.user_metadata?.full_name ?? data.user.email ?? 'Usuário'),
      email: data.user.email ?? '',
      role: data.user.user_metadata?.role === 'admin' ? 'admin' : 'contador',
      createdAt: data.user.created_at,
    }
  },

  async signOut(): Promise<void> {
    if (isMockMode) {
      const db = readDb()
      db.sessionUserId = null
      writeDb(db)
      return
    }
    if (!supabase) return
    const { error } = await supabase.auth.signOut()
    if (error) throw new Error('Não foi possível sair. Tente novamente.')
  },

  async getCurrentProfile(): Promise<Profile | null> {
    if (isMockMode) {
      const db = readDb()
      const user = db.sessionUserId ? findUserById(db.sessionUserId) : undefined
      return user ? toProfile(user) : null
    }
    if (!supabase) return null
    const { data } = await supabase.auth.getUser()
    if (!data.user) return null

    const { data: row } = await supabase
      .from('profiles')
      .select('id, full_name, role, created_at')
      .eq('id', data.user.id)
      .maybeSingle()

    if (row) return mapProfile(row)
    return {
      id: data.user.id,
      fullName: String(data.user.user_metadata?.full_name ?? data.user.email ?? 'Usuário'),
      email: data.user.email ?? '',
      role: data.user.user_metadata?.role === 'admin' ? 'admin' : 'contador',
      createdAt: data.user.created_at,
    }
  },
}
