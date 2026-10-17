import type { examAttributes } from '../../db/schema.js';

type StarterAttribute = Pick<
  typeof examAttributes.$inferInsert,
  'kind' | 'name' | 'unit' | 'dataType' | 'decimals' | 'maxLength'
>;

const section = (name: string): StarterAttribute => ({
  kind: 'section',
  name,
  unit: '',
  dataType: null,
  decimals: null,
  maxLength: null,
});
const decimal = (name: string, unit: string, decimals: number): StarterAttribute => ({
  kind: 'field',
  name,
  unit,
  dataType: 'decimal',
  decimals,
  maxLength: null,
});
const text = (name: string, unit: string, maxLength: number): StarterAttribute => ({
  kind: 'field',
  name,
  unit,
  dataType: 'text',
  decimals: null,
  maxLength,
});

/**
 * Hemograma com os campos da p.13, para a clínica partir de um exame pronto. Os valores de
 * referência ficam com a clínica: cada laboratório publica as suas faixas.
 */
export const starterExams: { name: string; attributes: StarterAttribute[] }[] = [
  {
    name: 'Hemograma',
    attributes: [
      section('Eritrograma'),
      decimal('Hemácias', 'milhões/mm³', 3),
      {
        kind: 'field',
        name: 'Volume globular',
        unit: '%',
        dataType: 'integer',
        decimals: null,
        maxLength: null,
      },
      decimal('Hemoglobina', 'g/dL', 2),
      decimal('VGM', 'fL', 2),
      decimal('CHGM', '%', 2),
      text('Plaquetas', 'mil/mm³', 7),
      decimal('Proteínas totais', 'g/dL', 2),
      text('Hemácias nucleadas', '', 50),
      section('Leucograma'),
      decimal('Leucócitos', 'mil/mm³', 2),
      ...[
        'Mielócitos',
        'Metamielócitos',
        'Bastões',
        'Segmentados',
        'Linfócitos',
        'Monócitos',
        'Eosinófilos',
        'Basófilos',
      ].map((name) => text(name, '', 20)),
    ],
  },
];
