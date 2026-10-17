import type {
  ApiError,
  Client,
  ClientPackageDetail,
  Patient,
  PackageList,
  PaymentMethod,
  Product,
  ProductInput,
  Sale,
  Session,
} from '@clinica/contracts';
import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addDays, instantToZoned } from '../../core/zoned-time.js';
import { clientInput, patientInput } from '../../test/fixtures.js';
import { ADMIN, createHarness, loginAs, TestClient, type Harness } from '../../test/harness.js';

let h: Harness;
let admin: TestClient;
let adminId: string;
let client: Client;
let thor: Patient;
let banho: Product;
let pacote: Product;
let dinheiro: PaymentMethod;

const service = (o: Partial<ProductInput>): ProductInput => ({
  kind: 'service',
  serviceKind: 'grooming',
  name: 'Banho',
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
  salePrice: 60,
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
  ...o,
});

const today = () => instantToZoned(new Date(), 'America/Sao_Paulo').date;
const fieldError = (body: string) => (JSON.parse(body) as ApiError).error.details?.[0];

async function sellPackage(quantity = 1, clientId: string | null = client.id) {
  let res = await admin.send('POST', '/api/sales', {
    kind: 'sale',
    saleType: 'in_person_consumer',
    clientId,
    patientId: clientId ? thor.id : null,
    items: [{ productId: pacote.id, professionalId: adminId, quantity, unitPrice: null }],
    discount: { mode: 'amount', value: 0 },
    notes: '',
  });
  expect(res.statusCode, res.body).toBe(201);
  const sale = res.json<Sale>();
  res = await admin.send('POST', `/api/sales/${sale.id}/receive`, {
    payments: [{ methodId: dinheiro.id, amount: sale.netTotal, installments: 1 }],
  });
  return { sale, res };
}

async function packagesOf(query = ''): Promise<PackageList> {
  const res = await admin.get(`/api/sales/packages${query}`);
  expect(res.statusCode, res.body).toBe(200);
  return res.json<PackageList>();
}

const useSession = (id: string, o: Record<string, unknown> = {}, as = admin) =>
  as.send('POST', `/api/sales/packages/${id}/usages`, {
    usedOn: today(),
    patientId: thor.id,
    professionalId: adminId,
    notes: '',
    ...o,
  });

beforeEach(async () => {
  h = await createHarness();
  admin = new TestClient(h.app);
  await admin.login(ADMIN.email, ADMIN.password);
  adminId = (await admin.get('/api/auth/session')).json<Session>().user.id;
  client = (
    await admin.send('POST', '/api/clients', clientInput({ name: 'Carla Mendes' }))
  ).json<Client>();
  thor = (
    await admin.send('POST', '/api/patients', {
      clientId: client.id,
      patient: patientInput({ name: 'Thor' }),
    })
  ).json<Patient>();
  banho = (await admin.send('POST', '/api/products', service({}))).json<Product>();
  const res = await admin.send(
    'POST',
    '/api/products',
    service({
      serviceKind: 'package',
      name: 'Pacote 3 banhos',
      salePrice: 150,
      package: { serviceId: banho.id, sessions: 3, validityDays: 60 },
    }),
  );
  expect(res.statusCode, res.body).toBe(201);
  pacote = res.json<Product>();
  dinheiro = (await admin.get('/api/payment-methods'))
    .json<PaymentMethod[]>()
    .find((m) => m.kind === 'cash')!;
  expect((await admin.send('POST', '/api/cash', { openingAmount: 0 })).statusCode).toBe(201);
});
afterEach(async () => {
  await h.close();
});

