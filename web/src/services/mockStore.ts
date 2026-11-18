/* ============================================================
   Modo demo: persistência em localStorage para rodar o front
   sem Supabase. Removido automaticamente quando .env.local é
   preenchido (isMockMode = false).
   ============================================================ */

import type { License, LicenseStatus, Profile, UserRole } from '@/types'

interface MockUser {
  id: string
  email: string
  password: string
  fullName: string
  role: UserRole
}

interface MockLicense {
  id: string
  userId: string
  status: LicenseStatus
  validUntil: string | null
  activatedBy: string | null
  createdAt: string
  updatedAt: string
}

interface MockDatabase {
  users: MockUser[]
  licenses: MockLicense[]
  sessionUserId: string | null
}

const STORAGE_KEY = 'myfly_mock_v1'

function seed(): MockDatabase {
  const now = new Date().toISOString()
  return {
    users: [
      {
        id: '00000000-0000-0000-0000-000000000001',
        email: 'admin@myfly.com.br',
        password: 'admin123',
        fullName: 'Administrador MyFly',
        role: 'admin',
      },
      {
        id: '00000000-0000-0000-0000-000000000002',
        email: 'contador@myfly.com.br',
        password: 'contador123',
        fullName: 'Contador Demo',
        role: 'contador',
      },
    ],
    licenses: [
      {
        id: '10000000-0000-0000-0000-000000000001',
        userId: '00000000-0000-0000-0000-000000000001',
        status: 'ativo',
        validUntil: null,
        activatedBy: null,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: '10000000-0000-0000-0000-000000000002',
        userId: '00000000-0000-0000-0000-000000000002',
        status: 'pendente', // deixa o fluxo de aprovação do admin demonstrável
        validUntil: null,
        activatedBy: null,
        createdAt: now,
        updatedAt: now,
      },
    ],
    sessionUserId: null,
  }
}

export function readDb(): MockDatabase {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw) as MockDatabase
  } catch {
    /* storage indisponível: usa seed */
  }
  const fresh = seed()
  writeDb(fresh)
  return fresh
}

export function writeDb(db: MockDatabase): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(db))
  } catch {
    /* ignora falha de storage */
  }
}

export function toProfile(user: MockUser): Profile {
  return {
    id: user.id,
    fullName: user.fullName,
    email: user.email,
    role: user.role,
    createdAt: new Date().toISOString(),
  }
}

export function toLicense(license: MockLicense, user: MockUser): License {
  const status: LicenseStatus =
    license.status === 'ativo' && license.validUntil && new Date(license.validUntil) < new Date()
      ? 'expirado'
      : license.status

  return {
    id: license.id,
    userId: license.userId,
    userName: user.fullName,
    userEmail: user.email,
    status,
    validUntil: license.validUntil,
    activatedBy: license.activatedBy,
    createdAt: license.createdAt,
    updatedAt: license.updatedAt,
  }
}

export function findUserByEmail(email: string): MockUser | undefined {
  return readDb().users.find((user) => user.email.toLowerCase() === email.toLowerCase().trim())
}

export function findUserById(id: string): MockUser | undefined {
  return readDb().users.find((user) => user.id === id)
}
