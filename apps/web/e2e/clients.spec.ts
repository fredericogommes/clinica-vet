import { expect, test } from '@playwright/test';
import { ADMIN_STATE, run, sidebar, toasts } from './helpers';

test.use({ storageState: ADMIN_STATE });

test('balcão: cadastra cliente com o primeiro animal, completa a ficha e troca o responsável', async ({
  page,
}) => {
  await page.goto('/');

  // Cadastro mínimo (RN-06): nome, celular com WhatsApp e o nome do animal.
  const tutor = `Helena Prado ${run}`;
  const pet = `Pipoca ${run}`;
  await sidebar(page).getByRole('link', { name: 'Clientes', exact: true }).click();
  await page.getByRole('link', { name: 'Novo cliente' }).click();
  await page.getByLabel('Nome completo').fill(tutor);
  await page.getByLabel('Número com DDD').fill('(11) 98877-6655');
  await page.getByLabel('Nome do animal').fill(pet);
  await page.getByLabel('Espécie do animal').selectOption({ label: 'Canina' });
  await page.getByRole('button', { name: 'Cadastrar cliente' }).click();

  await expect(toasts(page).getByText(`Cliente ${tutor} cadastrado.`)).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(tutor);
  await expect(page.getByRole('link', { name: 'WhatsApp' })).toHaveAttribute(
    'href',
    'https://wa.me/5511988776655',
  );

  // Consentimento por canal com origem (RN-04).
  await page.getByRole('button', { name: 'Atualizar' }).click();
  const dialog = page.getByRole('dialog', { name: 'Privacidade e comunicação' });
  await dialog.getByRole('button', { name: 'Registrar' }).click();
  await expect(dialog.getByText('Informe como o consentimento foi obtido')).toBeVisible();
  await dialog.getByLabel('WhatsApp').check();
  await dialog.getByLabel('Como o consentimento foi obtido').fill('Termo assinado no balcão');
  await dialog.getByRole('button', { name: 'Registrar' }).click();
  await expect(toasts(page).getByText('Consentimento registrado.')).toBeVisible();
  await expect(page.getByRole('listitem').filter({ hasText: /^WhatsApp/ })).toContainText('Aceita');

  // Histórico de alterações da ficha vem da auditoria, filtrado pelo cliente (RN-21).
  await page.getByRole('link', { name: 'Histórico', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    `Histórico de alterações · ${tutor}`,
  );
  await expect(page.getByRole('cell', { name: 'Registrou consentimento Cliente' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Criou Cliente' })).toBeVisible();
  await page.goBack();

  // Completa a ficha do animal: raça da espécie e marcação em destaque (RN-07, RN-09).
  await page.getByRole('link', { name: pet }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(pet);
  await page.getByRole('link', { name: 'Editar' }).click();
  await page.getByLabel('Raça').selectOption({ label: 'Sem raça definida (SRD)' });
  await page.getByLabel('Marcações').fill('Agressivo');
  await page.getByLabel('Marcações').press('Enter');
  await page.getByLabel('Nascimento').fill('2021-05-10');
  await page.getByRole('button', { name: 'Salvar alterações' }).click();
  await expect(toasts(page).getByText('Alterações salvas.')).toBeVisible();
  await expect(page.getByRole('note', { name: 'Marcações do animal' })).toContainText('Agressivo');
  await expect(page.getByText(/Canina · Sem raça definida \(SRD\) · .*anos/)).toBeVisible();

  // Reabrir a edição mostra os cadastros já escolhidos (as opções chegam depois do formulário).
  await page.getByRole('link', { name: 'Editar' }).click();
  await expect(page.getByLabel('Espécie')).toHaveValue(/.+/);
  await expect(page.getByLabel('Raça').locator('option:checked')).toHaveText(
    'Sem raça definida (SRD)',
  );
  await page.getByRole('link', { name: 'Cancelar' }).click();

  // Segundo responsável e troca preservando o histórico (RN-05).
  const novo = `Otávio Reis ${run}`;
  await page.goto('/clientes/novo');
  await page.getByLabel('Nome completo').fill(novo);
  await page.getByRole('button', { name: 'Cadastrar cliente' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(novo);

  await sidebar(page).getByRole('link', { name: 'Animais', exact: true }).click();
  await page.getByLabel('Buscar animais').fill(pet);
  await page.getByRole('link', { name: pet }).click();
  await page.getByRole('button', { name: 'Trocar responsável' }).click();
  const transfer = page.getByRole('dialog', { name: /Trocar responsável/ });
  await transfer.getByLabel('Buscar novo responsável').fill(novo);
  await transfer.getByRole('radio', { name: new RegExp(novo) }).click();
  await transfer.getByLabel('Motivo (opcional)').fill('Doação');
  await transfer.getByRole('button', { name: 'Confirmar troca' }).click();
  await expect(toasts(page).getByText(`${pet} agora está com ${novo}.`)).toBeVisible();
  const history = page.getByRole('region', { name: 'Histórico de responsáveis' });
  await expect(history.getByRole('listitem')).toHaveCount(2);
  await expect(history.getByRole('listitem').first()).toContainText('Doação');

  // A busca de clientes encontra o novo responsável pelo nome do animal.
  await sidebar(page).getByRole('link', { name: 'Clientes', exact: true }).click();
  await page.getByLabel('Buscar clientes').fill(pet.toUpperCase());
  await expect(page.getByRole('link', { name: novo })).toBeVisible();
  await expect(page.getByRole('link', { name: tutor })).toHaveCount(0);
});

test('CPF inválido é apontado no campo antes de enviar', async ({ page }) => {
  await page.goto('/clientes/novo');
  await page.getByLabel('Nome completo').fill('Teste CPF');
  await page.getByLabel('CPF').fill('123.456.789-00');
  await page.getByRole('button', { name: 'Cadastrar cliente' }).click();
  await expect(page.getByText('CPF inválido')).toBeVisible();
});

test('cadastros: inclui pelagem e raça na espécie', async ({ page }) => {
  await page.goto('/');
  await sidebar(page).getByRole('link', { name: 'Pelagens', exact: true }).click();
  await page.getByRole('button', { name: 'Adicionar' }).click();
  await page.getByRole('dialog').getByLabel('Nome').fill(`Tigrada ${run}`);
  await page.getByRole('dialog').getByRole('button', { name: 'Salvar' }).click();
  await expect(page.getByText(`Tigrada ${run}`)).toBeVisible();

  await sidebar(page).getByRole('link', { name: 'Espécies e raças', exact: true }).click();
  await page.getByRole('button', { name: 'Felina', exact: true }).click();
  const breeds = page.getByRole('region', { name: 'Raças · Felina' });
  await breeds.getByRole('button', { name: 'Adicionar' }).click();
  await page.getByRole('dialog').getByLabel('Nome').fill(`Siamês ${run}`);
  await page.getByRole('dialog').getByRole('button', { name: 'Salvar' }).click();
  await expect(breeds.getByText(`Siamês ${run}`)).toBeVisible();
});

test('lista de clientes cabe na tela do celular @mobile', async ({ page }) => {
  await page.goto('/clientes');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Clientes');
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
