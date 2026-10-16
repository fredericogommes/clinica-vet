import type { ApiError, AuditEntry, Breed, CatalogItem, Client, Patient } from '@clinica/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clientInput, patientInput } from '../../test/fixtures.js';
import { ADMIN, createHarness, loginAs, TestClient, type Harness } from '../../test/harness.js';

let h: Harness;
let admin: TestClient;
let owner: Client;
let canina: CatalogItem;
let felina: CatalogItem;

beforeEach(async () => {
  h = await createHarness();
  admin = new TestClient(h.app);
  await admin.login(ADMIN.email, ADMIN.password);
  owner = (await admin.send('POST', '/api/clients', clientInput())).json<Client>();
  [canina, felina] = (await admin.get('/api/catalogs/species')).json<CatalogItem[]>() as [
    CatalogItem,
    CatalogItem,
  ];
});
afterEach(async () => {
  await h.close();
});

const breedOf = async (species: CatalogItem) =>
  (await admin.get(`/api/catalogs/species/${species.id}/breeds`)).json<Breed[]>()[0]!;

const createPatient = async (
  overrides: Parameters<typeof patientInput>[0] = {},
  clientId = owner.id,
) => {
  const res = await admin.send('POST', '/api/patients', {
    clientId,
    patient: patientInput(overrides),
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json<Patient>();
};

describe('cadastro de animais', () => {
  it('cadastra com espécie, raça, marcações e responsável atual no histórico', async () => {
    const srd = await breedOf(canina);
    const patient = await createPatient({
      speciesId: canina.id,
      breedId: srd.id,
      birthDate: '2020-03-10',
      markings: ['Agressivo', 'Alergia a dipirona', 'Agressivo'],
    });
    expect(patient).toMatchObject({
      code: 1,
      speciesName: 'Canina',
      breedName: 'Sem raça definida (SRD)',
      markings: ['Agressivo', 'Alergia a dipirona'],
      owner: { id: owner.id, primaryPhone: '11987654321' },
    });
    expect(patient.ownerHistory).toHaveLength(1);
    expect(patient.ownerHistory[0]?.to).toBeNull();
  });

  it('rejeita raça de outra espécie (RN-07)', async () => {
    const srdFelina = await breedOf(felina);
    const res = await admin.send('POST', '/api/patients', {
      clientId: owner.id,
      patient: patientInput({ speciesId: canina.id, breedId: srdFelina.id }),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json<ApiError>().error.details).toContainEqual({
      path: 'patient.breedId',
      message: 'A raça não pertence à espécie selecionada',
    });
  });

  it('rejeita raça sem espécie, óbito em animal vivo e nascimento futuro', async () => {
    const srd = await breedOf(canina);
    for (const patient of [
      patientInput({ breedId: srd.id }),
      patientInput({ deceasedOn: '2024-01-01' }),
      patientInput({ birthDate: '2999-01-01' }),
    ]) {
      const res = await admin.send('POST', '/api/patients', { clientId: owner.id, patient });
      expect(res.statusCode).toBe(400);
    }
  });

  it('registra óbito com data e impede microchip repetido', async () => {
    const p = await createPatient({ microchip: '985112003456789' });
    const res = await admin.send(
      'PUT',
      `/api/patients/${p.id}`,
      patientInput({ status: 'deceased', deceasedOn: '2026-01-05', microchip: '985112003456789' }),
    );
    expect(res.json<Patient>()).toMatchObject({ status: 'deceased', deceasedOn: '2026-01-05' });
    const dup = await admin.send('POST', '/api/patients', {
      clientId: owner.id,
      patient: patientInput({ name: 'Outro', microchip: '985112003456789' }),
    });
    expect(dup.statusCode).toBe(409);
    expect(dup.json<ApiError>().error.message).toBe('Já existe um animal com este microchip.');
  });

  it('não cadastra animal para cliente arquivado', async () => {
    await admin.send('POST', `/api/clients/${owner.id}/archive`);
    const res = await admin.send('POST', '/api/patients', {
      clientId: owner.id,
      patient: patientInput(),
    });
    expect(res.statusCode).toBe(400);
  });

  it('busca por nome do animal, do responsável e código', async () => {
    await createPatient({ name: 'Mel' });
    await createPatient({ name: 'Bidu' });
    const search = async (q: string) =>
      (await admin.get(`/api/patients?q=${encodeURIComponent(q)}`))
        .json<{ items: { name: string }[] }>()
        .items.map((p) => p.name);
    expect(await search('mel')).toEqual(['Mel']);
    expect(await search('carla')).toEqual(['Bidu', 'Mel']);
    expect(await search('2')).toEqual(['Bidu']);
  });
});

describe('troca de responsável (RN-05)', () => {
  it('fecha o vínculo anterior, abre o novo e audita, preservando o histórico', async () => {
    const patient = await createPatient();
    const novo = (
      await admin.send('POST', '/api/clients', clientInput({ name: 'Diego Lima' }))
    ).json<Client>();
    const res = await admin.send('POST', `/api/patients/${patient.id}/transfer`, {
      clientId: novo.id,
      reason: 'Doação',
    });
    expect(res.statusCode).toBe(200);
    const moved = res.json<Patient>();
    expect(moved.owner.name).toBe('Diego Lima');
    expect(moved.ownerHistory.map((o) => [o.clientName, o.to === null, o.reason])).toEqual([
      ['Diego Lima', true, 'Doação'],
      ['Carla Mendes', false, null],
    ]);

    const old = (await admin.get(`/api/clients/${owner.id}`)).json<Client>();
    expect(old.patients).toHaveLength(0);
    const audit = (await admin.get('/api/admin/audit')).json<{ items: AuditEntry[] }>();
    expect(audit.items.find((a) => a.action === 'transfer_owner')?.after).toMatchObject({
      owner: { name: 'Diego Lima' },
      reason: 'Doação',
    });

    const same = await admin.send('POST', `/api/patients/${patient.id}/transfer`, {
      clientId: novo.id,
      reason: '',
    });
    expect(same.statusCode).toBe(409);
  });

  it('exige patients.transfer_owner', async () => {
    const patient = await createPatient();
    const novo = (
      await admin.send('POST', '/api/clients', clientInput({ name: 'Diego Lima' }))
    ).json<Client>();
    const recep = await loginAs(h, admin, 'Recepcionista');
    const res = await recep.send('POST', `/api/patients/${patient.id}/transfer`, {
      clientId: novo.id,
      reason: '',
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('arquivamento', () => {
  it('animal arquivado não pode ser editado até ser restaurado', async () => {
    const patient = await createPatient();
    await admin.send('POST', `/api/patients/${patient.id}/archive`);
    const edit = await admin.send(
      'PUT',
      `/api/patients/${patient.id}`,
      patientInput({ name: 'Novo' }),
    );
    expect(edit.statusCode).toBe(409);
    await admin.send('POST', `/api/patients/${patient.id}/restore`);
    const ok = await admin.send(
      'PUT',
      `/api/patients/${patient.id}`,
      patientInput({ name: 'Novo' }),
    );
    expect(ok.statusCode).toBe(200);
  });
});
