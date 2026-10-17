import type {
  ApiError,
  CatalogItem,
  Client,
  ClinicalEvent,
  ClinicalEventInput,
  Exam,
  ExamForm,
  ExamInput,
  ExamListItem,
  ExamReferencesInput,
  ExamSeries,
  Patient,
  PatientSales,
  Product,
  ProductInput,
  Timeline,
} from '@clinica/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clientInput, patientInput } from '../../test/fixtures.js';
import { ADMIN, createHarness, loginAs, TestClient, type Harness } from '../../test/harness.js';
import { ageInMonths } from './service.js';

let h: Harness;
let admin: TestClient;
let canina: CatalogItem;
let felina: CatalogItem;
let thor: Patient;
let service: Product;

const serviceInput: ProductInput = {
  kind: 'service',
  serviceKind: 'exam',
  name: 'Hemograma completo',
  unit: 'un',
  barcode: '',
  brandId: null,
  groupId: null,
  ncm: '',
  origin: '0',
  acquisition: 'resale',
  cfop: '',
  taxSituation: '',
  municipalServiceCode: '',
  taxProfile: '',
  salePrice: 80,
  cost: null,
  purpose: 'sale',
  desiredMarkup: null,
  allowPriceChange: false,
  showInPriceList: true,
  discountLimitPercent: null,
  defaultCommissionPercent: 0,
  commissions: [],
  tracksStock: false,
  minStock: null,
  idealStock: null,
};

const field = (
  name: string,
  dataType: 'decimal' | 'integer' | 'text',
  extra: Partial<ExamInput['attributes'][number]> = {},
) => ({
  id: null,
  kind: 'field' as const,
  name,
  unit: '',
  dataType,
  decimals: dataType === 'decimal' ? 2 : null,
  maxLength: dataType === 'text' ? 7 : null,
  ...extra,
});

const hemograma = (serviceId: string | null): ExamInput => ({
  name: 'Hemograma do laboratório',
  serviceId,
  attributes: [
    {
      id: null,
      kind: 'section',
      name: 'Eritrograma',
      unit: '',
      dataType: null,
      decimals: null,
      maxLength: null,
    },
    field('Hemácias', 'decimal', { unit: 'milhões/mm³' }),
    field('Volume globular', 'integer', { unit: '%' }),
    {
      id: null,
      kind: 'section',
      name: 'Plaquetas',
      unit: '',
      dataType: null,
      decimals: null,
      maxLength: null,
    },
    field('Plaquetas', 'text', { unit: 'mil/mm³' }),
  ],
});

async function send<T>(method: 'POST' | 'PUT', path: string, body: unknown, status = 200) {
  const res = await admin.send(method, path, body);
  expect(res.statusCode, res.body).toBe(status);
  return res.json<T>();
}

const fieldOf = (exam: Exam, name: string) =>
  exam.attributes.find((a) => a.kind === 'field' && a.name === name)!;
const error = (body: string) => (JSON.parse(body) as ApiError).error.details?.[0];

async function createExam(): Promise<Exam> {
  const exam = await send<Exam>('POST', '/api/exams', hemograma(service.id), 201);
  return send<Exam>('PUT', `/api/exams/${exam.id}/references`, {
    references: [
      {
        speciesId: canina.id,
        label: 'Adulto',
        minMonths: 6,
        maxMonths: 9999,
        ranges: [
          { attributeId: fieldOf(exam, 'Hemácias').id, low: 5.5, high: 8.5 },
          { attributeId: fieldOf(exam, 'Volume globular').id, low: 37, high: 55 },
        ],
      },
      {
        speciesId: canina.id,
        label: 'Menos de 6 meses',
        minMonths: 0,
        maxMonths: 5,
        ranges: [{ attributeId: fieldOf(exam, 'Hemácias').id, low: 3, high: 7 }],
      },
    ],
  } satisfies ExamReferencesInput);
}

const examEvent = (exam: Exam, values: Record<string, string>, publish = true) =>
  ({
    kind: 'exam',
    occurredAt: null,
    examId: exam.id,
    values: Object.entries(values).map(([name, value]) => ({
      attributeId: fieldOf(exam, name).id,
      value,
    })),
    notes: 'Jejum de 8 horas',
    publish,
  }) satisfies ClinicalEventInput;

beforeEach(async () => {
  h = await createHarness();
  admin = new TestClient(h.app);
  await admin.login(ADMIN.email, ADMIN.password);
  const species = (await admin.get('/api/catalogs/species')).json<CatalogItem[]>();
  canina = species.find((s) => s.name === 'Canina')!;
  felina = species.find((s) => s.name === 'Felina')!;
  const client = await send<Client>('POST', '/api/clients', clientInput(), 201);
  thor = await send<Patient>(
    'POST',
    '/api/patients',
    {
      clientId: client.id,
      patient: patientInput({ name: 'Thor', speciesId: canina.id, birthDate: '2020-01-10' }),
    },
    201,
  );
  service = await send<Product>('POST', '/api/products', serviceInput, 201);
});
afterEach(async () => {
  await h.close();
});

