import type {
  ApiError,
  AuditEntry,
  Client,
  Insurer,
  InsurerInput,
  InsurerOption,
  InsurerPrices,
  Patient,
  Product,
  ProductInput,
} from '@clinica/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clientInput, patientInput, VALID_CNPJ } from '../../test/fixtures.js';
import { ADMIN, createHarness, loginAs, TestClient, type Harness } from '../../test/harness.js';

let h: Harness;
let admin: TestClient;
let client: Client;
let consulta: Product;
let vacina: Product;

const productInput = (overrides: Partial<ProductInput> = {}): ProductInput => ({
  kind: 'service',
  serviceKind: 'consultation',
  name: 'Consulta',
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
  salePrice: 150,
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

const insurerInput = (overrides: Partial<InsurerInput> = {}): InsurerInput => ({
  name: 'PetSaúde',
  document: VALID_CNPJ,
  paymentDays: 45,
  copayPercent: 20,
  requiresAuthorization: false,
  notes: '',
  archived: false,
  ...overrides,
});

async function createProduct(overrides: Partial<ProductInput> = {}): Promise<Product> {
  const res = await admin.send('POST', '/api/products', productInput(overrides));
  expect(res.statusCode, res.body).toBe(201);
  return res.json<Product>();
}

async function createInsurer(overrides: Partial<InsurerInput> = {}): Promise<Insurer> {
  const res = await admin.send('POST', '/api/insurers', insurerInput(overrides));
  expect(res.statusCode, res.body).toBe(201);
  return res.json<Insurer>();
}

beforeEach(async () => {
  h = await createHarness();
  admin = new TestClient(h.app);
  await admin.login(ADMIN.email, ADMIN.password);
  client = (await admin.send('POST', '/api/clients', clientInput())).json<Client>();
  consulta = await createProduct();
  vacina = await createProduct({ name: 'Vacina V10', serviceKind: 'vaccine', salePrice: 90 });
});
afterEach(async () => {
  await h.close();
});

describe('cadastro de convênios', () => {
  it('cadastra, edita e arquiva com auditoria; nome repetido e CNPJ inválido são recusados', async () => {
    const insurer = await createInsurer();
    expect(insurer).toMatchObject({
      name: 'PetSaúde',
      document: '11222333000181',
      paymentDays: 45,
      copayPercent: 20,
      priceCount: 0,
      patientCount: 0,
      archived: false,
    });

    const dup = await admin.send('POST', '/api/insurers', insurerInput({ name: 'petsaúde' }));
    expect(dup.statusCode).toBe(409);
    const bad = await admin.send('POST', '/api/insurers', insurerInput({ document: '123' }));
    expect(bad.statusCode).toBe(400);
    expect(bad.json<ApiError>().error.details).toContainEqual({
      path: 'document',
      message: 'CNPJ inválido',
    });
    const copay = await admin.send(
      'POST',
      '/api/insurers',
      insurerInput({ name: 'Outro', copayPercent: 120 }),
    );
    expect(copay.statusCode).toBe(400);

    const res = await admin.send(
      'PUT',
      `/api/insurers/${insurer.id}`,
      insurerInput({ paymentDays: 30, archived: true }),
    );
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json<Insurer>()).toMatchObject({ paymentDays: 30, archived: true });
    expect((await admin.get('/api/insurers/options')).json<InsurerOption[]>()).toEqual([]);

    const audit = (await admin.get(`/api/admin/audit?entity=insurer&entityId=${insurer.id}`)).json<{
      items: AuditEntry[];
    }>().items;
    expect(audit.map((a) => a.action).sort()).toEqual(['create', 'update']);
  });

  it('só o gestor configura; quem cadastra animais vê os convênios ativos', async () => {
    await createInsurer();
    const recep = await loginAs(h, admin, 'Recepcionista');
    expect((await recep.get('/api/insurers')).statusCode).toBe(403);
    expect((await recep.send('POST', '/api/insurers', insurerInput())).statusCode).toBe(403);
    const options = await recep.get('/api/insurers/options');
    expect(options.statusCode).toBe(200);
    expect(options.json<InsurerOption[]>().map((o) => o.name)).toEqual(['PetSaúde']);
    const gestor = await loginAs(h, admin, 'Gestor da Clínica');
    expect((await gestor.get('/api/insurers')).statusCode).toBe(200);
  });
});

describe('tabela de preços do convênio', () => {
  it('salva a tabela inteira, substitui na próxima vez e conta os itens', async () => {
    const insurer = await createInsurer();
    const res = await admin.send('PUT', `/api/insurers/${insurer.id}/prices`, {
      items: [
        { productId: consulta.id, price: 120, copayPercent: null, requiresAuthorization: false },
        { productId: vacina.id, price: 80, copayPercent: 0, requiresAuthorization: true },
      ],
    });
    expect(res.statusCode, res.body).toBe(200);
    const table = res.json<InsurerPrices>();
    expect(table.insurer.priceCount).toBe(2);
    expect(table.items).toEqual([
      expect.objectContaining({ name: 'Consulta', salePrice: 150, price: 120, copayPercent: null }),
      expect.objectContaining({
        name: 'Vacina V10',
        price: 80,
        copayPercent: 0,
        requiresAuthorization: true,
      }),
    ]);

    const again = await admin.send('PUT', `/api/insurers/${insurer.id}/prices`, {
      items: [{ productId: vacina.id, price: 85, copayPercent: 10, requiresAuthorization: false }],
    });
    expect(again.json<InsurerPrices>().items).toEqual([
      expect.objectContaining({ name: 'Vacina V10', price: 85, copayPercent: 10 }),
    ]);
    const audit = (
      await admin.get(`/api/admin/audit?entity=insurer_prices&entityId=${insurer.id}`)
    ).json<{ items: AuditEntry[] }>().items;
    expect(audit).toHaveLength(2);
  });

  it('recusa item repetido, de uso interno ou arquivado, mas mantém o que já estava', async () => {
    const insurer = await createInsurer();
    const repeated = await admin.send('PUT', `/api/insurers/${insurer.id}/prices`, {
      items: [
        { productId: consulta.id, price: 120, copayPercent: null, requiresAuthorization: false },
        { productId: consulta.id, price: 110, copayPercent: null, requiresAuthorization: false },
      ],
    });
    expect(repeated.statusCode).toBe(400);
    expect(repeated.json<ApiError>().error.details).toContainEqual({
      path: 'items.1.productId',
      message: 'Item repetido na tabela',
    });

    const internal = await createProduct({
      name: 'Luva',
      kind: 'product',
      serviceKind: null,
      purpose: 'internal',
    });
    const candidates = (await admin.get('/api/insurers/products?q=')).json<{ name: string }[]>();
    expect(candidates.map((c) => c.name)).toEqual(['Consulta', 'Vacina V10']);
    const res = await admin.send('PUT', `/api/insurers/${insurer.id}/prices`, {
      items: [
        { productId: internal.id, price: 1, copayPercent: null, requiresAuthorization: false },
      ],
    });
    expect(res.statusCode).toBe(400);
    expect(res.json<ApiError>().error.details).toContainEqual({
      path: 'items.0.productId',
      message: 'Item indisponível para venda',
    });

    const item = {
      productId: vacina.id,
      price: 80,
      copayPercent: null,
      requiresAuthorization: false,
    };
    await admin.send('PUT', `/api/insurers/${insurer.id}/prices`, { items: [item] });
    expect((await admin.send('POST', `/api/products/${vacina.id}/archive`)).statusCode).toBe(200);
    const kept = await admin.send('PUT', `/api/insurers/${insurer.id}/prices`, {
      items: [{ ...item, price: 82 }],
    });
    expect(kept.statusCode, kept.body).toBe(200);
  });
});

describe('plano de saúde do animal', () => {
  it('guarda convênio, carteirinha e validade; plano vencido ou de convênio arquivado não vale', async () => {
    const insurer = await createInsurer();
    const res = await admin.send('POST', '/api/patients', {
      clientId: client.id,
      patient: {
        ...patientInput(),
        insurance: { insurerId: insurer.id, cardNumber: ' 123.456 ', validUntil: '' },
      },
    });
    expect(res.statusCode, res.body).toBe(201);
    const thor = res.json<Patient>();
    expect(thor.insurance).toEqual({
      insurerId: insurer.id,
      insurerName: 'PetSaúde',
      cardNumber: '123.456',
      validUntil: null,
      active: true,
    });
    expect((await admin.get('/api/insurers')).json<Insurer[]>()[0]?.patientCount).toBe(1);

    const expired = await admin.send('PUT', `/api/patients/${thor.id}`, {
      ...patientInput(),
      insurance: { insurerId: insurer.id, cardNumber: '123.456', validUntil: '2020-01-31' },
    });
    expect(expired.statusCode, expired.body).toBe(200);
    expect(expired.json<Patient>().insurance).toMatchObject({ active: false });

    await admin.send('PUT', `/api/insurers/${insurer.id}`, insurerInput({ archived: true }));
    // Editar outro dado do animal mantém o plano do convênio arquivado.
    const kept = await admin.send('PUT', `/api/patients/${thor.id}`, {
      ...patientInput({ name: 'Thor II' }),
      insurance: { insurerId: insurer.id, cardNumber: '123.456', validUntil: null },
    });
    expect(kept.statusCode, kept.body).toBe(200);
    expect(kept.json<Patient>().insurance).toMatchObject({
      insurerName: 'PetSaúde',
      active: false,
    });

    const fresh = await admin.send('POST', '/api/patients', {
      clientId: client.id,
      patient: {
        ...patientInput({ name: 'Mel' }),
        insurance: { insurerId: insurer.id, cardNumber: '9', validUntil: null },
      },
    });
    expect(fresh.statusCode).toBe(400);
    expect(fresh.json<ApiError>().error.details).toContainEqual({
      path: 'patient.insurance.insurerId',
      message: 'Convênio indisponível',
    });

    const removed = await admin.send('PUT', `/api/patients/${thor.id}`, {
      ...patientInput(),
      insurance: null,
    });
    expect(removed.json<Patient>().insurance).toBeNull();
  });

  it('exige a carteirinha', async () => {
    const insurer = await createInsurer();
    const res = await admin.send('POST', '/api/patients', {
      clientId: client.id,
      patient: { ...patientInput(), insurance: { insurerId: insurer.id, cardNumber: ' ' } },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json<ApiError>().error.details).toContainEqual({
      path: 'patient.insurance.cardNumber',
      message: 'Informe o número da carteirinha',
    });
  });
});
