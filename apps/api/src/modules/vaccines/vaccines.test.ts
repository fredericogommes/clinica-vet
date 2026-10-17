import type {
  ApiError,
  CatalogItem,
  Client,
  ClinicalEvent,
  ClinicalEventInput,
  Patient,
  PatientSales,
  Product,
  ProductInput,
  Protocol,
  Timeline,
  VaccinationDue,
  VaccinationForm,
  Vaccine,
  VaccineInput,
} from '@clinica/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clientInput, patientInput } from '../../test/fixtures.js';
import { ADMIN, createHarness, loginAs, TestClient, type Harness } from '../../test/harness.js';

let h: Harness;
let admin: TestClient;
let canina: CatalogItem;
let thor: Patient;
let service: Product;

const serviceInput: ProductInput = {
  kind: 'service',
  serviceKind: 'vaccine',
  name: 'Aplicação de V10',
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
  salePrice: 120,
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

const v10 = (serviceId: string | null): VaccineInput => ({
  name: 'V10 da clínica',
  kind: 'vaccine',
  primaryDoses: 3,
  primaryIntervalDays: 21,
  boosterIntervalDays: 365,
  serviceId,
  archived: false,
});

/** Datas no fuso da unidade de teste (São Paulo), sem depender do relógio do servidor. */
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(
  new Date(),
);
const shift = (date: string, days: number) => {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
/** Meio-dia da data; hoje, um minuto atrás, para nunca cair no futuro antes do meio-dia. */
const at = (date: string) =>
  date === today ? new Date(Date.now() - 60_000).toISOString() : `${date}T12:00:00-03:00`;

async function send<T>(method: 'POST' | 'PUT', path: string, body: unknown, status = 200) {
  const res = await admin.send(method, path, body);
  expect(res.statusCode, res.body).toBe(status);
  return res.json<T>();
}
const error = (body: string) => (JSON.parse(body) as ApiError).error.details?.[0];

const application = (
  vaccine: Vaccine,
  doseNumber: number,
  appliedOn: string,
  nextDueOn: string | null,
): ClinicalEventInput => ({
  kind: 'vaccine',
  occurredAt: at(appliedOn),
  vaccineId: vaccine.id,
  doseNumber,
  lotNumber: 'L2026-08',
  nextDueOn,
  notes: '',
});

const apply = (patient: Patient, input: ClinicalEventInput) =>
  send<ClinicalEvent>('POST', `/api/clinical/patients/${patient.id}/events`, input, 201);
const protocolsOf = async (patient: Patient) =>
  (await admin.get(`/api/clinical/patients/${patient.id}/protocols`)).json<Protocol[]>();
const formOf = async (patient: Patient, vaccine: Vaccine) =>
  (
    await admin.get(`/api/clinical/patients/${patient.id}/vaccination-form/${vaccine.id}`)
  ).json<VaccinationForm>();

beforeEach(async () => {
  h = await createHarness();
  admin = new TestClient(h.app);
  await admin.login(ADMIN.email, ADMIN.password);
  const species = (await admin.get('/api/catalogs/species')).json<CatalogItem[]>();
  canina = species.find((s) => s.name === 'Canina')!;
  const client = await send<Client>('POST', '/api/clients', clientInput(), 201);
  thor = await send<Patient>(
    'POST',
    '/api/patients',
    { clientId: client.id, patient: patientInput({ name: 'Thor', speciesId: canina.id }) },
    201,
  );
  service = await send<Product>('POST', '/api/products', serviceInput, 201);
});
afterEach(async () => {
  await h.close();
});

describe('cadastro de vacinas [RN-20]', () => {
  it('vem com o ponto de partida e valida série, intervalo e nome', async () => {
    const list = (await admin.get('/api/vaccines')).json<Vaccine[]>();
    expect(list.map((v) => [v.name, v.kind, v.primaryDoses, v.boosterIntervalDays])).toEqual([
      ['Antirrábica', 'vaccine', 1, 365],
      ['Polivalente canina (V8/V10)', 'vaccine', 3, 365],
      ['Polivalente felina (V4/V5)', 'vaccine', 3, 365],
      ['Vermífugo', 'dewormer', 1, 90],
    ]);

    let res = await admin.send('POST', '/api/vaccines', {
      ...v10(null),
      primaryIntervalDays: null,
    });
    expect(res.statusCode).toBe(400);
    expect(error(res.body)?.path).toBe('primaryIntervalDays');

    const created = await send<Vaccine>('POST', '/api/vaccines', v10(service.id), 201);
    expect(created.service?.name).toBe('Aplicação de V10');
    res = await admin.send('POST', '/api/vaccines', { ...v10(null), name: 'v10 DA CLÍNICA' });
    expect(res.statusCode).toBe(409);

    // Dose única guarda o intervalo da série como nulo, mesmo que venha preenchido.
    const single = await send<Vaccine>(
      'POST',
      '/api/vaccines',
      {
        ...v10(null),
        name: 'Gripe canina',
        primaryDoses: 1,
        primaryIntervalDays: 21,
      },
      201,
    );
    expect(single.primaryIntervalDays).toBeNull();
  });

  it('só Cadastros escreve; quem aplica lê o catálogo', async () => {
    const vet = await loginAs(h, admin, 'Veterinário');
    expect((await vet.get('/api/vaccines')).statusCode).toBe(200);
    expect((await vet.send('POST', '/api/vaccines', v10(null))).statusCode).toBe(403);
  });
});

describe('aplicação e protocolo [RN-20]', () => {
  it('sugere a dose e a próxima data, segue a série até o reforço e lança o serviço', async () => {
    const vaccine = await send<Vaccine>('POST', '/api/vaccines', v10(service.id), 201);
    let form = await formOf(thor, vaccine);
    expect([form.doseNumber, form.appliedOn, form.nextDueOn]).toEqual([1, today, shift(today, 21)]);

    const d1 = shift(today, -60);
    const first = await apply(thor, application(vaccine, 1, d1, shift(d1, 21)));
    expect(first.status).toBe('published');
    expect(first.data).toMatchObject({
      kind: 'vaccine',
      vaccine: { name: 'V10 da clínica', kind: 'vaccine' },
      doseNumber: 1,
      dose: '1ª dose',
      lotNumber: 'L2026-08',
      nextDueOn: shift(d1, 21),
    });
    form = await formOf(thor, vaccine);
    expect(form.doseNumber).toBe(2);

    const d2 = shift(today, -39);
    await apply(thor, application(vaccine, 2, d2, shift(d2, 21)));
    const d3 = shift(today, -18);
    form = await formOf(thor, vaccine);
    expect(form.doseNumber).toBe(3);
    const third = await apply(thor, application(vaccine, 3, d3, shift(d3, 365)));
    expect(third.data).toMatchObject({ dose: '3ª dose' });
    // Depois da série, a próxima é reforço, um ano depois.
    form = await formOf(thor, vaccine);
    expect([form.doseNumber, form.nextDueOn]).toEqual([4, shift(today, 365)]);

    const [protocol] = await protocolsOf(thor);
    expect(protocol).toMatchObject({
      vaccine: { name: 'V10 da clínica', periodicity: '3 doses a cada 21 dias, depois anual' },
      lastEventId: third.id,
      lastDose: '3ª dose',
      doses: 3,
      nextDueOn: shift(d3, 365),
      status: 'scheduled',
      closure: null,
    });

    const sales = (await admin.get(`/api/sales/patient/${thor.id}`)).json<PatientSales>();
    expect(sales.open?.items.map((i) => i.name)).toEqual([
      'Aplicação de V10',
      'Aplicação de V10',
      'Aplicação de V10',
    ]);
    const timeline = (
      await admin.get(`/api/clinical/patients/${thor.id}/timeline?kinds=vaccine`)
    ).json<Timeline>();
    expect(timeline.items).toHaveLength(3);
  });

  it('recusa próxima dose antes da aplicação e vacina arquivada', async () => {
    const vaccine = await send<Vaccine>('POST', '/api/vaccines', v10(null), 201);
    let res = await admin.send(
      'POST',
      `/api/clinical/patients/${thor.id}/events`,
      application(vaccine, 1, today, today),
    );
    expect(res.statusCode).toBe(400);
    expect(error(res.body)).toEqual({
      path: 'nextDueOn',
      message: 'A próxima dose precisa ser depois da aplicação',
    });
    await send<Vaccine>('PUT', `/api/vaccines/${vaccine.id}`, { ...v10(null), archived: true });
    res = await admin.send(
      'POST',
      `/api/clinical/patients/${thor.id}/events`,
      application(vaccine, 1, today, null),
    );
    expect(res.statusCode).toBe(400);
    expect(error(res.body)?.path).toBe('vaccineId');
  });

  it('invalidar a última aplicação devolve o protocolo à anterior; encerrar e reabrir', async () => {
    const [rabies] = (await admin.get('/api/vaccines'))
      .json<Vaccine[]>()
      .filter((v) => v.name === 'Antirrábica');
    const old = shift(today, -400);
    await apply(thor, application(rabies!, 1, old, shift(old, 365)));
    const recent = await apply(thor, application(rabies!, 2, shift(today, -2), null));
    let [protocol] = await protocolsOf(thor);
    expect([protocol?.lastDose, protocol?.status]).toEqual(['Reforço', 'no_next']);

    await send('POST', `/api/clinical/events/${recent.id}/void`, { reason: 'Lançado em dobro' });
    [protocol] = await protocolsOf(thor);
    expect([protocol?.doses, protocol?.nextDueOn, protocol?.status]).toEqual([
      1,
      shift(old, 365),
      'overdue',
    ]);

    const res = await admin.send(
      'POST',
      `/api/clinical/patients/${thor.id}/protocols/${rabies!.id}/close`,
      { reason: 'Tutor mudou de cidade' },
    );
    expect(res.statusCode, res.body).toBe(200);
    [protocol] = res.json<Protocol[]>();
    expect(protocol).toMatchObject({
      status: 'closed',
      closure: { by: 'Ana Admin', reason: 'Tutor mudou de cidade' },
    });
    expect(
      (
        await admin.send(
          'POST',
          `/api/clinical/patients/${thor.id}/protocols/${rabies!.id}/close`,
          { reason: 'De novo' },
        )
      ).statusCode,
    ).toBe(409);

    await apply(thor, application(rabies!, 2, today, shift(today, 365)));
    [protocol] = await protocolsOf(thor);
    expect([protocol?.status, protocol?.closure]).toEqual(['scheduled', null]);
  });
});

describe('consulta Vacinação [p.17]', () => {
  it('lista vencidas e a vencer com o contato, sem encerrados nem animais inativos', async () => {
    const [rabies] = (await admin.get('/api/vaccines'))
      .json<Vaccine[]>()
      .filter((v) => v.name === 'Antirrábica');
    const [dewormer] = (await admin.get('/api/vaccines'))
      .json<Vaccine[]>()
      .filter((v) => v.name === 'Vermífugo');
    const old = shift(today, -400);
    await apply(thor, application(rabies!, 1, old, shift(old, 365)));
    await apply(thor, application(dewormer!, 1, shift(today, -80), shift(today, 10)));
    const client = await send<Client>('POST', '/api/clients', clientInput({ name: 'Rui' }), 201);
    const mel = await send<Patient>(
      'POST',
      '/api/patients',
      { clientId: client.id, patient: patientInput({ name: 'Mel', speciesId: canina.id }) },
      201,
    );
    // Próxima dose daqui a 200 dias: fora da janela padrão de 30 dias.
    await apply(mel, application(rabies!, 1, shift(today, -165), shift(today, 200)));

    let due = (await admin.get('/api/vaccines/due')).json<VaccinationDue>();
    expect(due.until).toBe(shift(today, 30));
    expect([due.total, due.overdue, due.dueSoon]).toEqual([2, 1, 1]);
    expect(due.items.map((i) => [i.patient.name, i.vaccine.name, i.daysLate])).toEqual([
      ['Thor', 'Antirrábica', 35],
      ['Thor', 'Vermífugo', -10],
    ]);
    expect(due.items[0]?.client).toMatchObject({
      name: 'Carla Mendes',
      phone: '11987654321',
      whatsapp: true,
    });

    due = (await admin.get('/api/vaccines/due?situacao=vencidas')).json<VaccinationDue>();
    expect(due.items.map((i) => i.vaccine.name)).toEqual(['Antirrábica']);
    due = (await admin.get('/api/vaccines/due?tipo=dewormer')).json<VaccinationDue>();
    expect(due.items.map((i) => i.vaccine.name)).toEqual(['Vermífugo']);
    due = (
      await admin.get(`/api/vaccines/due?ate=${shift(today, 365)}&situacao=a-vencer`)
    ).json<VaccinationDue>();
    expect(due.items.map((i) => i.patient.name)).toEqual(['Thor', 'Mel']);

    await send('POST', `/api/clinical/patients/${thor.id}/protocols/${rabies!.id}/close`, {
      reason: 'Aplicada em outra clínica',
    });
    due = (await admin.get('/api/vaccines/due')).json<VaccinationDue>();
    expect(due.items.map((i) => i.vaccine.name)).toEqual(['Vermífugo']);

    const reception = await loginAs(h, admin, 'Recepcionista');
    expect((await reception.get('/api/vaccines/due')).statusCode).toBe(200);
    const groomer = await loginAs(h, admin, 'Esteticista');
    expect((await groomer.get('/api/vaccines/due')).statusCode).toBe(403);
  });
});
