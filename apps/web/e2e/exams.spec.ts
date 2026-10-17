import type { CatalogItem, Client, Session } from '@clinica/contracts';
import { expect, test, type Page } from '@playwright/test';
import { ADMIN_STATE, run, sidebar, toasts } from './helpers';

test.use({ storageState: ADMIN_STATE });

const tag = run.split('').reverse().join('');

/** Cão adulto (3 anos) com responsável, via API: o cadastro não é o objeto deste teste. */
async function seedDog(page: Page) {
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
    const species = (await (await fetch('/api/catalogs/species')).json()) as CatalogItem[];
    const dog = species.find((s) => s.name === 'Canina') ?? species[0];
    if (!dog) throw new Error('Sem espécies semeadas');
    const client = await send<Client>('/clients', {
      personType: 'individual',
      name: `Tutor Exame ${suffix}`,
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
      contacts: [{ kind: 'mobile', value: '11955553333', isWhatsapp: false }],
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
    const born = new Date();
    born.setFullYear(born.getFullYear() - 3);
    const pet = `Bidu ${suffix}`;
    const created = await send<{ id: string }>('/patients', {
      clientId: client.id,
      patient: {
        name: pet,
        status: 'alive',
        deceasedOn: '',
        sex: 'male',
        sterilized: null,
        birthDate: born.toISOString().slice(0, 10),
        speciesId: dog.id,
        breedId: null,
        coatId: null,
        microchip: '',
        hasPedigree: false,
        pedigreeNumber: '',
        markings: [],
      },
    });
    return { pet, patientId: created.id, species: dog.name };
  }, tag);
}

