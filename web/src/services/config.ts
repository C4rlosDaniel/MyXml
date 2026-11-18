/** Configuração do front. Valores vêm de web/.env.local (ver .env.example). */

const url = import.meta.env.VITE_SUPABASE_URL ?? ''
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? ''

export const supabaseUrl = url
export const supabaseAnonKey = anonKey
export const apiBaseUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'

/** Modo demo: sem credenciais ou com VITE_FORCE_MOCK=true no .env.local. */
export const isMockMode =
  import.meta.env.VITE_FORCE_MOCK === 'true' ||
  !url ||
  !anonKey ||
  url.includes('SEU_PROJETO') ||
  anonKey.includes('SEU_PUBLISHABLE_KEY')

/** API FastAPI configurada explicitamente (VITE_API_URL no .env.local). */
export const isApiConfigured = !isMockMode && Boolean(import.meta.env.VITE_API_URL)
