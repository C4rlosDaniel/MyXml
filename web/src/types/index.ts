export type UserRole = 'admin' | 'contador'
export type LicenseStatus = 'pendente' | 'ativo' | 'bloqueado' | 'expirado'

export interface Profile {
  id: string
  fullName: string
  email: string
  role: UserRole
  createdAt: string
}

export interface License {
  id: string
  userId: string
  userName: string
  userEmail: string
  status: LicenseStatus
  validUntil: string | null
  activatedBy: string | null
  createdAt: string
  updatedAt: string
}

export interface Company {
  id: string
  cnpj: string
  razaoSocial: string
  nomeExibicao: string | null
  certValidade: string | null
  createdAt: string
}

export type NoteStatus =
  | 'rascunho'
  | 'enviada'
  | 'autorizada'
  | 'rejeitada'
  | 'cancelada'

export interface Note {
  id: string
  companyId: string
  clientName?: string
  chave: string
  numero: string
  serie: string
  modelo: string
  emitidaEm: string
  valor: number
  situacao: NoteStatus
}
