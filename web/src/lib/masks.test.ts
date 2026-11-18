import { describe, expect, it } from 'vitest'
import {
  formatChaveNfe,
  formatCurrency,
  maskCnpj,
  maskCpf,
  maskPhone,
  onlyDigits,
} from './masks'

describe('máscaras pt-BR', () => {
  it('remove não dígitos', () => {
    expect(onlyDigits('30.720.420/0001-03')).toBe('30720420000103')
  })

  it('mascara CPF parcial e completo', () => {
    expect(maskCpf('123')).toBe('123')
    expect(maskCpf('123456789')).toBe('123.456.789')
    expect(maskCpf('12345678909')).toBe('123.456.789-09')
  })

  it('mascara CNPJ sem perder dígitos ao digitar', () => {
    expect(maskCnpj('30')).toBe('30')
    expect(maskCnpj('307')).toBe('30.7')
    expect(maskCnpj('30720420000103')).toBe('30.720.420/0001-03')
  })

  it('mascara telefone', () => {
    expect(maskPhone('1935551200')).toBe('(19) 3555-1200')
  })

  it('formata moeda e chave de acesso', () => {
    expect(formatCurrency(1234.5)).toContain('1.234,50')
    expect(formatChaveNfe('35261130720420000103650010000001231000000010')).toMatch(/^3526 1130/)
  })
})