describe('pacotes vendidos [p.10]', () => {
  it('cadastro: pacote aponta um serviço, com sessões e validade', async () => {
    expect(pacote.package).toEqual({
      service: { id: banho.id, name: 'Banho' },
      sessions: 3,
      validityDays: 60,
    });
    let res = await admin.send(
      'POST',
      '/api/products',
      service({ serviceKind: 'package', name: 'Sem serviço' }),
    );
    expect(res.statusCode).toBe(400);
    expect(fieldError(res.body)?.path).toBe('package.serviceId');
    // Pacote não contém outro pacote.
    res = await admin.send(
      'POST',
      '/api/products',
      service({
        serviceKind: 'package',
        name: 'Pacote de pacote',
        package: { serviceId: pacote.id, sessions: 2, validityDays: null },
      }),
    );
    expect(res.statusCode).toBe(400);
    expect(fieldError(res.body)?.message).toContain('não seja outro pacote');
    // Serviço comum ignora a configuração de pacote.
    res = await admin.send(
      'POST',
      '/api/products',
      service({
        name: 'Tosa',
        package: { serviceId: banho.id, sessions: 5, validityDays: null },
      }),
    );
    expect(res.json<Product>().package).toBeNull();
  });

  it('a baixa abre um pacote por unidade; sessões usadas, concluído e desfeito', async () => {
    const { sale, res } = await sellPackage(2);
    expect(res.statusCode, res.body).toBe(200);
    const list = await packagesOf();
    expect(list.total).toBe(2);
    expect(list.items[0]).toMatchObject({
      name: 'Pacote 3 banhos',
      service: { name: 'Banho' },
      client: { name: 'Carla Mendes' },
      patient: { name: 'Thor' },
      sale: { id: sale.id },
      sessions: 3,
      used: 0,
      remaining: 3,
      validUntil: addDays(today(), 60),
      status: 'active',
    });
    const id = list.items[0]!.id;

    // Data futura, antes da venda, animal de outro cliente e profissional inválido são recusados.
    let r = await useSession(id, { usedOn: addDays(today(), 1) });
    expect(fieldError(r.body)?.message).toContain('futura');
    r = await useSession(id, { usedOn: addDays(today(), -1) });
    expect(fieldError(r.body)?.message).toContain('antes da venda');
    const outro = (
      await admin.send('POST', '/api/clients', clientInput({ name: 'Bruno Lima' }))
    ).json<Client>();
    const rex = (
      await admin.send('POST', '/api/patients', {
        clientId: outro.id,
        patient: patientInput({ name: 'Rex' }),
      })
    ).json<Patient>();
    r = await useSession(id, { patientId: rex.id });
    expect(fieldError(r.body)?.path).toBe('patientId');

    for (let n = 1; n <= 3; n++) {
      r = await useSession(id, { notes: `Sessão ${String(n)}` });
      expect(r.statusCode, r.body).toBe(200);
    }
    let detail = r.json<ClientPackageDetail>();
    expect(detail).toMatchObject({ used: 3, remaining: 0, status: 'finished' });
    expect(detail.usages.map((u) => u.notes)).toEqual(['Sessão 1', 'Sessão 2', 'Sessão 3']);
    expect(detail.patients).toEqual([{ id: thor.id, name: 'Thor' }]);
    expect((await useSession(id)).statusCode).toBe(409);

    const usage = detail.usages[1]!;
    r = await admin.send('POST', `/api/sales/packages/${id}/usages/${usage.id}/undo`, {
      reason: 'Lançada no pacote errado',
    });
    expect(r.statusCode, r.body).toBe(200);
    detail = r.json<ClientPackageDetail>();
    expect(detail).toMatchObject({ used: 2, remaining: 1, status: 'active' });
    expect(detail.usages[1]?.undone).toMatchObject({ reason: 'Lançada no pacote errado' });
    r = await admin.send('POST', `/api/sales/packages/${id}/usages/${usage.id}/undo`, {
      reason: 'De novo',
    });
    expect(r.statusCode).toBe(409);

    expect((await packagesOf('?status=active')).total).toBe(2);
    expect((await packagesOf('?q=carla')).total).toBe(2);
    expect((await packagesOf('?q=bruno')).total).toBe(0);
    expect((await packagesOf(`?clientId=${outro.id}`)).total).toBe(0);
  });

  it('pacote exige cliente; vencido não usa sessão depois da validade', async () => {
    const { res } = await sellPackage(1, null);
    expect(res.statusCode).toBe(400);
    expect(fieldError(res.body)?.message).toContain('Pacote é do cliente');

    await sellPackage(1);
    const id = (await packagesOf()).items[0]!.id;
    await h.db.execute(
      sql`update client_packages set valid_until = current_date - 2 where id = ${id}`,
    );
    await h.db.execute(
      sql`update sales set sold_at = now() - interval '10 days' where id in
        (select sale_id from client_packages where id = ${id})`,
    );
    expect((await packagesOf('?status=expired')).items.map((p) => p.id)).toEqual([id]);
    const r = await useSession(id);
    expect(fieldError(r.body)?.message).toContain('vencido');
  });

  it('estorno: espera desfazer as sessões e cancela o pacote', async () => {
    const { sale } = await sellPackage(1);
    const id = (await packagesOf()).items[0]!.id;
    const used = (await useSession(id)).json<ClientPackageDetail>();
    let r = await admin.send('POST', `/api/sales/${sale.id}/reverse`, { reason: 'Desistiu' });
    expect(r.statusCode).toBe(409);
    await admin.send('POST', `/api/sales/packages/${id}/usages/${used.usages[0]!.id}/undo`, {
      reason: 'Cliente desistiu do pacote',
    });
    r = await admin.send('POST', `/api/sales/${sale.id}/reverse`, { reason: 'Desistiu' });
    expect(r.statusCode, r.body).toBe(200);
    const detail = (await admin.get(`/api/sales/packages/${id}`)).json<ClientPackageDetail>();
    expect(detail).toMatchObject({ status: 'cancelled', remaining: 0 });
    expect((await useSession(id)).statusCode).toBe(409);
  });

  it('um pacote já vendido não deixa de ser pacote; quem não tem a permissão não vê', async () => {
    await sellPackage(1);
    const res = await admin.send('PUT', `/api/products/${pacote.id}`, {
      ...service({ name: 'Pacote 3 banhos', salePrice: 150 }),
    });
    expect(res.statusCode).toBe(400);
    expect(fieldError(res.body)?.message).toContain('já foi vendido');

    const vet = await loginAs(h, admin, 'Veterinário');
    expect((await vet.get('/api/sales/packages')).statusCode).toBe(200);
    await h.db.execute(
      sql`delete from role_permissions where permission = 'sales.packages'
        and role_id in (select id from roles where name = 'Veterinário')`,
    );
    const vet2 = new TestClient(h.app);
    await vet2.login('veterinrio@clinica.test', 'senha-forte-456');
    expect((await vet2.get('/api/sales/packages')).statusCode).toBe(403);
  });
});
