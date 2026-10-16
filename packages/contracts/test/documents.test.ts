import { describe, expect, it } from 'vitest';
import { formatCnpj, formatCpf, formatPhone, isValidCnpj, isValidCpf } from '../src/documents.js';

describe('documentos', () => {
  it('valida CPF pelos dígitos verificadores', () => {
    expect(isValidCpf('52998224725')).toBe(true);
    expect(isValidCpf('52998224724')).toBe(false);
    expect(isValidCpf('11111111111')).toBe(false);
    expect(isValidCpf('5299822472')).toBe(false);
  });

  it('valida CNPJ pelos dígitos verificadores', () => {
    expect(isValidCnpj('11222333000181')).toBe(true);
    expect(isValidCnpj('11222333000182')).toBe(false);
    expect(isValidCnpj('00000000000000')).toBe(false);
  });

  it('formata documentos e telefones', () => {
    expect(formatCpf('52998224725')).toBe('529.982.247-25');
    expect(formatCnpj('11222333000181')).toBe('11.222.333/0001-81');
    expect(formatPhone('11987654321')).toBe('(11) 98765-4321');
    expect(formatPhone('1133334444')).toBe('(11) 3333-4444');
  });
});
