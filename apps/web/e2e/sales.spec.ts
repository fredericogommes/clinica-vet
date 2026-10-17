import type { Client, Session } from '@clinica/contracts';
import { expect, test, type Page } from '@playwright/test';
import { ADMIN_STATE, run, sidebar, toasts } from './helpers';

test.use({ storageState: ADMIN_STATE });

/** Cliente com animal e dois itens à venda, via API: o cadastro não é o objeto deste teste. */
async function seed(page: Page, tag = '') {
  await page.goto('/');
  return page.evaluate(async (suffix) => {
    const session = (await (await fetch('/api/auth/session')).json()) as Session;
    const send = async <T>(path: string, body: unknown): Promise<T> => {
      const r = await fetch(`/api${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-csrf-token': session.csrfToken },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error(`${path}: ${await r.text()}`);
      return (await r.json()) as T;
    };
    const tutor = `Tutor Venda ${suffix}`;
    const client = await send<Client>('/clients', {
      personType: 'individual',
      name: tutor,
      nationality: '',
      sex: null,
      cpf: '',
      cnpj: '',
      rg: '',
      birthDate: '',
      originId: null,
      profession: '',
      municipalRegistration: '',
      notes: '',
      contacts: [],
      address: {
        cep: '',
        street: '',
        number: '',
        complement: '',
        district: '',
        city: '',
        state: '',
      },
    });
    const pet = `Bidu ${suffix}`;
    await send<unknown>('/patients', {
      clientId: client.id,
      patient: {
        name: pet,
        status: 'alive',
        deceasedOn: '',
        sex: 'male',
        sterilized: null,
        birthDate: '',
        speciesId: null,
        breedId: null,
        coatId: null,
        microchip: '',
        hasPedigree: false,
        pedigreeNumber: '',
        markings: [],
      },
    });
    const item = (o: Record<string, unknown>) => ({
      kind: 'product',
      serviceKind: null,
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
    const service = `Consulta venda ${suffix}`;
    const product = `Vermífugo ${suffix}`;
    await send<unknown>(
      '/products',
      item({ kind: 'service', serviceKind: 'consultation', name: service, salePrice: 150 }),
    );
    await send<unknown>('/products', item({ name: product, salePrice: 40 }));
    return { tutor, pet, service, product };
  }, run + tag);
}

test('PDV: venda com profissional por item, limite de desconto, orçamento e cancelamento', async ({
  page,
}) => {
  const { tutor, pet, service, product } = await seed(page);
  await sidebar(page).getByRole('link', { name: 'Ponto de venda' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Ponto de venda');

  // Cliente localizado pelo nome do animal [p.8].
  await page.getByLabel('Localizar cliente').fill(pet);
  await page
    .getByRole('list', { name: 'Clientes encontrados' })
    .getByRole('button', { name: pet })
    .click();
  await expect(page.getByLabel('Animal')).toHaveValue(/.+/);

  // Itens: Enter adiciona o primeiro resultado, como o leitor de código de barras.
  const add = page.getByLabel('Adicionar item');
  await add.fill(service);
  await expect(page.getByRole('list', { name: 'Itens encontrados' })).toContainText(service);
  await add.press('Enter');
  await add.fill(product);
  await expect(page.getByRole('list', { name: 'Itens encontrados' })).toContainText(product);
  await add.press('Enter');
  await page.getByLabel(`Quantidade de ${product}`).fill('2');
  await expect(page.getByLabel(`Profissional de ${service}`)).not.toHaveValue('');

  // Desconto acima do limite é recusado pelo servidor e apontado no campo.
  await page.getByRole('group', { name: 'Desconto em' }).getByText('%', { exact: true }).click();
  await page.getByLabel('Desconto (%)').fill('50');
  await page.getByRole('button', { name: 'Salvar em aberto' }).click();
  await expect(page.getByText(/Desconto acima do seu limite/)).toBeVisible();
  await page.getByLabel('Desconto (%)').fill('5');
  await expect(
    page.getByRole('region', { name: 'Desconto e observações' }).getByText('R$ 218,50'),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Salvar em aberto' }).click();
  await expect(toasts(page).getByText(/Venda \d+ gravada: R\$\s218,50\./)).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(tutor);
  await expect(page.getByText('Em aberto', { exact: true }).first()).toBeVisible();
  // Venda em aberto não volta a orçamento.
  await expect(page.getByRole('group', { name: 'Registrar como' })).toHaveCount(0);

  // Orçamento vira venda sem redigitar.
  await page.getByRole('link', { name: 'Nova venda' }).click();
  await page.getByRole('group', { name: 'Registrar como' }).getByText('Orçamento').click();
  await add.fill(service);
  await expect(page.getByRole('list', { name: 'Itens encontrados' })).toContainText(service);
  await add.press('Enter');
  await page.getByRole('button', { name: 'Salvar orçamento' }).click();
  await expect(toasts(page).getByText(/Orçamento \d+ gravado: R\$\s150,00\./)).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Venda de balcão');
  await page
    .getByRole('group', { name: 'Registrar como' })
    .getByText('Venda', { exact: true })
    .click();
  await page.getByRole('button', { name: 'Converter em venda' }).click();
  await expect(toasts(page).getByText(/Orçamento convertido na venda \d+\./)).toBeVisible();

  // Cancelamento exige motivo e deixa a venda só para leitura.
  await page.getByRole('button', { name: 'Cancelar venda' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Cancelar venda' }).click();
  await expect(dialog.getByText('Explique o motivo em poucas palavras')).toBeVisible();
  await dialog.getByLabel('Motivo').fill('Cliente desistiu');
  await dialog.getByRole('button', { name: 'Cancelar venda' }).click();
  await expect(page.getByRole('note')).toContainText('Motivo: Cliente desistiu');
  await expect(page.getByRole('button', { name: 'Salvar alterações' })).toHaveCount(0);

  // Painel lateral localiza a venda pelo animal.
  await page.getByLabel('Localizar venda').fill(pet);
  await page.getByRole('link', { name: new RegExp(tutor) }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(tutor);
});

test('PDV no celular: formulário em uma coluna, sem rolagem lateral', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { product } = await seed(page);
  await page.goto('/vendas/pdv');
  const add = page.getByLabel('Adicionar item');
  await add.fill(product);
  await expect(page.getByRole('list', { name: 'Itens encontrados' })).toContainText(product);
  await add.press('Enter');
  await expect(page.getByLabel(`Quantidade de ${product}`)).toHaveValue('1');
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBe(
    0,
  );
});

test('ficha clínica: atendimento finalizado e item lançado caem na venda aberta do animal', async ({
  page,
}) => {
  // Sufixo próprio: os outros testes deste arquivo semeiam animais com o mesmo nome.
  const { tutor, pet, service, product } = await seed(page, 'f');
  const type = `Consulta cobrada ${run}`;

  // Tipo de atendimento ligado ao serviço cobrado [RN-19].
  await sidebar(page).getByRole('link', { name: 'Tipos de atendimento' }).click();
  await page.getByRole('button', { name: 'Adicionar', exact: true }).click();
  const typeDialog = page.getByRole('dialog', { name: 'Novo tipo de atendimento' });
  await typeDialog.getByLabel('Nome').fill(type);
  await typeDialog.getByLabel('Serviço cobrado').selectOption({ label: service });
  await typeDialog.getByRole('button', { name: 'Salvar' }).click();
  await expect(toasts(page).getByText('Tipo de atendimento incluído.')).toBeVisible();
  await expect(page.getByRole('listitem').filter({ hasText: type })).toContainText(
    `Cobra ${service}`,
  );

  // Sem venda aberta, a coluna avisa; finalizar o atendimento abre a venda com o serviço.
  await page.goto(`/atendimento?animal=${encodeURIComponent(pet)}`);
  await page.getByRole('link', { name: new RegExp(pet) }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(pet);
  const panel = page.getByRole('region', { name: /^Venda/ });
  await expect(panel.getByText(`Nenhuma venda aberta para ${pet}.`)).toBeVisible();
  await page.getByLabel('Adicionar').getByRole('button', { name: 'Atendimento' }).click();
  const encounter = page.getByRole('dialog', { name: 'Novo atendimento' });
  await encounter.getByLabel('Tipo de atendimento').selectOption({ label: type });
  await encounter.getByLabel('Resumo').fill('Check-up anual');
  await encounter.getByRole('button', { name: 'Finalizar atendimento' }).click();
  await expect(toasts(page).getByText('Atendimento registrado na ficha.')).toBeVisible();
  const items = panel.getByRole('list', { name: 'Itens da venda aberta' });
  await expect(items).toContainText(service);
  await expect(panel.getByRole('heading', { name: /^Venda \d+$/ })).toBeVisible();

  // Item lançado direto da ficha entra na mesma venda.
  const search = panel.getByLabel('Lançar na venda');
  await search.fill(product);
  await expect(page.getByRole('list', { name: 'Itens encontrados' })).toContainText(product);
  await search.press('Enter');
  await expect(
    toasts(page).getByText(new RegExp(`${product} lançado na venda \\d+\\.`)),
  ).toBeVisible();
  await expect(items.getByRole('listitem')).toHaveCount(2);
  await expect(panel).toContainText(/Total\s*R\$\s190,00/);

  // A venda segue para o PDV com a origem de cada item.
  await panel.getByRole('link', { name: 'Abrir no PDV' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(tutor);
  await expect(page.getByText('Lançado pela ficha clínica')).toHaveCount(1);
});

/** Fecha o caixa que o administrador tenha deixado aberto em execuções anteriores. */
async function closeOpenCash(page: Page) {
  await page.evaluate(async () => {
    const session = (await (await fetch('/api/auth/session')).json()) as Session;
    const current = (await (await fetch('/api/cash/current')).json()) as {
      session: { id: string; expectedCash: number } | null;
    };
    if (!current.session) return;
    await fetch(`/api/cash/${current.session.id}/close`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-csrf-token': session.csrfToken },
      body: JSON.stringify({ countedCash: current.session.expectedCash, notes: '' }),
    });
  });
}

test('recebimento e caixa: pagamento dividido, parcelas, sangria, fechamento e estorno', async ({
  page,
}) => {
  const { pet, service, product } = await seed(page, 'r');
  await closeOpenCash(page);
  const card = `Rede Visa Crédito ${run}`;

  // Forma de recebimento com prazo, parcelamento e taxa [RN-27].
  await sidebar(page).getByRole('link', { name: 'Formas de recebimento' }).click();
  await page.getByRole('button', { name: 'Adicionar', exact: true }).click();
  const form = page.getByRole('dialog', { name: 'Nova forma de recebimento' });
  await form.getByLabel('Nome').fill(card);
  await form.getByLabel('Tipo', { exact: true }).selectOption({ label: 'Cartão de crédito' });
  await form.getByLabel('Adquirente', { exact: true }).fill('Rede');
  await form.getByLabel('Bandeira').fill('Visa');
  await form.getByLabel('Prazo de liquidação (dias)').fill('30');
  await form.getByLabel('Taxa da adquirente (%)').fill('3,5');
  await form.getByLabel('Parcelamento').selectOption({ label: 'Até 6×' });
  await form.getByRole('button', { name: 'Salvar' }).click();
  await expect(toasts(page).getByText('Forma de recebimento incluída.')).toBeVisible();
  await expect(page.getByRole('listitem').filter({ hasText: card })).toContainText(
    'Cai em 30 dias · até 6× · taxa 3,5%',
  );

  // Venda de R$ 190,00 recebida em dinheiro e no cartão em 3×.
  await sidebar(page).getByRole('link', { name: 'Ponto de venda' }).click();
  await page.getByLabel('Localizar cliente').fill(pet);
  await page
    .getByRole('list', { name: 'Clientes encontrados' })
    .getByRole('button', { name: pet })
    .click();
  const add = page.getByLabel('Adicionar item');
  await add.fill(service);
  await expect(page.getByRole('list', { name: 'Itens encontrados' })).toContainText(service);
  await add.press('Enter');
  await add.fill(product);
  await expect(page.getByRole('list', { name: 'Itens encontrados' })).toContainText(product);
  await add.press('Enter');
  await page.getByRole('button', { name: 'Registrar recebimento' }).click();

  // Sem caixa aberto, o PDV pede a abertura antes de receber [RN-29].
  const opening = page.getByRole('dialog', { name: 'Abrir caixa' });
  await opening.getByLabel('Troco inicial (R$)').fill('100');
  await opening.getByRole('button', { name: 'Abrir caixa' }).click();
  // O recebimento só segue depois que o caixa abre; o diálogo, modal, esconde o aviso da árvore
  // de acessibilidade, e o caixa aberto é conferido no painel depois do recebimento.

  const dialog = page.getByRole('dialog', { name: /Registrar recebimento da venda \d+/ });
  await expect(dialog.getByLabel('Forma 1: valor')).toHaveValue('190,00');
  await dialog.getByLabel('Forma 1: forma de recebimento').selectOption({ label: 'Dinheiro' });
  await dialog.getByLabel('Forma 1: valor').fill('40');
  await expect(dialog.getByText(/Falta\s*R\$\s150,00/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Dividir com outra forma' }).click();
  await expect(dialog.getByLabel('Forma 2: valor')).toHaveValue('150,00');
  await dialog.getByLabel('Forma 2: forma de recebimento').selectOption({ label: card });
  await dialog.getByLabel('Forma 2: parcelas').selectOption({ label: '3×' });
  await expect(dialog.getByText(/3× de R\$\s50,00/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Receber e baixar venda' }).click();

  await expect(toasts(page).getByText(/Venda \d+ recebida e baixada\./)).toBeVisible();
  await expect(page.getByText('Baixada', { exact: true }).first()).toBeVisible();
  const payments = page.getByRole('list', { name: 'Formas de recebimento' });
  await expect(payments).toContainText('Dinheiro');
  await expect(payments).toContainText(`${card} em 3×`);
  await expect(
    page.getByRole('list', { name: `Parcelas de ${card}` }).getByRole('listitem'),
  ).toHaveCount(3);
  await expect(page.getByRole('list', { name: `Parcelas de ${card}` })).toContainText(
    /taxa R\$\s1,75 = R\$\s48,25/,
  );
  // Baixada não é mais editável.
  await expect(page.getByRole('button', { name: 'Salvar alterações' })).toHaveCount(0);
  const saleUrl = page.url();

  // Caixa: R$ 100 de troco + R$ 40 em dinheiro; cartão não entra na gaveta.
  const cashPanel = page.getByRole('region', { name: /^Caixa \d+$/ });
  await expect(cashPanel).toContainText(/Dinheiro em caixa\s*R\$\s140,00/);
  await cashPanel.getByRole('link', { name: 'Movimentos' }).click();
  await expect(page).toHaveURL(/\/vendas\/caixas\/[0-9a-f-]{36}$/);
  const moves = page.getByRole('list', { name: 'Movimentos do caixa' });
  await expect(moves.getByRole('listitem')).toHaveCount(3);
  await page.getByRole('button', { name: 'Sangria' }).click();
  const withdrawal = page.getByRole('dialog', { name: /Sangria no caixa \d+/ });
  await withdrawal.getByLabel('Valor (R$)').fill('500');
  await withdrawal.getByLabel('Descrição').fill('Depósito no banco');
  await withdrawal.getByRole('button', { name: 'Lançar sangria' }).click();
  await expect(
    withdrawal.getByText(/A sangria passa do dinheiro em caixa \(R\$\s140,00\)/),
  ).toBeVisible();
  await withdrawal.getByLabel('Valor (R$)').fill('30');
  await withdrawal.getByRole('button', { name: 'Lançar sangria' }).click();
  await expect(moves.getByRole('listitem')).toHaveCount(4);

  // Estorno devolve pelo caixa: R$ 40 saem da gaveta.
  await page.goto(saleUrl);
  await page.getByRole('button', { name: 'Estornar venda' }).click();
  const reverse = page.getByRole('dialog', { name: /Estornar venda \d+/ });
  await expect(reverse.getByRole('list', { name: 'Devoluções' })).toContainText(card);
  await reverse.getByLabel('Motivo').fill('Cobrado em duplicidade');
  await reverse.getByRole('button', { name: 'Estornar venda' }).click();
  await expect(toasts(page).getByText(/Venda \d+ estornada/)).toBeVisible();
  await expect(page.getByRole('note')).toContainText('Motivo: Cobrado em duplicidade');
  await expect(cashPanel).toContainText(/Dinheiro em caixa\s*R\$\s70,00/);

  // Fechamento com diferença pede explicação.
  await cashPanel.getByRole('link', { name: 'Movimentos' }).click();
  await page.getByRole('button', { name: 'Fechar caixa' }).click();
  const closing = page.getByRole('dialog', { name: /Fechar caixa \d+/ });
  await closing.getByLabel('Dinheiro contado (R$)').fill('65');
  await expect(closing.getByText('Falta de R$ 5,00.')).toBeVisible();
  await closing.getByRole('button', { name: 'Fechar caixa' }).click();
  await expect(
    closing.getByText('Explique a diferença entre o contado e o esperado'),
  ).toBeVisible();
  await closing.getByLabel('Observação').fill('Troco dado a mais');
  await closing.getByRole('button', { name: 'Fechar caixa' }).click();
  await expect(toasts(page).getByText(/Caixa \d+ fechado\./)).toBeVisible();
  await expect(page.getByText('Fechado', { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/R\$\s5,00 \(falta\)/)).toBeVisible();
});

test('conta do cliente: venda fiado, recebimento parcial em Recebimentos e quitação na venda', async ({
  page,
}) => {
  const { tutor, pet, service, product } = await seed(page, 'c');

  // Venda de R$ 190,00: R$ 40,00 em dinheiro e o resto na conta do cliente [p.10].
  await sidebar(page).getByRole('link', { name: 'Ponto de venda' }).click();
  await page.getByLabel('Localizar cliente').fill(pet);
  await page
    .getByRole('list', { name: 'Clientes encontrados' })
    .getByRole('button', { name: pet })
    .click();
  const add = page.getByLabel('Adicionar item');
  await add.fill(service);
  await expect(page.getByRole('list', { name: 'Itens encontrados' })).toContainText(service);
  await add.press('Enter');
  await add.fill(product);
  await expect(page.getByRole('list', { name: 'Itens encontrados' })).toContainText(product);
  await add.press('Enter');
  await page.getByRole('button', { name: 'Registrar recebimento' }).click();
  const opening = page.getByRole('dialog', { name: 'Abrir caixa' });
  if (await opening.isVisible().catch(() => false)) {
    await opening.getByLabel('Troco inicial (R$)').fill('0');
    await opening.getByRole('button', { name: 'Abrir caixa' }).click();
  }
  const dialog = page.getByRole('dialog', { name: /Registrar recebimento da venda \d+/ });
  await dialog.getByLabel('Forma 1: forma de recebimento').selectOption({ label: 'Dinheiro' });
  await dialog.getByLabel('Forma 1: valor').fill('40');
  await dialog.getByRole('button', { name: 'Dividir com outra forma' }).click();
  await dialog
    .getByLabel('Forma 2: forma de recebimento')
    .selectOption({ label: 'Conta do cliente' });
  await expect(dialog.getByText(/Fica na conta, vence em/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Receber e baixar venda' }).click();
  await expect(toasts(page).getByText(/Venda \d+ recebida e baixada\./)).toBeVisible();
  const debtNote = page.getByRole('note').filter({ hasText: 'Na conta do cliente' });
  await expect(debtNote).toContainText(/R\$\s150,00 a receber/);
  await expect(page.getByRole('list', { name: 'Formas de recebimento' })).toContainText(
    /Falta receber R\$\s150,00/,
  );
  const saleUrl = page.url();

  // Recebimentos: o cliente paga R$ 100,00 agora, no PIX.
  await sidebar(page).getByRole('link', { name: 'Recebimentos' }).click();
  await page.getByLabel('Buscar recebimentos').fill(tutor);
  const row = page.getByRole('row').filter({ hasText: tutor });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText(/R\$\s150,00/);
  await row.getByRole('button', { name: /^Receber venda \d+/ }).click();
  const settle = page.getByRole('dialog', { name: /Receber da conta do cliente, venda \d+/ });
  await expect(settle.getByLabel('Forma 1: valor')).toHaveValue('150,00');
  await expect(
    settle.getByLabel('Forma 1: forma de recebimento').getByRole('option', {
      name: 'Conta do cliente',
    }),
  ).toHaveCount(0);
  await settle.getByLabel('Forma 1: forma de recebimento').selectOption({ label: 'PIX' });
  await settle.getByLabel('Forma 1: valor').fill('200');
  await settle.getByRole('button', { name: 'Receber', exact: true }).click();
  await expect(settle.getByText(/Passou R\$\s50,00 do que falta receber/)).toBeVisible();
  await settle.getByLabel('Forma 1: valor').fill('100');
  await settle.getByRole('button', { name: 'Receber', exact: true }).click();
  await expect(
    toasts(page).getByText(/Recebido R\$\s100,00 da venda \d+\. Continua pendurado R\$\s50,00\./),
  ).toBeVisible();
  await expect(row).toContainText(/R\$\s50,00/);

  // Saldo dos clientes mostra o débito e leva aos recebimentos do cliente.
  await sidebar(page).getByRole('link', { name: 'Saldo dos clientes' }).click();
  const balance = page.getByRole('row').filter({ hasText: tutor });
  await expect(balance).toContainText(/R\$\s50,00/);
  await balance.getByRole('link', { name: `Ver recebimentos de ${tutor}` }).click();
  await expect(page).toHaveURL(/\/vendas\/recebimentos\?cliente=/);
  await expect(page.getByRole('button', { name: `Cliente: ${tutor} · ver todos` })).toBeVisible();
  await expect(page.getByRole('table').getByRole('row')).toHaveCount(2);

  // O resto é recebido na própria venda e a conta fica quitada.
  await page.goto(saleUrl);
  await debtNote.getByRole('button', { name: 'Receber da conta' }).click();
  await expect(settle.getByLabel('Forma 1: valor')).toHaveValue('50,00');
  await settle.getByLabel('Forma 1: forma de recebimento').selectOption({ label: 'Dinheiro' });
  await settle.getByRole('button', { name: 'Receber', exact: true }).click();
  await expect(toasts(page).getByText(/Conta quitada\./)).toBeVisible();
  await expect(debtNote).toHaveCount(0);
  const payments = page.getByRole('list', { name: 'Formas de recebimento' });
  await expect(payments).toContainText('Quitada');
  await expect(payments.getByText(/Recebido da conta do cliente em/)).toHaveCount(2);
});
