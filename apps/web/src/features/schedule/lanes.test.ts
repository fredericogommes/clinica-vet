import { describe, expect, it } from 'vitest';
import { placeInLanes } from './lanes';

describe('placeInLanes', () => {
  it('blocos sem sobreposição ocupam a largura toda', () => {
    const placed = placeInLanes([
      { start: '09:00', end: '10:00' },
      { start: '10:00', end: '11:00' },
    ]);
    expect(placed.map((p) => [p.lane, p.lanes])).toEqual([
      [0, 1],
      [0, 1],
    ]);
  });

  it('blocos sobrepostos dividem a largura e reaproveitam colunas livres', () => {
    const placed = placeInLanes([
      { start: '09:00', end: '11:00' },
      { start: '09:30', end: '10:00' },
      { start: '10:00', end: '10:30' },
      { start: '12:00', end: '13:00' },
    ]);
    expect(placed.map((p) => [p.item.start, p.lane, p.lanes])).toEqual([
      ['09:00', 0, 2],
      ['09:30', 1, 2],
      ['10:00', 1, 2],
      ['12:00', 0, 1],
    ]);
  });
});
