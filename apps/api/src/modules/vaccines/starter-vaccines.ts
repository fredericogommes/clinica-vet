import type { vaccines } from '../../db/schema.js';

type StarterVaccine = Pick<
  typeof vaccines.$inferInsert,
  'name' | 'kind' | 'primaryDoses' | 'primaryIntervalDays' | 'boosterIntervalDays'
>;

/**
 * Ponto de partida do cadastro para a clínica nova, com as séries mais comuns. O veterinário
 * responsável ajusta o protocolo da casa; a dose e a próxima data também são editáveis em cada
 * aplicação.
 */
export const starterVaccines: StarterVaccine[] = [
  {
    name: 'Polivalente canina (V8/V10)',
    kind: 'vaccine',
    primaryDoses: 3,
    primaryIntervalDays: 21,
    boosterIntervalDays: 365,
  },
  {
    name: 'Polivalente felina (V4/V5)',
    kind: 'vaccine',
    primaryDoses: 3,
    primaryIntervalDays: 21,
    boosterIntervalDays: 365,
  },
  {
    name: 'Antirrábica',
    kind: 'vaccine',
    primaryDoses: 1,
    primaryIntervalDays: null,
    boosterIntervalDays: 365,
  },
  {
    name: 'Vermífugo',
    kind: 'dewormer',
    primaryDoses: 1,
    primaryIntervalDays: null,
    boosterIntervalDays: 90,
  },
];