describe('cadastro de exames [RN-33]', () => {
  it('atributos tipados por seção, na ordem, e referência por espécie e idade', async () => {
    const exam = await createExam();
    expect(exam.attributes.map((a) => [a.kind, a.name, a.dataType])).toEqual([
      ['section', 'Eritrograma', null],
      ['field', 'Hemácias', 'decimal'],
      ['field', 'Volume globular', 'integer'],
      ['section', 'Plaquetas', null],
      ['field', 'Plaquetas', 'text'],
    ]);
    expect(exam.service?.name).toBe('Hemograma completo');
    expect(exam.references.map((r) => [r.species.name, r.label, r.ranges.length])).toEqual([
      ['Canina', 'Menos de 6 meses', 1],
      ['Canina', 'Adulto', 2],
    ]);
    const list = (await admin.get('/api/exams')).json<ExamListItem[]>();
    expect(list.map((e) => [e.name, e.fieldCount, e.referenceCount])).toEqual([
      // O Hemograma inicial vem com os campos da p.13 e sem referência.
      ['Hemograma', 17, 0],
      ['Hemograma do laboratório', 3, 2],
    ]);
  });

  it('recusa faixas sobrepostas, faixa em campo de texto e nome repetido', async () => {
    const exam = await send<Exam>('POST', '/api/exams', hemograma(null), 201);
    const band = (minMonths: number, maxMonths: number) => ({
      speciesId: canina.id,
      label: `${String(minMonths)}+`,
      minMonths,
      maxMonths,
      ranges: [],
    });
    let res = await admin.send('PUT', `/api/exams/${exam.id}/references`, {
      references: [band(0, 12), band(12, 9999)],
    });
    expect(res.statusCode).toBe(400);
    expect(error(res.body)?.message).toContain('Sobrepõe');
    // Mesma idade em espécies diferentes é permitido.
    res = await admin.send('PUT', `/api/exams/${exam.id}/references`, {
      references: [band(0, 9999), { ...band(0, 9999), speciesId: felina.id }],
    });
    expect(res.statusCode, res.body).toBe(200);
    res = await admin.send('PUT', `/api/exams/${exam.id}/references`, {
      references: [
        {
          ...band(0, 9999),
          ranges: [{ attributeId: fieldOf(exam, 'Plaquetas').id, low: 1, high: 2 }],
        },
      ],
    });
    expect(res.statusCode).toBe(400);
    expect((await admin.send('POST', '/api/exams', hemograma(null))).statusCode).toBe(409);
  });

  it('só Cadastros escreve; quem registra resultado lê o catálogo', async () => {
    const exam = await createExam();
    const vet = await loginAs(h, admin, 'Veterinário');
    expect((await vet.get('/api/exams')).statusCode).toBe(200);
    expect((await vet.get(`/api/exams/${exam.id}`)).statusCode).toBe(200);
    expect((await vet.send('POST', '/api/exams', hemograma(null))).statusCode).toBe(403);
    expect(
      (await vet.send('PUT', `/api/exams/${exam.id}/references`, { references: [] })).statusCode,
    ).toBe(403);
  });
});

