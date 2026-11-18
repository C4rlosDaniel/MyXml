/* Formatação e máscaras pt-BR. Apenas apoio visual — validação final é do backend. */

export function onlyDigits(value: string): string {
  return value.replace(/\D/g, '')
}

export function maskCpf(value: string): string {
  const v = onlyDigits(value).slice(0, 11)
  if (v.length <= 3) return v
  if (v.length <= 6) return `${v.slice(0, 3)}.${v.slice(3)}`
  if (v.length <= 9) return `${v.slice(0, 3)}.${v.slice(3, 6)}.${v.slice(6)}`
  return `${v.slice(0, 3)}.${v.slice(3, 6)}.${v.slice(6, 9)}-${v.slice(9)}`
}

export function maskCnpj(value: string): string {
  const v = onlyDigits(value).slice(0, 14)
  if (v.length <= 2) return v
  if (v.length <= 5) return `${v.slice(0, 2)}.${v.slice(2)}`
  if (v.length <= 8) return `${v.slice(0, 2)}.${v.slice(2, 5)}.${v.slice(5)}`
  if (v.length <= 12) return `${v.slice(0, 2)}.${v.slice(2, 5)}.${v.slice(5, 8)}/${v.slice(8)}`
  return `${v.slice(0, 2)}.${v.slice(2, 5)}.${v.slice(5, 8)}/${v.slice(8, 12)}-${v.slice(12)}`
}

export function maskCep(value: string): string {
  const v = onlyDigits(value).slice(0, 8)
  return v.replace(/^(\d{5})(\d)/, '$1-$2')
}

export function maskPhone(value: string): string {
  const v = onlyDigits(value).slice(0, 11)
  if (v.length <= 10) {
    return v.replace(/^(\d{2})(\d)/, '($1) $2').replace(/(\d{4})(\d)/, '$1-$2')
  }
  return v.replace(/^(\d{2})(\d)/, '($1) $2').replace(/^(\d{2})(\d{5})(\d)/, '$1 $2-$3')
}

export function maskCurrencyInput(value: string): string {
  const digits = onlyDigits(value)
  if (!digits) return ''
  return (Number(digits) / 100).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  })
}

export function formatCurrency(value: number): string {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

export function formatDate(value: string | Date, withTime = false): string {
  const date = typeof value === 'string' ? new Date(value) : value
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  })
}

export function formatCnpj(value: string): string {
  return maskCnpj(value)
}

export function formatChaveNfe(value: string): string {
  const v = onlyDigits(value).slice(0, 44)
  return v.replace(/(\d{4})(?=\d)/g, '$1 ').trim()
}
