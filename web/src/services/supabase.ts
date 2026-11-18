import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { isMockMode, supabaseAnonKey, supabaseUrl } from './config'

/** Cliente Supabase. `null` quando não há credenciais (modo demo). */
export const supabase: SupabaseClient | null = isMockMode
  ? null
  : createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