describe('resultado na ficha [RN-33]', () => {
  it('converte pelo tipo, marca fora da faixa e lança o serviço na venda do animal', async () => {
    const exam = await createExam();
    const form = (
      await admin.get(`/api/clinical/patients/${thor.id}/exam-form/${exam.id}`)
    ).json<ExamForm>();
    expect(form.reference).toMatchObject({ label: 'Adulto', species: 'Canina' });
    expect(form.reference?.ranges).toHaveLength(2);

    const event = await send<ClinicalEvent>(
      'POST',
      `/api/clinical/patients/${thor.id}/events`,
      examEvent(exam, { Hemácias: '9,10', 'Volume globular': '45', Plaquetas: '350' }),
      201,
    );
    expect(event.status).toBe('published');
    expect(event.data).toMatchObject({
      kind: 'exam',
      exam: { id: exam.id, name: 'Hemograma do laboratório' },
      referenceLabel: 'Adulto',
      notes: 'Jejum de 8 horas',
      values: [
        { name: 'Hemácias', section: 'Eritrograma', value: 9.1, low: 5.5, high: 8.5, flag: 'high' },
        { name: 'Volume globular', value: 45, low: 37, high: 55, flag: 'normal' },
        {
          name: 'Plaquetas',
          section: 'Plaquetas',
          value: '350',
          low: null,
          high: null,
          flag: null,
        },
      ],
    });
    const sales = (await admin.get(`/api/sales/patient/${thor.id}`)).json<PatientSales>();
    expect(sales.open?.items.map((i) => i.name)).toEqual(['Hemograma completo']);
  });

  it('recusa valor fora do tipo e finalizar sem resultado; rascunho pode ficar vazio', async () => {
    const exam = await createExam();
    let res = await admin.send(
      'POST',
      `/api/clinical/patients/${thor.id}/events`,
      examEvent(exam, { Hemácias: '1,234' }),
    );
    expect(res.statusCode).toBe(400);
    expect(error(res.body)).toEqual({ path: 'values.0.value', message: 'Até 2 casas decimais' });
    res = await admin.send(
      'POST',
      `/api/clinical/patients/${thor.id}/events`,
      examEvent(exam, { 'Volume globular': '4,5' }),
    );
    expect(error(res.body)?.message).toBe('Use um número inteiro');
    res = await admin.send(
      'POST',
      `/api/clinical/patients/${thor.id}/events`,
      examEvent(exam, { Plaquetas: '12345678' }),
    );
    expect(error(res.body)?.message).toBe('Máximo de 7 caracteres');
    res = await admin.send('POST', `/api/clinical/patients/${thor.id}/events`, examEvent(exam, {}));
    expect(res.statusCode).toBe(400);
    const draft = await send<ClinicalEvent>(
      'POST',
      `/api/clinical/patients/${thor.id}/events`,
      examEvent(exam, {}, false),
      201,
    );
    expect(draft.status).toBe('draft');
    // Rascunho não lança na venda.
    expect((await admin.get(`/api/sales/patient/${thor.id}`)).json<PatientSales>().open).toBeNull();
  });

  it('sem nascimento ou sem faixa para a idade, registra sem marcar e diz por quê', async () => {
    const exam = await createExam();
    const client = await send<Client>(
      'POST',
      '/api/clients',
      clientInput({ name: 'Ana', cpf: '' }),
      201,
    );
    const mia = await send<Patient>(
      'POST',
      '/api/patients',
      { clientId: client.id, patient: patientInput({ name: 'Mia', speciesId: felina.id }) },
      201,
    );
    const form = (
      await admin.get(`/api/clinical/patients/${mia.id}/exam-form/${exam.id}`)
    ).json<ExamForm>();
    expect(form.reference).toBeNull();
    expect(form.referenceNote).toContain('data de nascimento');
    const event = await send<ClinicalEvent>(
      'POST',
      `/api/clinical/patients/${mia.id}/events`,
      examEvent(exam, { Hemácias: '9' }),
      201,
    );
    expect(event.data).toMatchObject({
      referenceLabel: null,
      values: [{ value: 9, low: null, high: null, flag: null }],
    });
  });

  it('o resultado guarda a faixa da época: mudar o cadastro não reescreve o histórico', async () => {
    const exam = await createExam();
    const event = await send<ClinicalEvent>(
      'POST',
      `/api/clinical/patients/${thor.id}/events`,
      examEvent(exam, { Hemácias: '9,10', 'Volume globular': '45' }),
      201,
    );
    // Retira o Volume globular (já usado: arquivado) e amplia a faixa das hemácias.
    const without = await send<Exam>('PUT', `/api/exams/${exam.id}`, {
      ...hemograma(service.id),
      attributes: exam.attributes
        .filter((a) => a.name !== 'Volume globular')
        .map((a) => ({ ...a, unit: a.unit })),
    });
    expect(without.attributes.map((a) => a.name)).not.toContain('Volume globular');
    await send('PUT', `/api/exams/${exam.id}/references`, {
      references: [
        {
          speciesId: canina.id,
          label: 'Adulto',
          minMonths: 6,
          maxMonths: 9999,
          ranges: [{ attributeId: fieldOf(exam, 'Hemácias').id, low: 5, high: 10 }],
        },
      ],
    });
    const timeline = (
      await admin.get(`/api/clinical/patients/${thor.id}/timeline`)
    ).json<Timeline>();
    const saved = timeline.items.find((e) => e.id === event.id)!;
    expect(saved.data).toMatchObject({
      values: [
        { name: 'Hemácias', high: 8.5, flag: 'high' },
        { name: 'Volume globular', value: 45 },
      ],
    });
  });

  it('evolução de um campo ao longo dos resultados publicados [p.14]', async () => {
    const exam = await createExam();
    for (const value of ['6', '9,1']) {
      await send(
        'POST',
        `/api/clinical/patients/${thor.id}/events`,
        examEvent(exam, { Hemácias: value }),
        201,
      );
    }
    await send(
      'POST',
      `/api/clinical/patients/${thor.id}/events`,
      examEvent(exam, { Hemácias: '1' }, false),
      201,
    );
    const series = (
      await admin.get(
        `/api/clinical/patients/${thor.id}/exam-series?attributeId=${fieldOf(exam, 'Hemácias').id}`,
      )
    ).json<ExamSeries>();
    expect(series).toMatchObject({
      exam: 'Hemograma do laboratório',
      name: 'Hemácias',
      unit: 'milhões/mm³',
    });
    expect(series.points.map((p) => [p.value, p.flag])).toEqual([
      [6, 'normal'],
      [9.1, 'high'],
    ]);
  });
});

describe('ageInMonths', () => {
  it('conta meses completos', () => {
    expect(ageInMonths('2020-01-10', '2020-07-09')).toBe(5);
    expect(ageInMonths('2020-01-10', '2020-07-10')).toBe(6);
    expect(ageInMonths('2020-01-31', '2021-01-30')).toBe(11);
  });
});
