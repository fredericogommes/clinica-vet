import type {
  AppointmentType,
  AuditEntry,
  ClinicalEvent,
  ClinicalEventInput,
  Client,
  Patient,
  PatientSales,
  Product,
  ProductInput,
  Sale,
  Session,
} from '@clinica/contracts';
import { emptyVitals } from '@clinica/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { provisionOrganization } from '../admin/provisioning.js';
import { clientInput, patientInput } from '../../test/fixtures.js';
import { ADMIN, createHarness, loginAs, TestClient, type Harness } from '../../test/harness.js';

let h: Harness;
let admin: TestClient;
let adminId: string;
let client: Client;
let thor: Patient;
let consulta: AppointmentType;
let consultaService: Product;
let vermifugo: Product;

const productInput = (overrides: Partial<ProductInput> = {}): ProductInput => ({
  kind: 'product',
  serviceKind: null,
  name: 'Vermífugo',
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
  salePrice: 40,
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
  ...overrides,
});

async function createProduct(overrides: Partial<ProductInput> = {}): Promise<Product> {
  const res = await admin.send('POST', '/api/products', productInput(overrides));
  expect(res.statusCode, res.body).toBe(201);
  return res.json<Product>();
}

const setTypeService = (serviceId: string | null) =>
  admin.send('PUT', `/api/catalogs/appointment-types/${consulta.id}`, {
    name: consulta.name,
    durationMinutes: consulta.durationMinutes,
    recordTemplate: consulta.recordTemplate,
    serviceId,
    archived: false,
  });

const encounter = (overrides: Partial<Extract<ClinicalEventInput, { kind: 'encounter' }>> = {}) =>
  ({
    kind: 'encounter',
    occurredAt: null,
    typeId: consulta.id,
    appointmentId: null,
    summary: 'Consulta de rotina',
    narrative: 'Sem queixas',
    vitals: emptyVitals,
    pathologyIds: [],
    publish: true,
    ...overrides,
  }) satisfies ClinicalEventInput;

async function record(body: ClinicalEventInput, as = admin): Promise<ClinicalEvent> {
  const res = await as.send('POST', `/api/clinical/patients/${thor.id}/events`, body);
  expect(res.statusCode, res.body).toBe(201);
  return res.json<ClinicalEvent>();
}

const patientSales = async (as = admin) => {
  const res = await as.get(`/api/sales/patient/${thor.id}`);
  expect(res.statusCode, res.body).toBe(200);
  return res.json<PatientSales>();
};

beforeEach(async () => {
  h = await createHarness();
  admin = new TestClient(h.app);
  await admin.login(ADMIN.email, ADMIN.password);
  adminId = (await admin.get('/api/auth/session')).json<Session>().user.id;
  client = (await admin.send('POST', '/api/clients', clientInput())).json<Client>();
  thor = (
    await admin.send('POST', '/api/patients', {
      clientId: client.id,
      patient: patientInput({ name: 'Thor' }),
    })
  ).json<Patient>();
  const types = (await admin.get('/api/catalogs/appointment-types')).json<AppointmentType[]>();
  consulta = types.find((t) => t.name === 'Consulta')!;
  consultaService = await createProduct({
    kind: 'service',
    serviceKind: 'consultation',
    name: 'Consulta clínica',
    salePrice: 180,
    defaultCommissionPercent: 20,
  });
  vermifugo = await createProduct();
});
afterEach(async () => {
  await h.close();
});

describe('serviço do tipo de atendimento', () => {
  it('aceita só serviço ativo da clínica e registra no histórico', async () => {
    let res = await setTypeService(vermifugo.id);
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: { details: { path: string }[] } }>().error.details[0]?.path).toBe(
      'serviceId',
    );
    res = await setTypeService(consultaService.id);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json<AppointmentType>().service).toEqual({
      id: consultaService.id,
      name: 'Consulta clínica',
    });
    const audit = (
      await admin.get(`/api/admin/audit?entity=appointment_type&entityId=${consulta.id}`)
    ).json<{ items: AuditEntry[] }>();
    expect(audit.items[0]?.after).toMatchObject({ service: 'Consulta clínica' });
  });
});

