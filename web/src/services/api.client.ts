import { apiBaseUrl, isMockMode } from './config'
import { supabase } from './supabase'

/** Erro de API já traduzido para linguagem simples (pt-BR). */
export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

function friendlyMessage(status: number, detail?: string): string {
  if (status === 401) return 'Sua sessão expirou. Entre novamente para continuar.'
  if (status === 403) return 'Você não tem permissão para realizar esta ação.'
  if (status === 404) return 'Não encontramos o que você procura.'
  if (status === 409) return 'Já existe um registro com esses dados.'
  if (status >= 500) return 'O serviço está indisponível no momento. Tente novamente em instantes.'
  return detail ?? 'Não foi possível concluir a operação. Tente novamente.'
}

async function token(): Promise<string | undefined> {
  if (isMockMode || !supabase) return undefined
  const { data } = await supabase.auth.getSession()
  return data.session?.access_token
}

async function parseError(response: Response): Promise<ApiError> {
  const body = (await response.json().catch(() => null)) as
    | { detail?: string | { msg?: string }; code?: string }
    | null
  const detail = typeof body?.detail === 'string' ? body.detail : body?.detail?.msg
  return new ApiError(friendlyMessage(response.status, detail), response.status, body?.code)
}

export async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const accessToken = await token()
  let response: Response
  try {
    response = await fetch(`${apiBaseUrl}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        ...init?.headers,
      },
    })
  } catch {
    throw new ApiError('Não foi possível conectar ao servidor. Verifique sua conexão.', 0)
  }
  if (!response.ok) throw await parseError(response)
  return (await response.json()) as T
}

/** Upload multipart (certificado .pfx). Não define Content-Type: o browser faz isso. */
export async function apiUpload<T>(path: string, formData: FormData): Promise<T> {
  const accessToken = await token()
  let response: Response
  try {
    response = await fetch(`${apiBaseUrl}${path}`, {
      method: 'POST',
      body: formData,
      headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
    })
  } catch {
    throw new ApiError('Não foi possível conectar ao servidor.', 0)
  }
  if (!response.ok) throw await parseError(response)
  return (await response.json()) as T
}

/** Baixa um arquivo da API (Excel/ZIP) usando o token da sessão. */
export async function apiDownload(path: string, filename: string): Promise<void> {
  const accessToken = await token()
  const response = await fetch(`${apiBaseUrl}${path}`, {
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
  })
  if (!response.ok) throw await parseError(response)

  const url = URL.createObjectURL(await response.blob())
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

/** Exemplo de serviço isolado. TODO: conectar ao GET /health da API em produção. */
export const systemService = {
  async health(): Promise<{ status: string }> {
    return apiRequest<{ status: string }>('/health')
  },
}
