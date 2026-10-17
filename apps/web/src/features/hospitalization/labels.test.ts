import { describe, expect, it } from 'vitest';
import { formatDuration } from './labels';

describe('duração da internação', () => {
  const from = '2026-10-10T08:00:00.000Z';
  it('conta dias e horas como o painel de referência', () => {
    expect(formatDuration(from, '2026-10-17T15:10:00.000Z')).toBe('7 dias e 7 horas');
    expect(formatDuration(from, '2026-10-11T08:30:00.000Z')).toBe('1 dia');
    expect(formatDuration(from, '2026-10-10T09:00:00.000Z')).toBe('1 hora');
    expect(formatDuration(from, '2026-10-10T08:40:00.000Z')).toBe('40 min');
  });
  it('sem fim, conta até agora', () => {
    expect(formatDuration(from, null, new Date('2026-10-12T10:00:00.000Z'))).toBe(
      '2 dias e 2 horas',
    );
  });
});