describe('lançamentos da ficha na venda aberta [RN-19]', () => {
  it('atendimento finalizado lança o serviço uma vez, com o autor como profissional', async () => {
    await setTypeService(consultaService.id);
    expect((await patientSales()).open).toBeNull();

    // Rascunho não cobra; publicar cobra; corrigir depois não cobra de novo.
    const draft = await record(encounter({ publish: false }));
    expect((await patientSales()).open).toBeNull();
    let res = await admin.send('PUT', `/api/clinical/events/${draft.id}`, encounter());
    expect(res.statusCode, res.body).toBe(200);
    res = await admin.send(
      'PUT',
      `/api/clinical/events/${draft.id}`,
      encounter({ summary: 'Corrigido' }),
    );
    expect(res.statusCode, res.body).toBe(200);

    const { open } = await patientSales();
    expect(open).toMatchObject({
      status: 'open',
      client: { id: client.id },
      patient: { id: thor.id, name: 'Thor' },
      netTotal: 180,
    });
    expect(open?.items).toHaveLength(1);
    expect(open?.items[0]).toMatchObject({
      name: 'Consulta clínica',
      professional: { id: adminId },
      clinicalEventId: draft.id,
    });

    // Outro atendimento, de outro profissional, cai na mesma venda.
    const vet = await loginAs(h, admin, 'Veterinário');
    await record(encounter(), vet);
    const after = (await patientSales()).open;
    expect(after?.id).toBe(open?.id);
    expect(after?.items.map((i) => i.professional.name)).toEqual([ADMIN.name, 'Veterinário']);
    expect(after?.netTotal).toBe(360);
  });

  it('serviço arquivado ou tipo sem serviço não bloqueia o prontuário', async () => {
    await record(encounter());
    expect((await patientSales()).open).toBeNull();
    await setTypeService(consultaService.id);
    await admin.send('POST', `/api/products/${consultaService.id}/archive`);
    await record(encounter());
    expect((await patientSales()).open).toBeNull();
    // Outros tipos de evento nunca cobram.
    await record({ kind: 'observation', occurredAt: null, text: 'Bem disposto' });
    expect((await patientSales()).open).toBeNull();
  });

  it('item lançado pela ficha mantém desconto e preços da venda e a origem ao editar', async () => {
    await setTypeService(consultaService.id);
    const event = await record(encounter());
    let open = (await patientSales()).open!;

    // Desconto de 10% dado no PDV continua valendo para o item novo.
    let res = await admin.send('PUT', `/api/sales/${open.id}`, {
      kind: 'sale',
      saleType: open.saleType,
      clientId: client.id,
      patientId: thor.id,
      items: open.items.map((i) => ({
        id: i.id,
        productId: i.productId,
        professionalId: i.professional.id,
        quantity: i.quantity,
        unitPrice: i.unitPrice,
      })),
      discount: { mode: 'percent', value: 10 },
      notes: '',
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json<Sale>().items[0]?.clinicalEventId).toBe(event.id);

    const recep = await loginAs(h, admin, 'Recepcionista');
    res = await recep.send('POST', `/api/sales/patient/${thor.id}/items`, {
      productId: vermifugo.id,
      professionalId: adminId,
      quantity: 2,
    });
    expect(res.statusCode, res.body).toBe(200);
    open = res.json<Sale>();
    expect(open.items.map((i) => [i.name, i.quantity, i.clinicalEventId])).toEqual([
      ['Consulta clínica', 1, event.id],
      ['Vermífugo', 2, null],
    ]);
    expect([open.grossTotal, open.discountTotal, open.netTotal]).toEqual([260, 26, 234]);

    const audit = (await admin.get(`/api/admin/audit?entity=sale&entityId=${open.id}`)).json<{
      items: AuditEntry[];
    }>();
    expect(audit.items[0]?.action).toBe('add_item');
  });

  it('sem venda aberta, o item abre uma; venda fechada ou de outra unidade não recebe', async () => {
    const res = await admin.send('POST', `/api/sales/patient/${thor.id}/items`, {
      productId: vermifugo.id,
      professionalId: adminId,
      quantity: 1,
    });
    expect(res.statusCode, res.body).toBe(200);
    const sale = res.json<Sale>();
    expect(sale).toMatchObject({ status: 'open', client: { id: client.id }, netTotal: 40 });

    await admin.send('POST', `/api/sales/${sale.id}/cancel`, { reason: 'Lançado errado' });
    const second = (
      await admin.send('POST', `/api/sales/patient/${thor.id}/items`, {
        productId: vermifugo.id,
        professionalId: adminId,
        quantity: 1,
      })
    ).json<Sale>();
    expect(second.id).not.toBe(sale.id);
    const column = await patientSales();
    expect(column.open?.id).toBe(second.id);
    expect(column.recent.map((s) => s.status)).toEqual(['open', 'cancelled']);
  });

  it('outra organização não vê nem lança na venda do animal', async () => {
    await h.db.transaction((tx) =>
      provisionOrganization(tx, {
        organizationName: 'Outra Clínica',
        unitName: 'Sede',
        admin: { name: 'Olga', email: 'olga@outra.test', password: 'senha-forte-789' },
      }),
    );
    const stranger = new TestClient(h.app);
    await stranger.login('olga@outra.test', 'senha-forte-789');
    const olgaId = (await stranger.get('/api/auth/session')).json<Session>().user.id;
    expect((await stranger.get(`/api/sales/patient/${thor.id}`)).statusCode).toBe(404);
    const res = await stranger.send('POST', `/api/sales/patient/${thor.id}/items`, {
      productId: vermifugo.id,
      professionalId: olgaId,
      quantity: 1,
    });
    expect(res.statusCode).toBe(404);
  });
});
