import { describe, expect, it } from 'vitest';
import { fitsIn, freeSlots, intersect, normalize } from './slots.js';

const h = (hh: number, mm = 0) => hh * 60 + mm;

describe('motor de horários livres', () => {
  it('funde faixas sobrepostas e contíguas', () => {
    expect(
      normalize([
        { start: h(13), end: h(15) },
        { start: h(9), end: h(12) },
        { start: h(12), end: h(13) },
      ]),
    ).toEqual([{ start: h(9), end: h(15) }]);
  });

  it('cruza a escala com o funcionamento', () => {
    expect(intersect([{ start: h(7), end: h(21) }], [{ start: h(8), end: h(18) }])).toEqual([
      { start: h(8), end: h(18) },
    ]);
    expect(intersect([{ start: h(19), end: h(22) }], [{ start: h(8), end: h(18) }])).toEqual([]);
  });

  it('oferece inícios a cada 15 minutos em que a duração inteira cabe', () => {
    const starts = freeSlots({
      available: [{ start: h(9), end: h(11) }],
      busy: [],
      duration: 60,
      step: 15,
    });
    expect(starts).toEqual([h(9), h(9, 15), h(9, 30), h(9, 45), h(10)]);
  });

  it('pula horários que tocam um agendamento, mas aceita encostar nas bordas', () => {
    const starts = freeSlots({
      available: [{ start: h(9), end: h(12) }],
      busy: [{ start: h(10), end: h(11) }],
      duration: 60,
      step: 15,
    });
    expect(starts).toEqual([h(9), h(11)]);
  });

  it('alinha à grade e respeita o "agora"', () => {
    const starts = freeSlots({
      available: [{ start: h(9, 10), end: h(10, 30) }],
      busy: [],
      duration: 30,
      step: 15,
      notBefore: h(9, 31),
    });
    expect(starts).toEqual([h(9, 45), h(10)]);
  });

  it('turno mais curto que a duração não oferece horário', () => {
    expect(
      freeSlots({ available: [{ start: h(9), end: h(9, 45) }], busy: [], duration: 60, step: 15 }),
    ).toEqual([]);
  });

  it('confere se um horário escolhido cabe na escala', () => {
    const available = [
      { start: h(9), end: h(12) },
      { start: h(14), end: h(18) },
    ];
    expect(fitsIn(available, h(11), 60)).toBe(true);
    expect(fitsIn(available, h(11, 30), 60)).toBe(false);
    expect(fitsIn(available, h(13), 60)).toBe(false);
  });
});