test('exames: cadastro com seções, referência por espécie e idade, resultado marcado e evolução', async ({
  page,
}) => {
  const { pet, patientId, species } = await seedDog(page);
  const exam = `Bioquímica ${tag}`;

  // Cadastro do exame (F2-1): campos tipados, ordem e seção.
  await sidebar(page).getByRole('link', { name: 'Exames' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Exames');
  await page.getByRole('link', { name: 'Novo exame' }).click();
  await page.getByLabel('Nome', { exact: true }).fill(exam);
  const first = page.getByRole('listitem', { name: /^Campo 1/ });
  await first.getByRole('textbox', { name: 'Campo', exact: true }).fill('Ureia');
  await first.getByLabel('Unidade').fill('mg/dL');
  await page.getByRole('button', { name: 'Adicionar campo' }).click();
  const second = page.getByRole('listitem', { name: /^Campo 2/ });
  await second.getByRole('textbox', { name: 'Campo', exact: true }).fill('Creatinina');
  await second.getByLabel('Unidade').fill('mg/dL');
  await second.getByLabel('Casas').selectOption('2');
  await page.getByRole('button', { name: 'Adicionar campo' }).click();
  const third = page.getByRole('listitem', { name: /^Campo 3/ });
  await third.getByRole('textbox', { name: 'Campo', exact: true }).fill('Aspecto do soro');
  await third.getByLabel('Tipo').selectOption({ label: 'Texto' });
  await page.getByRole('button', { name: 'Adicionar seção' }).click();
  const section = page.getByRole('listitem', { name: /^Seção 4/ });
  await section.getByRole('textbox', { name: 'Seção', exact: true }).fill('Função renal');
  // A seção sobe para o topo: agrupa os campos seguintes.
  for (let i = 0; i < 3; i++) {
    await page.getByRole('button', { name: 'Subir Função renal' }).click();
  }
  await expect(page.getByRole('listitem', { name: /^Seção 1: Função renal/ })).toBeVisible();
  await page.getByRole('button', { name: 'Incluir exame' }).click();
  await expect(
    toasts(page).getByText('Exame incluído. Agora cadastre os valores de referência.'),
  ).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(exam);

  // Referência por espécie e idade: faixas da mesma espécie não se sobrepõem.
  await page.getByRole('tab', { name: 'Valores de referência' }).click();
  const refs = page.getByRole('tabpanel', { name: 'Valores de referência' });
  await expect(refs.getByText('Mínimo de Aspecto do soro')).toHaveCount(0);
  await refs.getByRole('button', { name: 'Adicionar faixa' }).click();
  await refs.getByLabel('Espécie').selectOption({ label: species });
  await refs.getByLabel('Nome da faixa').fill('Adulto');
  await refs.getByLabel('De (meses)').fill('12');
  await refs.getByLabel('Até (meses)').fill('9999');
  await refs.getByLabel('Mínimo de Ureia').fill('21');
  await refs.getByLabel('Máximo de Ureia').fill('60');
  await refs.getByLabel('Mínimo de Creatinina').fill('0,5');
  await refs.getByLabel('Máximo de Creatinina').fill('1,5');
  await refs.getByRole('button', { name: 'Adicionar faixa' }).click();
  await refs.getByLabel('Nome da faixa').nth(1).fill('Filhote');
  await refs.getByLabel('De (meses)').nth(1).fill('0');
  await refs.getByLabel('Até (meses)').nth(1).fill('12');
  await refs.getByRole('button', { name: 'Salvar referências' }).click();
  await expect(refs.getByText('Sobrepõe a faixa "Adulto" da mesma espécie')).toBeVisible();
  await refs.getByLabel('Até (meses)').nth(1).fill('11');
  await refs.getByRole('button', { name: 'Salvar referências' }).click();
  await expect(toasts(page).getByText('Valores de referência salvos.')).toBeVisible();

  // Resultado na ficha: a faixa do animal na data e a marcação ao digitar.
  await page.goto(`/atendimento/${patientId}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(pet);
  await page.getByLabel('Adicionar').getByRole('button', { name: 'Exame' }).click();
  const editor = page.getByRole('dialog', { name: 'Resultado de exame' });
  await editor.getByLabel('Exame', { exact: true }).selectOption({ label: exam });
  await expect(editor.getByText(`Referência: ${species}, Adulto.`)).toBeVisible();
  await expect(editor.getByRole('heading', { name: 'Função renal' })).toBeVisible();
  await editor.getByLabel('Ureia').fill('75');
  await expect(editor.getByText('Acima')).toBeVisible();
  await editor.getByLabel('Creatinina').fill('1,234');
  await editor.getByLabel('Aspecto do soro').fill('Límpido');
  await editor.getByRole('button', { name: 'Finalizar exame' }).click();
  await expect(editor.getByText('Até 2 casas decimais')).toBeVisible();
  await editor.getByLabel('Creatinina').fill('1,2');
  await editor.getByRole('button', { name: 'Finalizar exame' }).click();
  await expect(toasts(page).getByText('Exame registrado na ficha.')).toBeVisible();

  const timeline = page.getByRole('tabpanel', { name: 'Linha do tempo' });
  const result = timeline.getByRole('article', { name: new RegExp(`Exame .*${exam}`) });
  await expect(result).toContainText('1 fora da referência');
  await expect(result).toContainText('Referência: Adulto');
  await expect(result.getByRole('row', { name: /Ureia/ })).toContainText('Acima');
  await expect(result.getByRole('row', { name: /Creatinina/ })).toContainText('1,2');
  await expect(result.getByRole('row', { name: /Aspecto do soro/ })).toContainText('Límpido');

  // Segundo resultado, normal; a evolução mostra os dois.
  await page.getByLabel('Adicionar').getByRole('button', { name: 'Exame' }).click();
  const again = page.getByRole('dialog', { name: 'Resultado de exame' });
  await again.getByLabel('Exame', { exact: true }).selectOption({ label: exam });
  await again.getByLabel('Ureia').fill('40');
  await again.getByRole('button', { name: 'Finalizar exame' }).click();
  await expect(again).toBeHidden();
  await expect(timeline.getByRole('article', { name: new RegExp(`Exame .*${exam}`) })).toHaveCount(
    2,
  );
  await result.first().getByRole('button', { name: 'Evolução de Ureia' }).click();
  const evolution = page.getByRole('dialog', { name: 'Evolução: Ureia' });
  await expect(evolution.getByRole('img', { name: 'Ureia: 2 resultados' })).toBeVisible();
  await expect(evolution.getByRole('row')).toHaveCount(3);
  await expect(evolution.getByText(/Faixa sombreada.*21 – 60 mg\/dL/)).toBeVisible();
});

test('exames no celular: resultado com faixa, sem rolagem lateral @mobile', async ({ page }) => {
  const { patientId } = await seedDog(page);
  const exam = `Glicemia ${tag}`;
  await page.evaluate(async (name) => {
    const session = (await (await fetch('/api/auth/session')).json()) as Session;
    const r = await fetch('/api/exams', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-csrf-token': session.csrfToken },
      body: JSON.stringify({
        name,
        serviceId: null,
        archived: false,
        attributes: [
          {
            id: null,
            kind: 'section',
            name: 'Jejum',
            unit: '',
            dataType: null,
            decimals: null,
            maxLength: null,
          },
          {
            id: null,
            kind: 'field',
            name: 'Glicose',
            unit: 'mg/dL',
            dataType: 'integer',
            decimals: null,
            maxLength: null,
          },
        ],
      }),
    });
    if (!r.ok) throw new Error(await r.text());
  }, exam);
  await page.goto(`/atendimento/${patientId}`);
  await page.getByLabel('Adicionar').getByRole('button', { name: 'Exame' }).click();
  const editor = page.getByRole('dialog', { name: 'Resultado de exame' });
  await editor.getByLabel('Exame', { exact: true }).selectOption({ label: exam });
  await expect(editor.getByLabel('Glicose')).toBeVisible();
  await expect(editor.getByText(/Sem faixa de referência para .* com 3\d meses/)).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBe(0);
});
