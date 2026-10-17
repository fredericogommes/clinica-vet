import type {
  ApiError,
  Box,
  CatalogItem,
  Client,
  ClinicalRecord,
  HospitalizationDetail,
  HospitalizationList,
  HospitalizationOptions,
  Patient,
  Session,
} from '@clinica/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clientInput, patientInput } from '../../test/fixtures.js';
import { ADMIN, createHarness, loginAs, TestClient, type Harness } from '../../test/harness.js';

let h: Harness;
let admin: TestClient;
let adminId: string;
let thor: Patient;
let mia: Patient;
let canina: CatalogItem;

const fieldError = (body: string) => (JSON.parse(body) as ApiError).error.details?.[0];

const admit = (patientId: string, o: Record<string, unknown> = {}, as = admin) =>
  as.send('POST', '/api/hospitalizations', {
    patientId,
    veterinarianId: adminId,
    priority: 'routine',
    reason: 'Gastroenterite com desidratação',
    expectedDischargeOn: null,
    boxId: null,
    ...o,
  });

const createBox = async (o: Record<string, unknown> = {}) => {
  const res = await admin.send('POST', '/api/hospitalizations/boxes', {
    name: 'Box 1',
    code: 'b01',
    kind: 'general',
    capacity: 1,
    speciesIds: [],
    ...o,
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json<Box>();
};

beforeEach(async () => {
  h = await createHarness();
  admin = new TestClient(h.app);
  await admin.login(ADMIN.email, ADMIN.password);
  adminId = (await admin.get('/api/auth/session')).json<Session>().user.id;
  const species = (await admin.get('/api/catalogs/species')).json<CatalogItem[]>();
  canina = species.find((s) => s.name === 'Canina')!;
  const felina = species.find((s) => s.name === 'Felina')!;
  const client = (
    await admin.send('POST', '/api/clients', clientInput({ name: 'Carla Mendes' }))
  ).json<Client>();
  const newPatient = async (name: string, speciesId: string) =>
    (
      await admin.send('POST', '/api/patients', {
        clientId: client.id,
        patient: patientInput({ name, speciesId }),
      })
    ).json<Patient>();
  thor = await newPatient('Thor', canina.id);
  mia = await newPatient('Mia', felina.id);
});
afterEach(async () => {
  await h.close();
});

describe('internação [p.14–16]', () => {
  it('boxes: sigla única na unidade, capacidade e espécies aceitas', async () => {
    const box = await createBox({ speciesIds: [canina.id] });
    expect(box).toMatchObject({
      code: 'B01',
      capacity: 1,
      species: [{ name: 'Canina' }],
      occupied: 0,
      archived: false,
    });
    const dup = await admin.send('POST', '/api/hospitalizations/boxes', {
      name: 'Outro',
      code: 'B01',
      kind: 'icu',
      capacity: 2,
      speciesIds: [],
    });
    expect(dup.statusCode).toBe(400);
    expect(fieldError(dup.body)?.path).toBe('code');

    // Felino não entra em box só de cães; o box lotado recusa o segundo animal.
    let r = await admit(mia.id, { boxId: box.id });
    expect(fieldError(r.body)?.message).toContain('não aceita a espécie');
    r = await admit(thor.id, { boxId: box.id });
    expect(r.statusCode, r.body).toBe(201);
    const other = (
      await admin.send('POST', '/api/patients', {
        clientId: thor.owner.id,
        patient: patientInput({ name: 'Bidu', speciesId: canina.id }),
      })
    ).json<Patient>();
    r = await admit(other.id, { boxId: box.id });
    expect(fieldError(r.body)?.message).toContain('lotado');

    // Box ocupado não arquiva nem fica com capacidade menor que a ocupação.
    const boxes = (await admin.get('/api/hospitalizations/boxes')).json<Box[]>();
    expect(boxes[0]?.occupied).toBe(1);
    r = await admin.send('PUT', `/api/hospitalizations/boxes/${box.id}`, {
      name: 'Box 1',
      code: 'B01',
      kind: 'general',
      capacity: 1,
      speciesIds: [],
      archived: true,
    });
    expect(r.statusCode).toBe(409);
  });

  it('interna, edita, troca de box, registra o histórico e dá alta', async () => {
    const box = await createBox({ capacity: 2 });
    let r = await admit(thor.id, { priority: 'urgent', expectedDischargeOn: '2099-01-10' });
    expect(r.statusCode, r.body).toBe(201);
    let hosp = r.json<HospitalizationDetail>();
    expect(hosp).toMatchObject({
      status: 'admitted',
      priority: 'urgent',
      patient: { name: 'Thor', species: 'Canina' },
      client: { name: 'Carla Mendes' },
      veterinarian: { id: adminId },
      box: null,
      entries: [{ kind: 'admission', text: 'Gastroenterite com desidratação' }],
    });
    expect((await admit(thor.id)).statusCode).toBe(409);

    r = await admin.send('PUT', `/api/hospitalizations/${hosp.id}`, {
      veterinarianId: adminId,
      priority: 'attention',
      reason: 'Gastroenterite com desidratação',
      expectedDischargeOn: '2099-01-12',
    });
    expect(r.statusCode, r.body).toBe(200);
    hosp = r.json<HospitalizationDetail>();
    expect(hosp.entries.at(-1)).toMatchObject({ kind: 'update' });
    expect(hosp.entries.at(-1)?.text).toContain('Prioridade: Urgente → Atenção');
    expect(hosp.entries.at(-1)?.text).toContain('10/01/2099 → 12/01/2099');

    r = await admin.send('POST', `/api/hospitalizations/${hosp.id}/box`, { boxId: box.id });
    expect(r.json<HospitalizationDetail>().box?.code).toBe('B01');

    // Peso também vai para o prontuário e vira o peso atual do animal.
    r = await admin.send('POST', `/api/hospitalizations/${hosp.id}/entries`, {
      kind: 'weight',
      weightKg: 12.35,
    });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json<HospitalizationDetail>().patient.weightKg).toBe(12.35);
    const record = (await admin.get(`/api/clinical/patients/${thor.id}`)).json<ClinicalRecord>();
    expect(record.currentWeight?.weightKg).toBe(12.35);

    // Parâmetros clínicos com opções fechadas [RN-41].
    r = await admin.send('POST', `/api/hospitalizations/${hosp.id}/entries`, {
      kind: 'parameters',
      parameters: { appetite: 'Bom' },
    });
    expect(r.statusCode).toBe(400);
    r = await admin.send('POST', `/api/hospitalizations/${hosp.id}/entries`, {
      kind: 'parameters',
      parameters: {},
    });
    expect(r.statusCode).toBe(400);
    r = await admin.send('POST', `/api/hospitalizations/${hosp.id}/entries`, {
      kind: 'parameters',
      parameters: { appetite: 'Diminuído', feces: 'Diarreicas', heartRate: 120, dehydration: 7.5 },
      text: 'Após fluidoterapia',
    });
    expect(r.statusCode, r.body).toBe(200);
    r = await admin.send('POST', `/api/hospitalizations/${hosp.id}/entries`, {
      kind: 'occurrence',
      text: 'Vomitou após a medicação',
    });
    hosp = r.json<HospitalizationDetail>();
    expect(hosp.entries.map((e) => e.kind)).toEqual([
      'admission',
      'update',
      'box',
      'weight',
      'parameters',
      'occurrence',
    ]);
    expect(hosp.entries[4]?.parameters).toMatchObject({
      appetite: 'Diminuído',
      feces: 'Diarreicas',
      heartRate: 120,
      dehydration: 7.5,
      vomit: null,
    });

    let list = (await admin.get('/api/hospitalizations')).json<HospitalizationList>();
    expect(list.items.map((i) => i.id)).toEqual([hosp.id]);

    r = await admin.send('POST', `/api/hospitalizations/${hosp.id}/close`, {
      outcome: 'discharged',
      notes: 'Alta com retorno em 7 dias',
    });
    expect(r.json<HospitalizationDetail>()).toMatchObject({
      status: 'discharged',
      outcome: 'Alta com retorno em 7 dias',
    });
    expect(r.json<HospitalizationDetail>().endedAt).not.toBeNull();
    // Encerrada não muda mais; o box fica livre e ela vai para o histórico.
    r = await admin.send('POST', `/api/hospitalizations/${hosp.id}/entries`, {
      kind: 'occurrence',
      text: 'Depois da alta',
    });
    expect(r.statusCode).toBe(409);
    expect((await admin.get('/api/hospitalizations')).json<HospitalizationList>().total).toBe(0);
    list = (await admin.get('/api/hospitalizations?scope=closed')).json<HospitalizationList>();
    expect(list.items.map((i) => i.status)).toEqual(['discharged']);
    expect((await admin.get('/api/hospitalizations/boxes')).json<Box[]>()[0]?.occupied).toBe(0);
  });

  it('óbito marca o animal; cancelamento exige motivo; animal falecido não interna', async () => {
    let r = await admit(thor.id);
    const hosp = r.json<HospitalizationDetail>();
    r = await admin.send('POST', `/api/hospitalizations/${hosp.id}/close`, {
      outcome: 'deceased',
      notes: 'Parada cardiorrespiratória',
    });
    expect(r.json<HospitalizationDetail>().entries.at(-1)?.kind).toBe('death');
    const patient = (await admin.get(`/api/patients/${thor.id}`)).json<Patient>();
    expect(patient.status).toBe('deceased');
    expect(patient.deceasedOn).not.toBeNull();
    r = await admit(thor.id);
    expect(fieldError(r.body)?.message).toContain('óbito');

    r = await admit(mia.id);
    const other = r.json<HospitalizationDetail>();
    r = await admin.send('POST', `/api/hospitalizations/${other.id}/cancel`, { reason: '' });
    expect(r.statusCode).toBe(400);
    r = await admin.send('POST', `/api/hospitalizations/${other.id}/cancel`, {
      reason: 'Aberta no animal errado',
    });
    expect(r.json<HospitalizationDetail>()).toMatchObject({
      status: 'cancelled',
      outcome: 'Aberta no animal errado',
    });
    const closed = (
      await admin.get('/api/hospitalizations?scope=closed&status=cancelled')
    ).json<HospitalizationList>();
    expect(closed.items.map((i) => i.patient.name)).toEqual(['Mia']);
    expect(
      (await admin.get('/api/hospitalizations?scope=closed&q=thor')).json<HospitalizationList>()
        .total,
    ).toBe(1);
  });

  it('veterinário interna e registra; recepcionista só consulta', async () => {
    const vet = await loginAs(h, admin, 'Veterinário');
    const options = (await vet.get('/api/hospitalizations/options')).json<HospitalizationOptions>();
    expect(options.veterinarians.map((v) => v.name)).toContain('Veterinário');
    const r = await admit(thor.id, {}, vet);
    expect(r.statusCode, r.body).toBe(201);
    const id = r.json<HospitalizationDetail>().id;
    expect(
      (
        await vet.send('POST', `/api/hospitalizations/${id}/entries`, {
          kind: 'report',
          text: 'Paciente estável',
        })
      ).statusCode,
    ).toBe(200);
    expect((await vet.send('POST', '/api/hospitalizations/boxes', {})).statusCode).toBe(403);

    const desk = await loginAs(h, admin, 'Recepcionista');
    expect((await desk.get(`/api/hospitalizations/${id}`)).statusCode).toBe(200);
    expect((await desk.get(`/api/hospitalizations/patient/${thor.id}`)).json()).toEqual({ id });
    expect(
      (
        await desk.send('POST', `/api/hospitalizations/${id}/entries`, {
          kind: 'occurrence',
          text: 'x',
        })
      ).statusCode,
    ).toBe(403);
    expect((await admit(mia.id, {}, desk)).statusCode).toBe(403);
  });
});
