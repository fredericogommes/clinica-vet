import type {
  Appointment,
  AppointmentType,
  AuditEntry,
  Client,
  ClinicalEvent,
  ClinicalEventInput,
  ClinicalRecord,
  ClinicalSearchItem,
  ClinicalTemplate,
  Pathology,
  Patient,
  Session,
  Timeline,
} from '@clinica/contracts';
import { emptyVitals } from '@clinica/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addDays, instantToZoned } from '../../core/zoned-time.js';
import { provisionOrganization } from '../admin/provisioning.js';
import { clientInput, patientInput, VALID_CPF } from '../../test/fixtures.js';
import { ADMIN, createHarness, TestClient, type Harness } from '../../test/harness.js';

let h: Harness;
let admin: TestClient;
let adminId: string;
let client: Client;
let thor: Patient;
let consulta: AppointmentType;

const TZ = 'America/Sao_Paulo';
/** PNG de 1×1 pixel. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==',
  'base64',
);

async function makeUser(name: string, roleName: string): Promise<TestClient> {
  const roles = (await admin.get('/api/admin/roles')).json<{ id: string; name: string }[]>();
  const role = roles.find((r) => r.name === roleName);
  if (!role) throw new Error(`Perfil ${roleName} ausente`);
  const email = `${name.toLowerCase().replace(/[^a-z]/g, '')}@clinica.test`;
  const res = await admin.send('POST', '/api/admin/users', {
    name,
    email,
    password: 'senha-forte-456',
    roleId: role.id,
    unitIds: [h.org.unitId],
  });
  expect(res.statusCode, res.body).toBe(201);
  const user = new TestClient(h.app);
  await user.login(email, 'senha-forte-456');
  return user;
}

const encounter = (overrides: Partial<Extract<ClinicalEventInput, { kind: 'encounter' }>> = {}) =>
  ({
    kind: 'encounter',
    occurredAt: null,
    typeId: consulta.id,
    appointmentId: null,
    summary: 'Consulta de rotina',
    narrative: 'ANAMNESE\nQueixa principal: coceira',
    vitals: { ...emptyVitals, heartRate: 110, temperature: 38.6, weightKg: 12.4, bodyScore: 5 },
    pathologyIds: [],
    publish: true,
    ...overrides,
  }) satisfies ClinicalEventInput;

async function record(
  body: ClinicalEventInput,
  as: TestClient = admin,
  patientId = thor.id,
): Promise<ClinicalEvent> {
  const res = await as.send('POST', `/api/clinical/patients/${patientId}/events`, body);
  expect(res.statusCode, res.body).toBe(201);
  return res.json<ClinicalEvent>();
}

const timeline = async (query = '', as: TestClient = admin, patientId = thor.id) => {
  const res = await as.get(`/api/clinical/patients/${patientId}/timeline${query}`);
  expect(res.statusCode, res.body).toBe(200);
  return res.json<Timeline>();
};

async function pathology(name: string, code: string | null = null): Promise<Pathology> {
  const res = await admin.send('POST', '/api/catalogs/pathologies', {
    code: code ?? '',
    name,
    archived: false,
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json<Pathology>();
}

const uploadPhoto = (as: TestClient, body: Buffer, contentType = 'image/png', query = '') =>
  h.app.inject({
    method: 'POST',
    url: `/api/clinical/patients/${thor.id}/photos${query}`,
    headers: { ...as.authHeaders(), 'content-type': contentType },
    payload: body,
  });

beforeEach(async () => {
  h = await createHarness();
  admin = new TestClient(h.app);
  await admin.login(ADMIN.email, ADMIN.password);
  adminId = (await admin.get('/api/auth/session')).json<Session>().user.id;
  client = (
    await admin.send('POST', '/api/clients', clientInput({ cpf: VALID_CPF }))
  ).json<Client>();
  thor = (
    await admin.send('POST', '/api/patients', {
      clientId: client.id,
      patient: patientInput({
        name: 'Thor',
        birthDate: '2020-01-10',
        microchip: '985112003456789',
      }),
    })
  ).json<Patient>();
  const types = (await admin.get('/api/catalogs/appointment-types')).json<AppointmentType[]>();
  consulta = types.find((t) => t.name === 'Consulta')!;
});
afterEach(async () => {
  await h.close();
});

describe('rascunho e publicação [D2]', () => {
  it('abrir o formulário não grava nada; o rascunho só aparece para o autor', async () => {
    expect((await timeline()).items).toEqual([]);

    const draft = await record(encounter({ publish: false, summary: '', narrative: 'parcial' }));
    expect(draft.status).toBe('draft');
    expect(draft.publishedAt).toBeNull();
    expect((await timeline()).items.map((e) => e.id)).toEqual([draft.id]);

    const vet = await makeUser('Bruno Vet', 'Veterinário');
    expect((await timeline('', vet)).items).toEqual([]);
    expect((await vet.get(`/api/clinical/events/${draft.id}`)).statusCode).toBe(404);
    expect(
      (await vet.send('PUT', `/api/clinical/events/${draft.id}`, encounter())).statusCode,
    ).toBe(404);
  });

  it('publicar exige conteúdo e grava o momento da publicação no log', async () => {
    const draft = await record(
      encounter({ publish: false, summary: '', narrative: '', vitals: emptyVitals }),
    );
    const empty = await admin.send(
      'PUT',
      `/api/clinical/events/${draft.id}`,
      encounter({ summary: '', narrative: '', vitals: emptyVitals }),
    );
    expect(empty.statusCode).toBe(400);

    const published = (
      await admin.send('PUT', `/api/clinical/events/${draft.id}`, encounter())
    ).json<ClinicalEvent>();
    expect(published.status).toBe('published');
    expect(published.publishedAt).not.toBeNull();

    const audit = (
      await admin.get(`/api/admin/audit?entity=clinical_event&entityId=${draft.id}`)
    ).json<{ items: AuditEntry[] }>();
    expect(audit.items.map((a) => a.action).sort()).toEqual(['create', 'publish']);
  });

  it('rascunho pode ser descartado; publicado não', async () => {
    const draft = await record(encounter({ publish: false }));
    expect((await admin.send('DELETE', `/api/clinical/events/${draft.id}`)).statusCode).toBe(204);
    expect((await timeline()).items).toEqual([]);

    const published = await record(encounter());
    expect((await admin.send('DELETE', `/api/clinical/events/${published.id}`)).statusCode).toBe(
      409,
    );
  });
});

describe('atendimento estruturado [D1, RN-18]', () => {
  it('grava sinais vitais e diagnóstico codificado; o peso vira o peso atual', async () => {
    const otite = await pathology('Otite externa', 'ot01');
    expect(otite.code).toBe('OT01');
    const event = await record(encounter({ pathologyIds: [otite.id, otite.id] }));
    expect(event.data).toMatchObject({
      kind: 'encounter',
      type: { id: consulta.id, name: 'Consulta' },
      vitals: { heartRate: 110, temperature: 38.6, weightKg: 12.4, bodyScore: 5 },
      pathologies: [{ id: otite.id, code: 'OT01', name: 'Otite externa' }],
    });
    const rec = (await admin.get(`/api/clinical/patients/${thor.id}`)).json<ClinicalRecord>();
    expect(rec.currentWeight?.weightKg).toBe(12.4);
    expect(rec.patient.name).toBe('Thor');
    expect(rec.owner).toMatchObject({ name: client.name, phone: '11987654321' });
  });

  it('recusa sinais vitais fora dos limites fisiológicos', async () => {
    for (const vitals of [
      { heartRate: 900 },
      { temperature: 50 },
      { bodyScore: 10 },
      { respiratoryRate: 12.5 },
      { weightKg: 0 },
    ]) {
      const res = await admin.send(
        'POST',
        `/api/clinical/patients/${thor.id}/events`,
        encounter({ vitals: { ...emptyVitals, ...vitals } }),
      );
      expect(res.statusCode, JSON.stringify(vitals)).toBe(400);
    }
  });

  it('o modelo do tipo de atendimento abre preenchido com os dados do animal', async () => {
    const res = await admin.send('PUT', `/api/catalogs/appointment-types/${consulta.id}`, {
      name: 'Consulta',
      durationMinutes: 60,
      recordTemplate: 'Paciente {{animal}} ({{idade}}), tutor {{responsavel}}, {{peso}} {{xyz}}',
    });
    expect(res.statusCode, res.body).toBe(200);
    await record({ kind: 'weight', occurredAt: null, weightKg: 8.25, notes: '' });
    const rendered = (
      await admin.get(`/api/clinical/patients/${thor.id}/render?typeId=${consulta.id}`)
    ).json<{ title: string; body: string }>();
    expect(rendered.title).toBe('Consulta');
    expect(rendered.body).toMatch(
      /^Paciente Thor \(\d+ anos?.*\), tutor Carla Mendes, 8,25 kg \{\{xyz\}\}$/,
    );
  });

  it('o atendimento só se liga a agendamento do próprio animal', async () => {
    const other = (
      await admin.send('POST', '/api/patients', {
        clientId: client.id,
        patient: patientInput({ name: 'Mel' }),
      })
    ).json<Patient>();
    await admin.send('PUT', `/api/schedule/members/${adminId}`, {
      mode: 'fixed',
      fixedHours: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
        weekday,
        start: '00:00',
        end: '24:00',
      })),
    });
    const tomorrow = addDays(instantToZoned(new Date(), TZ).date, 1);
    const booked = await admin.send('POST', '/api/appointments', {
      clientId: client.id,
      patientIds: [other.id],
      typeId: consulta.id,
      durationMinutes: 60,
      date: tomorrow,
      start: '10:00',
      professionalId: adminId,
      notes: '',
      fitIn: true,
    });
    expect(booked.statusCode, booked.body).toBe(201);
    const appointment = booked.json<{ items: Appointment[] }>().items[0]!;
    const wrong = await admin.send(
      'POST',
      `/api/clinical/patients/${thor.id}/events`,
      encounter({ appointmentId: appointment.id }),
    );
    expect(wrong.statusCode).toBe(400);
    const ok = await record(encounter({ appointmentId: appointment.id }), admin, other.id);
    expect(ok.appointmentId).toBe(appointment.id);

    const rec = (await admin.get(`/api/clinical/patients/${other.id}`)).json<ClinicalRecord>();
    expect(rec.appointments?.map((a) => a.id)).toEqual([appointment.id]);
  });
});

describe('eventos da ficha [RN-17]', () => {
  it('peso, patologia, observação, documento e receita entram publicados', async () => {
    const dermatite = await pathology('Dermatite atópica');
    const templates = (await admin.get('/api/catalogs/clinical-templates')).json<
      ClinicalTemplate[]
    >();
    const receita = templates.find((t) => t.kind === 'prescription')!;
    const atestado = templates.find((t) => t.kind === 'document')!;
    expect(receita.name).toBe('Receita simples');

    const rendered = (
      await admin.get(`/api/clinical/patients/${thor.id}/render?templateId=${atestado.id}`)
    ).json<{ title: string; body: string }>();
    expect(rendered.title).toBe('Atestado de saúde');
    expect(rendered.body).toContain('microchip 985112003456789');
    expect(rendered.body).toContain('CPF 529.982.247-25');
    expect(rendered.body).toContain('Matriz, ');

    // A assinatura sai do usuário logado, não de um texto fixo do modelo.
    const signed = (
      await admin.send('POST', '/api/catalogs/clinical-templates', {
        kind: 'document',
        name: 'Declaração assinada',
        body: '{{animal}}: {{profissional}}',
        archived: false,
      })
    ).json<ClinicalTemplate>();
    const signedBody = (
      await admin.get(`/api/clinical/patients/${thor.id}/render?templateId=${signed.id}`)
    ).json<{ body: string }>().body;
    expect(signedBody).toBe(`Thor: ${ADMIN.name}`);

    await record({ kind: 'weight', occurredAt: null, weightKg: 13.1, notes: 'Em jejum' });
    await record({ kind: 'pathology', occurredAt: null, pathologyId: dermatite.id, notes: '' });
    await record({ kind: 'observation', occurredAt: null, text: 'Tutor relata melhora' });
    await record({
      kind: 'document',
      occurredAt: null,
      templateId: atestado.id,
      title: rendered.title,
      body: rendered.body,
      publish: true,
    });
    const prescription = await record({
      kind: 'prescription',
      occurredAt: null,
      templateId: receita.id,
      title: 'Receita',
      body: 'Uso oral\n1. Apoquel 16 mg',
      publish: true,
    });
    expect(prescription.data).toMatchObject({
      kind: 'prescription',
      template: { id: receita.id, name: 'Receita simples' },
    });

    const items = (await timeline()).items;
    expect(items.map((e) => e.kind).sort()).toEqual(
      ['document', 'observation', 'pathology', 'prescription', 'weight'].sort(),
    );
    expect(items.every((e) => e.status === 'published')).toBe(true);
  });

  it('recusa referências inválidas: modelo de outro tipo, patologia arquivada', async () => {
    const templates = (await admin.get('/api/catalogs/clinical-templates')).json<
      ClinicalTemplate[]
    >();
    const atestado = templates.find((t) => t.kind === 'document')!;
    const wrongKind = await admin.send('POST', `/api/clinical/patients/${thor.id}/events`, {
      kind: 'prescription',
      occurredAt: null,
      templateId: atestado.id,
      title: 'x',
      body: 'y',
      publish: true,
    });
    expect(wrongKind.statusCode).toBe(400);

    const old = await pathology('Sarna');
    await admin.send('PUT', `/api/catalogs/pathologies/${old.id}`, {
      code: '',
      name: 'Sarna',
      archived: true,
    });
    const archived = await admin.send('POST', `/api/clinical/patients/${thor.id}/events`, {
      kind: 'pathology',
      occurredAt: null,
      pathologyId: old.id,
      notes: '',
    });
    expect(archived.statusCode).toBe(400);
  });

  it('código de patologia é único sem diferenciar maiúsculas', async () => {
    await pathology('Otite', 'OT01');
    const dup = await admin.send('POST', '/api/catalogs/pathologies', {
      code: 'ot01',
      name: 'Outra',
      archived: false,
    });
    expect(dup.statusCode).toBe(409);
    expect(dup.json<{ error: { message: string } }>().error.message).toMatch(/código/);
  });
});

describe('data do evento', () => {
  it('data retroativa exige permissão; data futura nunca', async () => {
    const yesterday = new Date(Date.now() - 86_400_000).toISOString();
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString();
    const vet = await makeUser('Bruno Vet', 'Veterinário');
    const esteticista = await makeUser('Eva Estetica', 'Esteticista');

    const back = await record({ kind: 'observation', occurredAt: yesterday, text: 'ontem' }, vet);
    expect(back.occurredAt).toBe(yesterday);

    const denied = await esteticista.send('POST', `/api/clinical/patients/${thor.id}/events`, {
      kind: 'observation',
      occurredAt: yesterday,
      text: 'ontem',
    });
    expect(denied.statusCode).toBe(403);
    const future = await vet.send('POST', `/api/clinical/patients/${thor.id}/events`, {
      kind: 'observation',
      occurredAt: tomorrow,
      text: 'amanhã',
    });
    expect(future.statusCode).toBe(400);
  });
});

describe('linha do tempo [p.4]', () => {
  it('filtra por tipo, profissional e período, ordena e pagina no servidor', async () => {
    const vet = await makeUser('Bruno Vet', 'Veterinário');
    const days = [3, 2, 1].map((d) => new Date(Date.now() - d * 86_400_000).toISOString());
    await record({ kind: 'weight', occurredAt: days[0]!, weightKg: 10, notes: '' });
    await record({ kind: 'observation', occurredAt: days[1]!, text: 'a' }, vet);
    await record({ kind: 'weight', occurredAt: days[2]!, weightKg: 11, notes: '' }, vet);
    await record({ kind: 'observation', occurredAt: null, text: 'b' });
    const vetId = (await vet.get('/api/auth/session')).json<Session>().user.id;

    const all = await timeline();
    expect(all.items.map((e) => e.occurredAt)).toEqual(
      [...all.items.map((e) => e.occurredAt)].sort().reverse(),
    );
    expect(all.professionals.map((p) => p.name).sort()).toEqual([ADMIN.name, 'Bruno Vet']);

    const asc = await timeline('?order=asc');
    expect(asc.items[0]?.occurredAt).toBe(days[0]);

    expect((await timeline('?kinds=weight')).items).toHaveLength(2);
    expect((await timeline('?kinds=weight,observation')).items).toHaveLength(4);
    expect((await timeline(`?professionalId=${vetId}`)).items).toHaveLength(2);

    const day = instantToZoned(new Date(days[1]!), TZ).date;
    const period = await timeline(`?from=${day}&to=${day}`);
    expect(period.items.map((e) => e.kind)).toEqual(['observation']);

    const first = await timeline('?limit=3');
    expect(first.items).toHaveLength(3);
    expect(first.nextCursor).not.toBeNull();
    const second = await timeline(`?limit=3&cursor=${first.nextCursor}`);
    expect(second.items).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
    expect(new Set([...first.items, ...second.items].map((e) => e.id)).size).toBe(4);

    expect(
      (await admin.get(`/api/clinical/patients/${thor.id}/timeline?cursor=lixo`)).statusCode,
    ).toBe(400);
    expect(
      (await admin.get(`/api/clinical/patients/${thor.id}/timeline?kinds=vaccine`)).statusCode,
    ).toBe(400);
  });
});

describe('correção, invalidação e permissões', () => {
  it('cada um corrige o que é seu; quem tem "corrigir de outros" corrige tudo', async () => {
    const vet = await makeUser('Bruno Vet', 'Veterinário');
    const other = await makeUser('Clara Vet', 'Veterinário');
    const event = await record(encounter(), vet);

    const byOther = await other.send('PUT', `/api/clinical/events/${event.id}`, encounter());
    expect(byOther.statusCode).toBe(403);
    expect(
      (await other.get(`/api/clinical/events/${event.id}`)).json<ClinicalEvent>().editable,
    ).toBe(false);

    const own = await vet.send(
      'PUT',
      `/api/clinical/events/${event.id}`,
      encounter({ summary: 'Corrigido pelo autor' }),
    );
    expect(own.statusCode, own.body).toBe(200);

    const manager = await makeUser('Gil Gestor', 'Gestor da Clínica');
    const fixed = await manager.send(
      'PUT',
      `/api/clinical/events/${event.id}`,
      encounter({ summary: 'Corrigido pelo gestor' }),
    );
    expect(fixed.statusCode, fixed.body).toBe(200);
    expect(fixed.json<ClinicalEvent>().professional.name).toBe('Bruno Vet');

    const audit = (
      await admin.get(`/api/admin/audit?entity=clinical_event&entityId=${event.id}`)
    ).json<{ items: AuditEntry[] }>();
    expect(audit.items.filter((a) => a.action === 'update')).toHaveLength(2);
  });

  it('quem só vê a ficha não registra nada', async () => {
    const recep = await makeUser('Rita Recepcao', 'Recepcionista');
    expect((await recep.get(`/api/clinical/patients/${thor.id}`)).statusCode).toBe(200);
    const res = await recep.send('POST', `/api/clinical/patients/${thor.id}/events`, {
      kind: 'observation',
      occurredAt: null,
      text: 'x',
    });
    expect(res.statusCode).toBe(403);
    expect((await uploadPhoto(recep, PNG)).statusCode).toBe(403);
  });

  it('invalidar exige motivo, mantém o evento riscado e tira o peso da curva', async () => {
    const weight = await record({ kind: 'weight', occurredAt: null, weightKg: 30, notes: '' });
    const noReason = await admin.send('POST', `/api/clinical/events/${weight.id}/void`, {
      reason: '',
    });
    expect(noReason.statusCode).toBe(400);
    const voided = (
      await admin.send('POST', `/api/clinical/events/${weight.id}/void`, {
        reason: 'Balança descalibrada',
      })
    ).json<ClinicalEvent>();
    expect(voided.status).toBe('voided');
    expect(voided.void).toMatchObject({ by: ADMIN.name, reason: 'Balança descalibrada' });
    expect(voided.editable).toBe(false);

    expect((await timeline()).items.map((e) => e.status)).toEqual(['voided']);
    const rec = (await admin.get(`/api/clinical/patients/${thor.id}`)).json<ClinicalRecord>();
    expect(rec.currentWeight).toBeNull();
    expect(
      (
        await admin.send('PUT', `/api/clinical/events/${weight.id}`, {
          kind: 'weight',
          occurredAt: null,
          weightKg: 31,
          notes: '',
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (await admin.send('POST', `/api/clinical/events/${weight.id}/void`, { reason: 'de novo' }))
        .statusCode,
    ).toBe(409);
  });

  it('ficha arquivada fica só leitura', async () => {
    const event = await record({ kind: 'observation', occurredAt: null, text: 'antes' });
    await admin.send('POST', `/api/patients/${thor.id}/archive`);
    const res = await admin.send('POST', `/api/clinical/patients/${thor.id}/events`, {
      kind: 'observation',
      occurredAt: null,
      text: 'depois',
    });
    expect(res.statusCode).toBe(409);
    const items = (await timeline()).items;
    expect(items.map((e) => e.id)).toEqual([event.id]);
    expect(items[0]?.editable).toBe(false);
    expect(items[0]?.removable).toBe(false);
  });

  it('outra organização não enxerga eventos, fichas nem fotos', async () => {
    const event = await record(encounter());
    const photo = (await uploadPhoto(admin, PNG)).json<ClinicalEvent>();
    const fileId = photo.data.kind === 'photo' ? photo.data.fileId : '';
    await h.db.transaction((tx) =>
      provisionOrganization(tx, {
        organizationName: 'Outra Clínica',
        unitName: 'Sede',
        admin: { name: 'Olga', email: 'olga@outra.test', password: 'senha-forte-789' },
      }),
    );
    const stranger = new TestClient(h.app);
    await stranger.login('olga@outra.test', 'senha-forte-789');
    expect((await stranger.get(`/api/clinical/events/${event.id}`)).statusCode).toBe(404);
    expect((await stranger.get(`/api/clinical/patients/${thor.id}`)).statusCode).toBe(404);
    expect((await stranger.get(`/api/clinical/patients/${thor.id}/timeline`)).statusCode).toBe(404);
    expect((await stranger.get(`/api/clinical/files/${fileId}`)).statusCode).toBe(404);
    expect(
      (await stranger.send('PUT', `/api/clinical/events/${event.id}`, encounter())).statusCode,
    ).toBe(404);
    const search = (await stranger.get('/api/clinical/search?patient=Thor')).json<{
      items: ClinicalSearchItem[];
    }>();
    expect(search.items).toEqual([]);
  });
});

describe('fotos', () => {
  it('guarda a imagem e devolve os mesmos bytes com cabeçalhos seguros', async () => {
    const res = await uploadPhoto(admin, PNG, 'image/png', '?caption=Les%C3%A3o%20na%20pata');
    expect(res.statusCode, res.body).toBe(201);
    const photo = res.json<ClinicalEvent>();
    expect(photo.data).toMatchObject({
      kind: 'photo',
      caption: 'Lesão na pata',
      byteSize: PNG.length,
    });
    expect(photo.editable).toBe(false);
    expect(photo.removable).toBe(true);

    const fileId = photo.data.kind === 'photo' ? photo.data.fileId : '';
    const file = await admin.get(`/api/clinical/files/${fileId}`);
    expect(file.statusCode).toBe(200);
    expect(file.headers['content-type']).toBe('image/png');
    expect(file.headers['content-security-policy']).toContain("default-src 'none'");
    expect(file.headers['x-content-type-options']).toBe('nosniff');
    expect(file.rawPayload.equals(PNG)).toBe(true);
  });

  it('recusa o que não é imagem de verdade, formatos fora da lista e arquivos grandes', async () => {
    const fake = await uploadPhoto(admin, Buffer.from('<svg onload="alert(1)"></svg>'));
    expect(fake.statusCode).toBe(400);
    const svg = await uploadPhoto(admin, Buffer.from('<svg/>'), 'image/svg+xml');
    expect(svg.statusCode).toBe(415);
    const big = Buffer.concat([PNG, Buffer.alloc(8 * 1024 * 1024)]);
    expect((await uploadPhoto(admin, big)).statusCode).toBe(413);
    expect((await timeline()).items).toEqual([]);
  });

  it('exige o token CSRF como qualquer escrita', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/clinical/patients/${thor.id}/photos`,
      headers: { cookie: admin.authHeaders().cookie ?? '', 'content-type': 'image/png' },
      payload: PNG,
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('busca do atendimento', () => {
  it('lista responsáveis com seus animais, por responsável ou por animal', async () => {
    await admin.send('POST', '/api/patients', {
      clientId: client.id,
      patient: patientInput({ name: 'Mel' }),
    });
    const other = (
      await admin.send('POST', '/api/clients', clientInput({ name: 'Davi Souza', contacts: [] }))
    ).json<Client>();
    await admin.send('POST', '/api/patients', {
      clientId: other.id,
      patient: patientInput({ name: 'Thoreau' }),
    });

    const byPatient = (await admin.get('/api/clinical/search?patient=thor')).json<{
      items: ClinicalSearchItem[];
      total: number;
    }>();
    expect(byPatient.total).toBe(2);
    expect(byPatient.items.map((i) => [i.owner.name, i.patients.map((p) => p.name)])).toEqual([
      ['Carla Mendes', ['Thor']],
      ['Davi Souza', ['Thoreau']],
    ]);

    const byClient = (await admin.get('/api/clinical/search?client=carla')).json<{
      items: ClinicalSearchItem[];
    }>();
    expect(byClient.items[0]?.patients.map((p) => p.name)).toEqual(['Mel', 'Thor']);
    expect(byClient.items[0]?.owner.phone).toBe('11987654321');
  });
});

describe('exclusão definitiva de ficha [RN-21]', () => {
  it('só apaga animal e cliente sem histórico, com permissão própria', async () => {
    const vet = await makeUser('Bruno Vet', 'Veterinário');
    expect((await vet.send('DELETE', `/api/patients/${thor.id}`)).statusCode).toBe(403);

    await record({ kind: 'observation', occurredAt: null, text: 'x' });
    expect((await admin.send('DELETE', `/api/patients/${thor.id}`)).statusCode).toBe(409);

    const mistake = (
      await admin.send('POST', '/api/patients', {
        clientId: client.id,
        patient: patientInput({ name: 'Engano' }),
      })
    ).json<Patient>();
    expect((await admin.send('DELETE', `/api/patients/${mistake.id}`)).statusCode).toBe(204);
    expect((await admin.get(`/api/patients/${mistake.id}`)).statusCode).toBe(404);

    expect((await admin.send('DELETE', `/api/clients/${client.id}`)).statusCode).toBe(409);
    const lonely = (
      await admin.send(
        'POST',
        '/api/clients',
        clientInput({ name: 'Cadastro Errado', contacts: [] }),
      )
    ).json<Client>();
    expect((await admin.send('DELETE', `/api/clients/${lonely.id}`)).statusCode).toBe(204);
    const audit = (await admin.get(`/api/admin/audit?entity=client&entityId=${lonely.id}`)).json<{
      items: AuditEntry[];
    }>();
    expect(audit.items.find((a) => a.action === 'delete')?.before).toEqual({
      code: lonely.code,
      name: 'Cadastro Errado',
    });
  });
});
