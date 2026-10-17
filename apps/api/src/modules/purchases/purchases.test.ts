import type {
  ApiError,
  Entry,
  FinanceOptions,
  Product,
  ProductInput,
  ProductStock,
  Purchase,
  PurchaseInput,
  PurchaseList,
  PurchaseOptions,
} from '@clinica/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ADMIN, createHarness, loginAs, TestClient, type Harness } from '../../test/harness.js';

let h: Harness;
let admin: TestClient;
let options: PurchaseOptions;
let vacina: Product;
let racao: Product;
let luva: Product;

const TZ = 'America/Sao_Paulo';
const today = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
const shift = (date: string, days: number) => {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const inAYear = shift(today, 365);
const inTwoYears = shift(today, 730);

const KEY = '35261011222333000181550010000012341000012345';
const OTHER_KEY = '35261011222333000181550010000012351000012346';

const fieldError = (body: string) => (JSON.parse(body) as ApiError).error.details?.[0];

const productInput = (overrides: Partial<ProductInput>): ProductInput => ({
  kind: 'product',
  serviceKind: null,
  name: 'Item',
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
  salePrice: 10,
  cost: null,
  purpose: 'sale',
  desiredMarkup: null,
  allowPriceChange: false,
  showInPriceList: true,
  discountLimitPercent: null,
  defaultCommissionPercent: 0,
  commissions: [],
  tracksStock: true,
  minStock: null,
  idealStock: null,
  ...overrides,
});

async function createProduct(overrides: Partial<ProductInput>): Promise<Product> {
  const res = await admin.send('POST', '/api/products', productInput(overrides));
  expect(res.statusCode, res.body).toBe(201);
  return res.json<Product>();
}

interface XmlItem {
  code: string;
  ean?: string;
  name: string;
  unit: string;
  quantity: string;
  total: string;
  lots?: { code: string; quantity: string; expiresOn: string }[];
}

/** NF-e de exemplo no leiaute 4.00, com o protocolo de autorização em volta. */
function nfeXml(opts: {
  key?: string;
  number?: string;
  items: XmlItem[];
  freight?: string;
  discount?: string;
  ipi?: string;
  dups?: { dueDate: string; amount: string }[];
}) {
  const items = opts.items;
  const sum = (values: string[]) => values.reduce((s, v) => s + Number(v), 0);
  const goods = sum(items.map((i) => i.total));
  const freight = Number(opts.freight ?? '0');
  const discount = Number(opts.discount ?? '0');
  const ipi = Number(opts.ipi ?? '0');
  const total = (goods + freight - discount + ipi).toFixed(2);
  const det = items
    .map(
      (item, n) => `
      <det nItem="${String(n + 1)}">
        <prod>
          <cProd>${item.code}</cProd>
          <cEAN>${item.ean ?? 'SEM GTIN'}</cEAN>
          <xProd>${item.name}</xProd>
          <NCM>30023000</NCM>
          <CFOP>5102</CFOP>
          <uCom>${item.unit}</uCom>
          <qCom>${item.quantity}</qCom>
          <vUnCom>1.00</vUnCom>
          <vProd>${item.total}</vProd>
          <cEANTrib>SEM GTIN</cEANTrib>
          <uTrib>${item.unit}</uTrib>
          <qTrib>${item.quantity}</qTrib>
          <vUnTrib>1.00</vUnTrib>
          <indTot>1</indTot>
          ${(item.lots ?? [])
            .map(
              (l) =>
                `<rastro><nLote>${l.code}</nLote><qLote>${l.quantity}</qLote><dFab>2026-01-01</dFab><dVal>${l.expiresOn}</dVal></rastro>`,
            )
            .join('')}
        </prod>
        <imposto><vTotTrib>0.00</vTotTrib></imposto>
      </det>`,
    )
    .join('');
  const dups = (opts.dups ?? [])
    .map(
      (d, n) =>
        `<dup><nDup>00${String(n + 1)}</nDup><dVenc>${d.dueDate}</dVenc><vDup>${d.amount}</vDup></dup>`,
    )
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">
  <NFe xmlns="http://www.portalfiscal.inf.br/nfe">
    <infNFe Id="NFe${opts.key ?? KEY}" versao="4.00">
      <ide>
        <cUF>35</cUF><nNF>${opts.number ?? '1234'}</nNF><serie>1</serie>
        <dhEmi>${shift(today, -2)}T10:15:00-03:00</dhEmi>
      </ide>
      <emit>
        <CNPJ>11222333000181</CNPJ>
        <xNome>Distribuidora Vet &amp; Cia Ltda</xNome>
        <xFant>VetDistri</xFant>
        <enderEmit><xLgr>Rua A</xLgr><fone>1133334444</fone></enderEmit>
      </emit>
      ${det}
      <total>
        <ICMSTot>
          <vProd>${goods.toFixed(2)}</vProd>
          <vFrete>${freight.toFixed(2)}</vFrete>
          <vSeg>0.00</vSeg>
          <vDesc>${discount.toFixed(2)}</vDesc>
          <vIPI>${ipi.toFixed(2)}</vIPI>
          <vNF>${total}</vNF>
        </ICMSTot>
      </total>
      ${dups ? `<cobr><fat><nFat>1234</nFat></fat>${dups}</cobr>` : ''}
    </infNFe>
  </NFe>
  <protNFe versao="4.00"><infProt><chNFe>${opts.key ?? KEY}</chNFe></infProt></protNFe>
</nfeProc>`;
}

/** Nota padrão: vacina em dois lotes, ração por saco, luva sem código conhecido. */
const standardXml = (key = KEY) =>
  nfeXml({
    key,
    items: [
      {
        code: 'VAC-01',
        ean: '7891000100103',
        name: 'Vacina V10 dose',
        unit: 'UN',
        quantity: '10.0000',
        total: '400.00',
        lots: [
          { code: 'a123', quantity: '6', expiresOn: inAYear },
          { code: 'B456', quantity: '4', expiresOn: inTwoYears },
        ],
      },
      {
        code: 'RAC-15',
        name: 'Racao Premium 15kg',
        unit: 'SC',
        quantity: '2.0000',
        total: '300.00',
      },
      {
        code: 'LUV-CX',
        name: 'Luva procedimento cx 100',
        unit: 'CX',
        quantity: '1.0000',
        total: '50.00',
      },
    ],
    freight: '30.00',
    discount: '15.00',
    ipi: '10.00',
    dups: [
      { dueDate: shift(today, 28), amount: '387.50' },
      { dueDate: shift(today, 56), amount: '387.50' },
    ],
  });

async function importXml(xml: string, status = 201) {
  const res = await admin.send('POST', '/api/purchases/import', { xml });
  expect(res.statusCode, res.body).toBe(status);
  return res;
}

/** Corpo de edição a partir da compra salva. */
const toInput = (p: Purchase, overrides: Partial<PurchaseInput> = {}): PurchaseInput => ({
  supplierId: p.supplier.id,
  invoiceNumber: p.invoiceNumber,
  invoiceSeries: p.invoiceSeries,
  invoiceKey: p.invoiceKey,
  issuedOn: p.issuedOn,
  enteredOn: p.enteredOn,
  freight: p.freight,
  otherCosts: p.otherCosts,
  discount: p.discount,
  accountId: p.account.id,
  categoryId: p.category.id,
  notes: p.notes,
  items: p.items.map((i) => ({
    productId: i.product?.id ?? null,
    description: i.description,
    supplierCode: i.supplierCode,
    ean: i.ean,
    supplierUnit: i.supplierUnit,
    quantity: i.quantity,
    factor: i.factor,
    total: i.total,
    lot: i.lot,
  })),
  installments: p.installments.map(({ dueDate, amount }) => ({ dueDate, amount })),
  ...overrides,
});

const stockOf = async (product: Product) =>
  (await admin.get(`/api/products/${product.id}/stock`)).json<ProductStock>();

beforeEach(async () => {
  h = await createHarness();
  admin = new TestClient(h.app);
  await admin.login(ADMIN.email, ADMIN.password);
  vacina = await createProduct({ name: 'Vacina V10', barcode: '7891000100103', tracksLots: true });
  racao = await createProduct({ name: 'Ração Premium kg', unit: 'kg', salePrice: 30 });
  luva = await createProduct({ name: 'Luva de procedimento', unit: 'un', salePrice: 1 });
  options = (await admin.get('/api/purchases/options')).json<PurchaseOptions>();
});
afterEach(async () => {
  await h.close();
});

/** Importa a nota padrão e casa ração (saco de 15 kg) e luva (caixa com 100). */
async function importedAndMatched() {
  const imported = (await importXml(standardXml())).json<Purchase>();
  const items = toInput(imported).items.map((item) =>
    item.supplierCode === 'RAC-15'
      ? { ...item, productId: racao.id, factor: 15 }
      : item.supplierCode === 'LUV-CX'
        ? { ...item, productId: luva.id, factor: 100 }
        : item,
  );
  const res = await admin.send(
    'PUT',
    `/api/purchases/${imported.id}`,
    toInput(imported, { items }),
  );
  expect(res.statusCode, res.body).toBe(200);
  return res.json<Purchase>();
}

describe('importação do XML', () => {
  it('cria o rascunho com fornecedor, itens por lote, totais e parcelas da nota', async () => {
    const p = (await importXml(standardXml())).json<Purchase>();
    expect(p).toMatchObject({
      status: 'draft',
      source: 'xml',
      invoiceNumber: '1234',
      invoiceSeries: '1',
      invoiceKey: KEY,
      issuedOn: shift(today, -2),
      enteredOn: today,
      freight: 30,
      otherCosts: 10,
      discount: 15,
      itemsTotal: 750,
      total: 775,
      supplier: { name: 'Distribuidora Vet & Cia Ltda', document: '11222333000181' },
      account: { id: options.defaults.accountId },
      category: { name: 'Compras de mercadorias' },
    });
    expect(
      p.items.map((i) => [i.supplierCode, i.product?.name ?? null, i.quantity, i.total, i.lot]),
    ).toEqual([
      ['VAC-01', 'Vacina V10', 6, 240, { code: 'A123', expiresOn: inAYear }],
      ['VAC-01', 'Vacina V10', 4, 160, { code: 'B456', expiresOn: inTwoYears }],
      ['RAC-15', null, 2, 300, null],
      ['LUV-CX', null, 1, 50, null],
    ]);
    expect(p.installments).toEqual([
      { number: 1, dueDate: shift(today, 28), amount: 387.5 },
      { number: 2, dueDate: shift(today, 56), amount: 387.5 },
    ]);
    // O fornecedor novo já aparece para o financeiro.
    const finance = (await admin.get('/api/finance/options')).json<FinanceOptions>();
    expect(finance.suppliers.map((s) => s.name)).toContain('Distribuidora Vet & Cia Ltda');

    // A mesma nota não entra duas vezes.
    const again = await importXml(standardXml(), 409);
    expect(again.json<ApiError>().error.message).toBe(
      `Esta nota já foi lançada na compra ${String(p.code)}.`,
    );
  });

  it('recusa arquivo que não é NF-e e XML com DOCTYPE', async () => {
    let res = await importXml('<html><body>oi</body></html>', 400);
    expect(fieldError(res.body)).toEqual({
      path: 'xml',
      message: 'O arquivo não é um XML de NF-e',
    });
    res = await importXml(
      '<?xml version="1.0"?><!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><NFe>&e;</NFe>',
      400,
    );
    expect(fieldError(res.body)?.path).toBe('xml');
    res = await importXml('<NFe><infNFe Id="NFe123"></infNFe></NFe>', 400);
    expect(fieldError(res.body)?.message).toBe('A nota não traz a chave de acesso');
  });
});

describe('confirmação', () => {
  it('exige produto em todos os itens e parcelas que fecham com o total', async () => {
    const imported = (await importXml(standardXml())).json<Purchase>();
    let res = await admin.send('POST', `/api/purchases/${imported.id}/confirm`);
    expect(res.statusCode).toBe(400);
    expect(fieldError(res.body)).toEqual({
      path: 'items.2.productId',
      message: 'Escolha o produto de "Racao Premium 15kg"',
    });

    const matched = await importedAndMatched().catch(() => null);
    expect(matched).toBeNull(); // a mesma chave não entra duas vezes

    const items = toInput(imported).items.map((item, i) =>
      i >= 2 ? { ...item, productId: i === 2 ? racao.id : luva.id } : item,
    );
    res = await admin.send(
      'PUT',
      `/api/purchases/${imported.id}`,
      toInput(imported, { items, installments: [{ dueDate: today, amount: 100 }] }),
    );
    expect(res.statusCode, res.body).toBe(200);
    res = await admin.send('POST', `/api/purchases/${imported.id}/confirm`);
    expect(fieldError(res.body)).toEqual({
      path: 'installments',
      message: expect.stringMatching(
        /^As parcelas somam R\$\s100,00, mas a compra soma R\$\s775,00$/,
      ) as string,
    });
  });

  it('dá entrada no estoque por lote, atualiza o custo, aprende o código e lança as parcelas', async () => {
    const draft = await importedAndMatched();
    const res = await admin.send('POST', `/api/purchases/${draft.id}/confirm`);
    expect(res.statusCode, res.body).toBe(200);
    const p = res.json<Purchase>();
    expect(p.status).toBe('confirmed');
    expect(p.confirmedBy).toBe(ADMIN.name);
    // Rateio: frete 30 + IPI 10 − desconto 15 = 25 sobre 750 de itens (3,333...%).
    expect(p.items.map((i) => i.unitCost)).toEqual([41.33, 41.33, 10.33, 0.52]);

    const vac = await stockOf(vacina);
    expect(vac.onHand).toBe(10);
    expect(vac.lots.map((l) => [l.code, l.onHand])).toEqual([
      ['A123', 6],
      ['B456', 4],
    ]);
    expect(vac.movements[0]).toMatchObject({
      kind: 'purchase',
      purchase: { id: p.id, code: p.code },
    });
    expect((await stockOf(racao)).onHand).toBe(30);
    expect((await stockOf(luva)).onHand).toBe(100);
    const product = async (id: string) => (await admin.get(`/api/products/${id}`)).json<Product>();
    expect((await product(vacina.id)).cost).toBe(41.33);
    expect((await product(racao.id)).cost).toBe(10.33);
    expect((await product(luva.id)).cost).toBe(0.52);

    expect(p.entries.map((e) => [e.installment, e.dueDate, e.amount, e.status])).toEqual([
      [1, shift(today, 28), 387.5, 'open'],
      [2, shift(today, 56), 387.5, 'open'],
    ]);
    const entry = (await admin.get(`/api/finance/entries/${p.entries[0]!.id}`)).json<Entry>();
    expect(entry).toMatchObject({
      origin: 'purchase',
      description: `Compra ${String(p.code)} - Distribuidora Vet & Cia Ltda - NF 1234`,
      document: '1234',
      supplier: { name: 'Distribuidora Vet & Cia Ltda' },
      category: { name: 'Compras de mercadorias' },
      competenceDate: shift(today, -2),
      purchase: { id: p.id, code: p.code },
      installment: { number: 1, total: 2 },
    });

    // A parcela acompanha a compra: não se edita nem cancela pelo financeiro.
    let blocked = await admin.send('POST', `/api/finance/entries/${entry.id}/cancel`, {
      reason: 'teste',
    });
    expect(blocked.statusCode).toBe(409);
    blocked = await admin.send('PUT', `/api/finance/entries/${entry.id}`, {
      description: 'Outra descrição',
      document: '',
      accountId: entry.account.id,
      categoryId: entry.category!.id,
      supplierId: null,
      costCenterId: null,
      amount: 1,
      dueDate: today,
      competenceDate: today,
      notes: '',
    });
    expect(blocked.statusCode, blocked.body).toBe(409);

    // Confirmada não muda.
    const edit = await admin.send('PUT', `/api/purchases/${p.id}`, toInput(p));
    expect(edit.statusCode).toBe(409);

    // Outra nota do mesmo fornecedor já vem casada pelo código aprendido, com o fator.
    const next = (await importXml(standardXml(OTHER_KEY))).json<Purchase>();
    expect(next.items.map((i) => [i.product?.name ?? null, i.factor])).toEqual([
      ['Vacina V10', 1],
      ['Vacina V10', 1],
      ['Ração Premium kg', 15],
      ['Luva de procedimento', 100],
    ]);
  });

  it('compra digitada sem parcelas vira uma parcela na entrada; lote vencido não entra', async () => {
    const base: PurchaseInput = {
      supplierId: '',
      invoiceNumber: '',
      invoiceSeries: '',
      invoiceKey: '',
      issuedOn: null,
      enteredOn: today,
      freight: 0,
      otherCosts: 0,
      discount: 0,
      accountId: options.defaults.accountId!,
      categoryId: options.defaults.categoryId!,
      notes: '',
      items: [
        {
          productId: vacina.id,
          description: 'Vacina V10',
          quantity: 2,
          total: 80,
          lot: { code: 'OLD', expiresOn: shift(today, -1) },
        },
      ],
      installments: [],
    };
    const supplier = await admin.send('POST', '/api/finance/suppliers', {
      name: 'Fornecedor Local',
      document: '',
      phone: '',
      email: '',
      notes: '',
    });
    expect(supplier.statusCode, supplier.body).toBe(201);
    const supplierId = supplier.json<{ id: string }>().id;
    let res = await admin.send('POST', '/api/purchases', { ...base, supplierId });
    expect(res.statusCode, res.body).toBe(201);
    const draft = res.json<Purchase>();
    expect(draft).toMatchObject({
      source: 'manual',
      total: 80,
      code: expect.any(Number) as number,
    });

    res = await admin.send('POST', `/api/purchases/${draft.id}/confirm`);
    expect(fieldError(res.body)).toEqual({
      path: 'items.0.lot.expiresOn',
      message: 'Lote vencido não entra no estoque',
    });
    // Nada ficou pela metade.
    expect((await stockOf(vacina)).onHand).toBe(0);

    const items = [{ ...base.items[0]!, lot: { code: 'NEW', expiresOn: inAYear } }];
    res = await admin.send('PUT', `/api/purchases/${draft.id}`, { ...base, supplierId, items });
    expect(res.statusCode, res.body).toBe(200);
    res = await admin.send('POST', `/api/purchases/${draft.id}/confirm`);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json<Purchase>().entries.map((e) => [e.installment, e.dueDate, e.amount])).toEqual([
      [null, today, 80],
    ]);
  });
});

describe('cancelamento', () => {
  it('desfaz estoque e parcelas; recusa com parcela paga ou estoque que já saiu', async () => {
    const draft = await importedAndMatched();
    const p = (await admin.send('POST', `/api/purchases/${draft.id}/confirm`)).json<Purchase>();
    const first = p.entries[0]!;

    // Parcela paga bloqueia.
    let res = await admin.send('POST', `/api/finance/entries/${first.id}/pay`, {
      paidOn: today,
      accountId: p.account.id,
      amount: 387.5,
    });
    expect(res.statusCode, res.body).toBe(200);
    res = await admin.send('POST', `/api/purchases/${p.id}/cancel`, { reason: 'Nota errada' });
    expect(res.statusCode).toBe(409);
    expect(res.json<ApiError>().error.message).toMatch(/já paga/);
    await admin.send('POST', `/api/finance/entries/${first.id}/reopen`);

    // Estoque que já saiu bloqueia: contagem baixa o lote A123.
    const vac = await stockOf(vacina);
    const lotA = vac.lots.find((l) => l.code === 'A123')!;
    res = await admin.send('POST', `/api/products/${vacina.id}/stock`, {
      kind: 'count',
      countedQuantity: 5,
      lotId: lotA.id,
      notes: 'quebra',
    });
    expect(res.statusCode, res.body).toBe(200);
    res = await admin.send('POST', `/api/purchases/${p.id}/cancel`, { reason: 'Nota errada' });
    expect(res.statusCode).toBe(409);
    expect(res.json<ApiError>().error.message).toMatch(/lote A123 de Vacina V10 já teve saída/);
    await admin.send('POST', `/api/products/${vacina.id}/stock`, {
      kind: 'entry',
      quantity: 1,
      lot: { code: 'A123', expiresOn: inAYear },
      notes: 'achada',
    });

    res = await admin.send('POST', `/api/purchases/${p.id}/cancel`, { reason: 'Nota errada' });
    expect(res.statusCode, res.body).toBe(200);
    const cancelled = res.json<Purchase>();
    expect(cancelled).toMatchObject({ status: 'cancelled', cancelReason: 'Nota errada' });
    expect(cancelled.entries.map((e) => e.status)).toEqual(['cancelled', 'cancelled']);
    expect((await stockOf(vacina)).onHand).toBe(0);
    expect((await stockOf(racao)).onHand).toBe(0);
    expect((await stockOf(luva)).onHand).toBe(0);
    expect((await stockOf(luva)).movements[0]).toMatchObject({
      kind: 'purchase_cancel',
      quantity: -100,
    });

    // A chave fica livre para lançar a nota de novo.
    await importXml(standardXml());
  });

  it('lista com filtros e só para quem vê compras', async () => {
    const draft = await importedAndMatched();
    await admin.send('POST', `/api/purchases/${draft.id}/confirm`);
    const second = (await importXml(standardXml(OTHER_KEY))).json<Purchase>();
    await admin.send('POST', `/api/purchases/${second.id}/cancel`, { reason: 'Duplicada' });

    const list = async (query: string) =>
      (await admin.get(`/api/purchases?${query}`)).json<PurchaseList>();
    expect((await list('')).total).toBe(2);
    const confirmed = await list('situacao=confirmadas');
    expect(confirmed.items).toEqual([
      expect.objectContaining({ id: draft.id, itemCount: 4, total: 775, invoiceNumber: '1234' }),
    ]);
    expect((await list('situacao=canceladas')).items.map((p) => p.id)).toEqual([second.id]);
    expect((await list('q=distribuidora')).total).toBe(2);
    expect((await list(`q=${OTHER_KEY.slice(-10)}`)).items.map((p) => p.id)).toEqual([second.id]);

    const recep = await loginAs(h, admin, 'Recepcionista');
    expect((await recep.get('/api/purchases')).statusCode).toBe(403);
    expect(
      (await recep.send('POST', '/api/purchases/import', { xml: standardXml() })).statusCode,
    ).toBe(403);
  });
});
