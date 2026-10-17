import {
  doseLabel,
  emptyVitals,
  formatAge,
  formatCnpj,
  formatCpf,
  type ClinicalEvent,
  type ClinicalEventContent,
  type ClinicalEventData,
  type ClinicalRecord,
  type ClinicalSearchItem,
  type ExamForm,
  type ExamSeries,
  type Protocol,
  type VaccinationForm,
  type Patient,
  type Permission,
  type TemplatePlaceholder,
  type Timeline,
  type Vitals,
  type WeightPoint,
} from '@clinica/contracts';
import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  ne,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { createHash } from 'node:crypto';
import { actorOf } from '../../core/actor.js';
import { recordAudit } from '../../core/audit.js';
import { AppError, conflict, forbidden, notFound } from '../../core/errors.js';
import { newId } from '../../core/ids.js';
import { containsText } from '../../core/search.js';
import { addDays, instantToZoned, zonedToInstant } from '../../core/zoned-time.js';
import type { Database, Executor } from '../../db/client.js';
import {
  appointmentPatients,
  appointments,
  appointmentTypes,
  breeds,
  clientContacts,
  clients,
  clinicalEventPathologies,
  clinicalEvents,
  clinicalExamResults,
  clinicalExamValues,
  clinicalFiles,
  clinicalTemplates,
  clinicalVaccinations,
  clinicalVitals,
  exams,
  pathologies,
  patients,
  products,
  saleItems,
  species,
  units,
  users,
  vaccines,
} from '../../db/schema.js';
import type { AuthContext } from '../auth/sessions.js';
import type { ExamService } from '../exams/service.js';
import type { PatientService } from '../patients/service.js';
import type { SaleService } from '../sales/service.js';
import type { AppointmentService } from '../scheduling/appointment-service.js';
import type { VaccineService } from '../vaccines/service.js';
import { unitTimeZone } from '../scheduling/availability.js';
import { renderTemplate } from './render.js';

/** Tolerância entre o relógio do navegador e o do servidor antes de tratar a data como retroativa. */
const CLOCK_SKEW_MS = 5 * 60_000;

const invalid = (path: string, message: string) =>
  new AppError('validation_failed', 'Dados do evento clínico inválidos.', [{ path, message }]);

type EventRow = typeof clinicalEvents.$inferSelect;

export interface PhotoUpload {
  data: Buffer;
  contentType: 'image/jpeg' | 'image/png' | 'image/webp';
  caption: string;
  occurredAt: string | null;
}

/** Ficha clínica: eventos do animal, linha do tempo, sinais vitais, fotos e modelos [RN-16..18]. */
export class ClinicalService {
  constructor(
    private readonly db: Database,
    private readonly patients: PatientService,
    private readonly appointments: AppointmentService,
    private readonly sales: SaleService,
    private readonly exams: ExamService,
    private readonly vaccines: VaccineService,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Entrada do atendimento: responsáveis com seus animais, buscando por um ou outro [p.4]. */
  async search(
    auth: AuthContext,
    query: { client: string; patient: string; page: number; pageSize: number },
  ): Promise<{ items: ClinicalSearchItem[]; total: number; page: number; pageSize: number }> {
    const filters: SQL[] = [
      eq(clients.organizationId, auth.organizationId),
      isNull(clients.archivedAt),
      isNull(patients.archivedAt),
    ];
    if (query.client) {
      const byClient = [containsText(clients.name, query.client)];
      if (/^\d+$/.test(query.client)) byClient.push(eq(clients.code, Number(query.client)));
      const digits = query.client.replace(/\D/g, '');
      if (digits.length >= 8) {
        byClient.push(
          sql`exists (select 1 from ${clientContacts} where ${clientContacts.clientId} = ${clients.id} and ${clientContacts.value} like ${`%${digits}%`})`,
        );
      }
      filters.push(or(...byClient) ?? sql`false`);
    }
    if (query.patient) {
      const byPatient = [containsText(patients.name, query.patient)];
      if (/^\d+$/.test(query.patient)) byPatient.push(eq(patients.code, Number(query.patient)));
      byPatient.push(eq(patients.microchip, query.patient.replace(/\s/g, '')));
      filters.push(or(...byPatient) ?? sql`false`);
    }
    const where = and(...filters);
    // Pagina por responsável; cada um vem com os animais que casam com a busca.
    const owners = this.db
      .selectDistinct({ id: clients.id, name: clients.name, code: clients.code })
      .from(patients)
      .innerJoin(clients, eq(clients.id, patients.clientId))
      .where(where)
      .as('owners');
    const [page, totals] = await Promise.all([
      this.db
        .select()
        .from(owners)
        .orderBy(asc(sql`lower(${owners.name})`), asc(owners.code))
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize),
      this.db.select({ n: count() }).from(owners),
    ]);
    if (page.length === 0) {
      return { items: [], total: totals[0]?.n ?? 0, page: query.page, pageSize: query.pageSize };
    }
    const ownerIds = page.map((o) => o.id);
    const [animalRows, phoneRows] = await Promise.all([
      this.db
        .select({
          clientId: patients.clientId,
          id: patients.id,
          code: patients.code,
          name: patients.name,
          speciesName: species.name,
          breedName: breeds.name,
          status: patients.status,
          markings: patients.markings,
        })
        .from(patients)
        .innerJoin(clients, eq(clients.id, patients.clientId))
        .leftJoin(species, eq(species.id, patients.speciesId))
        .leftJoin(breeds, eq(breeds.id, patients.breedId))
        .where(and(where, inArray(patients.clientId, ownerIds)))
        .orderBy(asc(sql`lower(${patients.name})`), asc(patients.code)),
      this.db
        .select({ clientId: clientContacts.clientId, value: clientContacts.value })
        .from(clientContacts)
        .where(and(inArray(clientContacts.clientId, ownerIds), ne(clientContacts.kind, 'email')))
        .orderBy(asc(clientContacts.position)),
    ]);
    return {
      items: page.map((o) => ({
        owner: {
          id: o.id,
          code: o.code,
          name: o.name,
          phone: phoneRows.find((p) => p.clientId === o.id)?.value ?? null,
        },
        patients: animalRows.filter((a) => a.clientId === o.id).map(({ clientId: _c, ...a }) => a),
      })),
      total: totals[0]?.n ?? 0,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  /** Cabeçalho e coluna lateral da ficha. */
  async record(auth: AuthContext, patientId: string): Promise<ClinicalRecord> {
    const patient = await this.patients.get(auth, patientId);
    const [timeZone, contacts, weights] = await Promise.all([
      unitTimeZone(this.db, auth.unitId),
      this.db
        .select({ kind: clientContacts.kind, value: clientContacts.value })
        .from(clientContacts)
        .where(eq(clientContacts.clientId, patient.owner.id))
        .orderBy(asc(clientContacts.position)),
      this.weights(patientId),
    ]);
    const current = weights.at(-1);
    return {
      timeZone,
      patient,
      owner: {
        id: patient.owner.id,
        code: patient.owner.code,
        name: patient.owner.name,
        phone: contacts.find((c) => c.kind !== 'email')?.value ?? null,
        email: contacts.find((c) => c.kind === 'email')?.value ?? null,
      },
      currentWeight: current
        ? { weightKg: current.weightKg, occurredAt: current.occurredAt }
        : null,
      weights,
      appointments: auth.permissions.has('schedule.view')
        ? await this.appointments.forPatient(auth, patientId)
        : null,
    };
  }

  /** Formulário de resultado de exame com a faixa que vale para o animal na data [RN-33]. */
  async examForm(
    auth: AuthContext,
    patientId: string,
    examId: string,
    occurredAt: string | undefined,
  ): Promise<ExamForm> {
    const [patient] = await this.db
      .select({
        speciesId: patients.speciesId,
        speciesName: species.name,
        birthDate: patients.birthDate,
      })
      .from(patients)
      .leftJoin(species, eq(species.id, patients.speciesId))
      .where(and(eq(patients.id, patientId), eq(patients.organizationId, auth.organizationId)));
    if (!patient) throw notFound('Animal');
    const tz = await unitTimeZone(this.db, auth.unitId);
    const on = instantToZoned(occurredAt ? new Date(occurredAt) : this.now(), tz).date;
    return this.exams.form(auth, examId, patient, on);
  }

  /** Sugestão de dose e próxima data para a aplicação na data informada [RN-20]. */
  async vaccinationForm(
    auth: AuthContext,
    patientId: string,
    vaccineId: string,
    occurredAt: string | undefined,
  ): Promise<VaccinationForm> {
    await this.assertPatient(this.db, auth, patientId);
    const tz = await unitTimeZone(this.db, auth.unitId);
    const on = instantToZoned(occurredAt ? new Date(occurredAt) : this.now(), tz).date;
    return this.vaccines.form(auth, patientId, vaccineId, on);
  }

  /** Protocolos vacinais do animal com a situação de hoje na unidade [p.5]. */
  async protocols(auth: AuthContext, patientId: string): Promise<Protocol[]> {
    await this.assertPatient(this.db, auth, patientId);
    const today = instantToZoned(this.now(), await unitTimeZone(this.db, auth.unitId)).date;
    return this.vaccines.protocols(auth, patientId, today);
  }

  /** Encerra o protocolo de uma vacina no animal, com motivo, sem apagar as aplicações. */
  async closeProtocol(
    auth: AuthContext,
    patientId: string,
    vaccineId: string,
    reason: string,
  ): Promise<Protocol[]> {
    await this.db.transaction(async (tx) => {
      await this.lockActivePatient(tx, auth, patientId);
      const current = await this.vaccines.protocols(auth, patientId, '0000-01-01', tx);
      const protocol = current.find((p) => p.vaccine.id === vaccineId);
      if (!protocol) throw notFound('Protocolo');
      if (protocol.closure) throw conflict('Este protocolo já está encerrado.');
      await this.vaccines.close(tx, auth, patientId, vaccineId, reason, this.now());
      await recordAudit(tx, actorOf(auth), {
        entity: 'vaccine_protocol',
        entityId: patientId,
        action: 'close',
        before: { vaccine: protocol.vaccine.name, nextDueOn: protocol.nextDueOn },
        after: { vaccine: protocol.vaccine.name, closed: true, reason },
      });
    });
    return this.protocols(auth, patientId);
  }

  /** Evolução de um campo de exame no animal [p.14]. */
  async examSeries(auth: AuthContext, patientId: string, attributeId: string): Promise<ExamSeries> {
    await this.assertPatient(this.db, auth, patientId);
    return this.exams.series(auth, patientId, attributeId);
  }

  /** Linha do tempo com filtros aplicados no servidor e paginação por cursor [p.4]. */
  async timeline(
    auth: AuthContext,
    patientId: string,
    query: {
      from?: string | undefined;
      to?: string | undefined;
      kinds?: ClinicalEvent['kind'][] | undefined;
      professionalId?: string | undefined;
      order: 'asc' | 'desc';
      cursor?: string | undefined;
      limit: number;
    },
  ): Promise<Timeline> {
    await this.assertPatient(this.db, auth, patientId);
    const visible = this.visibleTo(auth, patientId);
    const filters: SQL[] = [visible];
    if (query.from || query.to) {
      const timeZone = await unitTimeZone(this.db, auth.unitId);
      if (query.from) {
        filters.push(gte(clinicalEvents.occurredAt, zonedToInstant(query.from, 0, timeZone)));
      }
      if (query.to) {
        filters.push(
          lt(clinicalEvents.occurredAt, zonedToInstant(addDays(query.to, 1), 0, timeZone)),
        );
      }
    }
    if (query.kinds?.length) filters.push(inArray(clinicalEvents.kind, query.kinds));
    if (query.professionalId) filters.push(eq(clinicalEvents.authorId, query.professionalId));
    if (query.cursor) {
      const cursor = decodeCursor(query.cursor);
      const after = query.order === 'desc' ? lt : gt;
      filters.push(
        or(
          after(clinicalEvents.occurredAt, cursor.at),
          and(eq(clinicalEvents.occurredAt, cursor.at), after(clinicalEvents.id, cursor.id)),
        ) ?? sql`false`,
      );
    }
    const direction = query.order === 'desc' ? desc : asc;
    const rows = await this.db
      .select({ id: clinicalEvents.id })
      .from(clinicalEvents)
      .where(and(...filters))
      .orderBy(direction(clinicalEvents.occurredAt), direction(clinicalEvents.id))
      .limit(query.limit + 1);
    const page = rows.slice(0, query.limit);
    const items = await this.load(
      this.db,
      auth,
      page.map((r) => r.id),
    );
    const last = items.at(-1);
    const professionals = await this.db
      .selectDistinct({ id: users.id, name: users.name })
      .from(clinicalEvents)
      .innerJoin(users, eq(users.id, clinicalEvents.authorId))
      .where(visible)
      .orderBy(users.name);
    return {
      items,
      nextCursor: rows.length > query.limit && last ? encodeCursor(last.occurredAt, last.id) : null,
      professionals,
    };
  }

  async get(auth: AuthContext, id: string, executor?: Executor): Promise<ClinicalEvent> {
    const db = executor ?? this.db;
    const [row] = await db
      .select({ patientId: clinicalEvents.patientId })
      .from(clinicalEvents)
      .where(
        and(eq(clinicalEvents.id, id), eq(clinicalEvents.organizationId, auth.organizationId)),
      );
    // Rascunho alheio é tratado como inexistente.
    const [event] = row ? await this.load(db, auth, [id]) : [];
    if (!event || (event.status === 'draft' && event.professional.id !== auth.userId)) {
      throw notFound('Evento clínico');
    }
    return event;
  }

  /** Nada é gravado ao abrir um formulário: o evento nasce no primeiro salvar explícito [D2]. */
  async create(
    auth: AuthContext,
    patientId: string,
    input: ClinicalEventData,
  ): Promise<ClinicalEvent> {
    return this.db.transaction(async (tx) => {
      await this.lockActivePatient(tx, auth, patientId);
      const id = newId();
      const now = this.now();
      const publish = !('publish' in input) || input.publish;
      const refs = await this.resolveRefs(tx, auth, patientId, input, null);
      const occurredAt = this.occurredAt(auth, input.occurredAt, null);
      await tx.insert(clinicalEvents).values({
        id,
        organizationId: auth.organizationId,
        unitId: auth.unitId,
        patientId,
        kind: input.kind,
        status: publish ? 'published' : 'draft',
        occurredAt,
        authorId: auth.userId,
        appointmentId: refs.appointmentId,
        appointmentTypeId: refs.typeId,
        templateId: refs.templateId,
        payload: payloadOf(input),
        publishedAt: publish ? now : null,
        updatedBy: auth.userId,
        createdAt: now,
        updatedAt: now,
      });
      await this.writeDetails(tx, id, input, refs.pathologyIds);
      await this.writeExam(tx, auth, id, patientId, input, occurredAt, null);
      await this.writeVaccination(tx, auth, id, patientId, input, occurredAt, null);
      if (publish) await this.charge(tx, auth, id, patientId, input, refs.typeId, auth.userId);
      const after = await this.get(auth, id, tx);
      await recordAudit(tx, actorOf(auth), {
        entity: 'clinical_event',
        entityId: id,
        action: 'create',
        after: snapshot(after, patientId),
      });
      return after;
    });
  }

  /** Corrige o conteúdo; um rascunho pode ser publicado aqui. Toda correção fica no log. */
  async update(auth: AuthContext, id: string, input: ClinicalEventData): Promise<ClinicalEvent> {
    return this.db.transaction(async (tx) => {
      const row = await this.lockEvent(tx, auth, id);
      await this.lockActivePatient(tx, auth, row.patientId);
      const before = await this.get(auth, id, tx);
      if (!before.editable) throw this.denyEdit(before);
      if (input.kind !== row.kind) {
        throw invalid('kind', 'O tipo do evento não pode ser trocado');
      }
      const publish = row.status === 'published' || !('publish' in input) || input.publish;
      const refs = await this.resolveRefs(tx, auth, row.patientId, input, row);
      const now = this.now();
      const occurredAt = this.occurredAt(auth, input.occurredAt, row.occurredAt);
      await tx
        .update(clinicalEvents)
        .set({
          status: publish ? 'published' : 'draft',
          occurredAt,
          appointmentId: refs.appointmentId,
          appointmentTypeId: refs.typeId,
          templateId: refs.templateId,
          payload: payloadOf(input),
          publishedAt: publish ? (row.publishedAt ?? now) : null,
          updatedBy: auth.userId,
          updatedAt: now,
        })
        .where(eq(clinicalEvents.id, id));
      await this.writeDetails(tx, id, input, refs.pathologyIds);
      await this.writeExam(tx, auth, id, row.patientId, input, occurredAt, before);
      await this.writeVaccination(tx, auth, id, row.patientId, input, occurredAt, before);
      if (row.status === 'draft' && publish) {
        await this.charge(tx, auth, id, row.patientId, input, refs.typeId, row.authorId);
      }
      const after = await this.get(auth, id, tx);
      await recordAudit(tx, actorOf(auth), {
        entity: 'clinical_event',
        entityId: id,
        action: row.status === 'draft' && publish ? 'publish' : 'update',
        before: snapshot(before, row.patientId),
        after: snapshot(after, row.patientId),
      });
      return after;
    });
  }

  /**
   * Atendimento finalizado lança o serviço do seu tipo; resultado de exame e aplicação de vacina,
   * o serviço do cadastro,
   * na venda aberta do animal, com o autor como profissional [RN-19]. Uma vez só por evento;
   * serviço arquivado, de consumo interno ou autor inativo não bloqueiam o prontuário: o
   * lançamento é que não acontece.
   */
  private async charge(
    tx: Executor,
    auth: AuthContext,
    eventId: string,
    patientId: string,
    input: ClinicalEventData,
    typeId: string | null,
    authorId: string,
  ): Promise<void> {
    let type: { serviceId: string | null; archivedAt: Date | null; purpose: string } | undefined;
    if (input.kind === 'encounter' && typeId) {
      [type] = await tx
        .select({
          serviceId: appointmentTypes.serviceId,
          archivedAt: products.archivedAt,
          purpose: products.purpose,
        })
        .from(appointmentTypes)
        .innerJoin(products, eq(products.id, appointmentTypes.serviceId))
        .where(eq(appointmentTypes.id, typeId));
    } else if (input.kind === 'exam') {
      [type] = await tx
        .select({
          serviceId: exams.serviceId,
          archivedAt: products.archivedAt,
          purpose: products.purpose,
        })
        .from(exams)
        .innerJoin(products, eq(products.id, exams.serviceId))
        .where(eq(exams.id, input.examId));
    } else if (input.kind === 'vaccine') {
      [type] = await tx
        .select({
          serviceId: vaccines.serviceId,
          archivedAt: products.archivedAt,
          purpose: products.purpose,
        })
        .from(vaccines)
        .innerJoin(products, eq(products.id, vaccines.serviceId))
        .where(eq(vaccines.id, input.vaccineId));
    }
    if (!type?.serviceId || type.archivedAt || type.purpose === 'internal') return;
    const [author] = await tx
      .select({ active: users.active })
      .from(users)
      .where(eq(users.id, authorId));
    if (!author?.active) return;
    const [already] = await tx
      .select({ id: saleItems.id })
      .from(saleItems)
      .where(eq(saleItems.clinicalEventId, eventId));
    if (already) return;
    await this.sales.addToPatient(
      auth,
      patientId,
      { productId: type.serviceId, professionalId: authorId, quantity: 1 },
      { tx, clinicalEventId: eventId },
    );
  }

  /** Rascunho nunca publicado pode ser descartado pelo autor. */
  async discard(auth: AuthContext, id: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const row = await this.lockEvent(tx, auth, id);
      if (row.status !== 'draft') {
        throw conflict('Evento publicado não é apagado: invalide-o informando o motivo.');
      }
      const before = await this.get(auth, id, tx);
      await tx.delete(clinicalEvents).where(eq(clinicalEvents.id, id));
      await recordAudit(tx, actorOf(auth), {
        entity: 'clinical_event',
        entityId: id,
        action: 'discard',
        before: snapshot(before, row.patientId),
      });
    });
  }

  /** Invalidar mantém o registro na linha do tempo, riscado, com quem, quando e por quê. */
  async invalidate(auth: AuthContext, id: string, reason: string): Promise<ClinicalEvent> {
    return this.db.transaction(async (tx) => {
      const row = await this.lockEvent(tx, auth, id);
      await this.lockActivePatient(tx, auth, row.patientId);
      const before = await this.get(auth, id, tx);
      if (row.status !== 'published') {
        throw conflict(
          row.status === 'draft'
            ? 'Rascunho não é invalidado: descarte-o.'
            : 'Este evento já foi invalidado.',
        );
      }
      if (!before.removable) throw forbidden();
      await tx
        .update(clinicalEvents)
        .set({
          status: 'voided',
          voidedAt: this.now(),
          voidedBy: auth.userId,
          voidReason: reason,
          updatedBy: auth.userId,
          updatedAt: this.now(),
        })
        .where(eq(clinicalEvents.id, id));
      const after = await this.get(auth, id, tx);
      await recordAudit(tx, actorOf(auth), {
        entity: 'clinical_event',
        entityId: id,
        action: 'void',
        before: snapshot(before, row.patientId),
        after: snapshot(after, row.patientId),
      });
      return after;
    });
  }

  /** Foto clínica: um evento por imagem, publicado ao enviar. */
  async addPhoto(
    auth: AuthContext,
    patientId: string,
    upload: PhotoUpload,
  ): Promise<ClinicalEvent> {
    return this.db.transaction(async (tx) => {
      await this.lockActivePatient(tx, auth, patientId);
      const id = newId();
      const now = this.now();
      await tx.insert(clinicalEvents).values({
        id,
        organizationId: auth.organizationId,
        unitId: auth.unitId,
        patientId,
        kind: 'photo',
        status: 'published',
        occurredAt: this.occurredAt(auth, upload.occurredAt, null),
        authorId: auth.userId,
        payload: { caption: upload.caption },
        publishedAt: now,
        updatedBy: auth.userId,
        createdAt: now,
        updatedAt: now,
      });
      await tx.insert(clinicalFiles).values({
        id: newId(),
        organizationId: auth.organizationId,
        eventId: id,
        contentType: upload.contentType,
        byteSize: upload.data.length,
        sha256: createHash('sha256').update(upload.data).digest('hex'),
        data: upload.data,
      });
      const after = await this.get(auth, id, tx);
      await recordAudit(tx, actorOf(auth), {
        entity: 'clinical_event',
        entityId: id,
        action: 'create',
        after: snapshot(after, patientId),
      });
      return after;
    });
  }

  async file(
    auth: AuthContext,
    fileId: string,
  ): Promise<{ contentType: string; data: Buffer; sha256: string }> {
    const [row] = await this.db
      .select({
        contentType: clinicalFiles.contentType,
        data: clinicalFiles.data,
        sha256: clinicalFiles.sha256,
        status: clinicalEvents.status,
        authorId: clinicalEvents.authorId,
      })
      .from(clinicalFiles)
      .innerJoin(clinicalEvents, eq(clinicalEvents.id, clinicalFiles.eventId))
      .where(
        and(eq(clinicalFiles.id, fileId), eq(clinicalFiles.organizationId, auth.organizationId)),
      );
    if (!row || (row.status === 'draft' && row.authorId !== auth.userId)) {
      throw notFound('Arquivo');
    }
    return { contentType: row.contentType, data: row.data, sha256: row.sha256 };
  }

  /** Texto inicial do prontuário (pelo tipo de atendimento) ou da receita/documento (pelo modelo). */
  async render(
    auth: AuthContext,
    patientId: string,
    source: { typeId?: string | undefined; templateId?: string | undefined },
  ): Promise<{ title: string; body: string }> {
    const patient = await this.patients.get(auth, patientId);
    let title = '';
    let body = '';
    if (source.typeId) {
      const [type] = await this.db
        .select({ name: appointmentTypes.name, body: appointmentTypes.recordTemplate })
        .from(appointmentTypes)
        .where(
          and(
            eq(appointmentTypes.id, source.typeId),
            eq(appointmentTypes.organizationId, auth.organizationId),
          ),
        );
      if (!type) throw notFound('Tipo de atendimento');
      title = type.name;
      body = type.body;
    } else if (source.templateId) {
      const [template] = await this.db
        .select({ name: clinicalTemplates.name, body: clinicalTemplates.body })
        .from(clinicalTemplates)
        .where(
          and(
            eq(clinicalTemplates.id, source.templateId),
            eq(clinicalTemplates.organizationId, auth.organizationId),
          ),
        );
      if (!template) throw notFound('Modelo');
      title = template.name;
      body = template.body;
    }
    return { title, body: renderTemplate(body, await this.placeholders(auth, patient)) };
  }

  /** Peso ao longo do tempo: pesagens e atendimentos publicados com peso (RN-08). */
  private async weights(patientId: string): Promise<WeightPoint[]> {
    const rows = await this.db
      .select({
        eventId: clinicalEvents.id,
        occurredAt: clinicalEvents.occurredAt,
        weightKg: clinicalVitals.weightKg,
      })
      .from(clinicalVitals)
      .innerJoin(clinicalEvents, eq(clinicalEvents.id, clinicalVitals.eventId))
      .where(
        and(
          eq(clinicalEvents.patientId, patientId),
          eq(clinicalEvents.status, 'published'),
          isNotNull(clinicalVitals.weightKg),
        ),
      )
      .orderBy(asc(clinicalEvents.occurredAt), asc(clinicalEvents.id))
      .limit(500);
    return rows.flatMap((r) =>
      r.weightKg === null
        ? []
        : [{ eventId: r.eventId, occurredAt: r.occurredAt.toISOString(), weightKg: r.weightKg }],
    );
  }

  private async placeholders(
    auth: AuthContext,
    patient: Patient,
  ): Promise<Record<TemplatePlaceholder, string | null>> {
    const [[owner], [author], [unit], weights] = await Promise.all([
      this.db
        .select({ cpf: clients.cpf, cnpj: clients.cnpj })
        .from(clients)
        .where(eq(clients.id, patient.owner.id)),
      this.db.select({ name: users.name }).from(users).where(eq(users.id, auth.userId)),
      this.db
        .select({ name: units.name, timeZone: units.timeZone })
        .from(units)
        .where(eq(units.id, auth.unitId)),
      this.weights(patient.id),
    ]);
    const weight = weights.at(-1);
    const today = instantToZoned(this.now(), unit?.timeZone ?? 'America/Sao_Paulo').date;
    return {
      animal: patient.name,
      especie: patient.speciesName,
      raca: patient.breedName,
      sexo: patient.sex === 'female' ? 'fêmea' : patient.sex === 'male' ? 'macho' : null,
      idade: patient.birthDate ? formatAge(patient.birthDate) : null,
      peso: weight ? `${formatKg(weight.weightKg)} kg` : null,
      microchip: patient.microchip,
      responsavel: patient.owner.name,
      documento_responsavel: owner?.cpf
        ? `CPF ${formatCpf(owner.cpf)}`
        : owner?.cnpj
          ? `CNPJ ${formatCnpj(owner.cnpj)}`
          : null,
      profissional: author?.name ?? null,
      data: today.split('-').reverse().join('/'),
      unidade: unit?.name ?? null,
    };
  }

  /** Ausente = agora. Outra data exige permissão; data futura nunca é aceita. */
  private occurredAt(auth: AuthContext, requested: string | null, current: Date | null): Date {
    const now = this.now();
    if (requested === null) return current ?? now;
    const at = new Date(requested);
    if (at.getTime() > now.getTime() + CLOCK_SKEW_MS) {
      throw invalid('occurredAt', 'A data e hora não podem estar no futuro');
    }
    const reference = current ?? now;
    if (
      Math.abs(at.getTime() - reference.getTime()) > CLOCK_SKEW_MS &&
      !auth.permissions.has('clinical.change_datetime')
    ) {
      throw new AppError(
        'forbidden',
        'Registrar com outra data e hora exige permissão. Deixe a data em branco para usar agora.',
      );
    }
    return Math.abs(at.getTime() - reference.getTime()) > CLOCK_SKEW_MS ? at : reference;
  }

  /** Confere que tudo o que o evento referencia é da organização e, se novo, está ativo. */
  private async resolveRefs(
    tx: Executor,
    auth: AuthContext,
    patientId: string,
    input: ClinicalEventData,
    before: EventRow | null,
  ): Promise<{
    typeId: string | null;
    appointmentId: string | null;
    templateId: string | null;
    pathologyIds: string[];
  }> {
    const out = {
      typeId: null as string | null,
      appointmentId: null as string | null,
      templateId: null as string | null,
      pathologyIds: [] as string[],
    };
    if (input.kind === 'encounter') {
      if (input.typeId) {
        const [type] = await tx
          .select({ archivedAt: appointmentTypes.archivedAt })
          .from(appointmentTypes)
          .where(
            and(
              eq(appointmentTypes.id, input.typeId),
              eq(appointmentTypes.organizationId, auth.organizationId),
            ),
          );
        if (!type || (type.archivedAt && input.typeId !== before?.appointmentTypeId)) {
          throw invalid('typeId', 'Tipo de atendimento inválido');
        }
        out.typeId = input.typeId;
      }
      if (input.appointmentId) {
        const [link] = await tx
          .select({ id: appointments.id })
          .from(appointments)
          .innerJoin(appointmentPatients, eq(appointmentPatients.appointmentId, appointments.id))
          .where(
            and(
              eq(appointments.id, input.appointmentId),
              eq(appointments.organizationId, auth.organizationId),
              eq(appointmentPatients.patientId, patientId),
            ),
          );
        if (!link) throw invalid('appointmentId', 'O agendamento não é deste animal');
        out.appointmentId = input.appointmentId;
      }
      out.pathologyIds = [...new Set(input.pathologyIds)];
    }
    if (input.kind === 'pathology') out.pathologyIds = [input.pathologyId];
    if (out.pathologyIds.length) {
      const previous = before
        ? (
            await tx
              .select({ id: clinicalEventPathologies.pathologyId })
              .from(clinicalEventPathologies)
              .where(eq(clinicalEventPathologies.eventId, before.id))
          ).map((r) => r.id)
        : [];
      const found = await tx
        .select({ id: pathologies.id, archivedAt: pathologies.archivedAt })
        .from(pathologies)
        .where(
          and(
            inArray(pathologies.id, out.pathologyIds),
            eq(pathologies.organizationId, auth.organizationId),
          ),
        );
      for (const pathologyId of out.pathologyIds) {
        const row = found.find((f) => f.id === pathologyId);
        if (!row || (row.archivedAt && !previous.includes(pathologyId))) {
          throw invalid(
            input.kind === 'pathology' ? 'pathologyId' : 'pathologyIds',
            'Patologia inválida',
          );
        }
      }
    }
    if ((input.kind === 'document' || input.kind === 'prescription') && input.templateId) {
      const [template] = await tx
        .select({ kind: clinicalTemplates.kind, archivedAt: clinicalTemplates.archivedAt })
        .from(clinicalTemplates)
        .where(
          and(
            eq(clinicalTemplates.id, input.templateId),
            eq(clinicalTemplates.organizationId, auth.organizationId),
          ),
        );
      if (
        !template ||
        template.kind !== input.kind ||
        (template.archivedAt && input.templateId !== before?.templateId)
      ) {
        throw invalid('templateId', 'Modelo inválido');
      }
      out.templateId = input.templateId;
    }
    return out;
  }

  private async writeDetails(
    tx: Executor,
    eventId: string,
    input: ClinicalEventData,
    pathologyIds: string[],
  ): Promise<void> {
    await tx.delete(clinicalVitals).where(eq(clinicalVitals.eventId, eventId));
    const vitals: Vitals | null =
      input.kind === 'encounter'
        ? input.vitals
        : input.kind === 'weight'
          ? { ...emptyVitals, weightKg: input.weightKg }
          : null;
    if (vitals && Object.values(vitals).some((v) => v !== null)) {
      await tx.insert(clinicalVitals).values({ eventId, ...vitals });
    }
    await tx.delete(clinicalEventPathologies).where(eq(clinicalEventPathologies.eventId, eventId));
    if (pathologyIds.length) {
      await tx
        .insert(clinicalEventPathologies)
        .values(pathologyIds.map((pathologyId, position) => ({ eventId, pathologyId, position })));
    }
  }

  /**
   * Resultado de exame [RN-33]: valores convertidos pelo tipo e marcados contra a faixa do
   * animal na data do evento, com tudo copiado no resultado.
   */
  private async writeExam(
    tx: Executor,
    auth: AuthContext,
    eventId: string,
    patientId: string,
    input: ClinicalEventData,
    occurredAt: Date,
    before: ClinicalEvent | null,
  ): Promise<void> {
    if (input.kind !== 'exam') return;
    const [patient] = await tx
      .select({
        speciesId: patients.speciesId,
        speciesName: species.name,
        birthDate: patients.birthDate,
      })
      .from(patients)
      .leftJoin(species, eq(species.id, patients.speciesId))
      .where(eq(patients.id, patientId));
    const on = instantToZoned(occurredAt, await unitTimeZone(tx, auth.unitId)).date;
    const previous =
      before?.data.kind === 'exam'
        ? {
            examId: before.data.exam.id,
            attributeIds: before.data.values.map((v) => v.attributeId),
          }
        : null;
    const result = await this.exams.buildResult(
      tx,
      auth,
      input,
      {
        speciesId: patient?.speciesId ?? null,
        speciesName: patient?.speciesName ?? null,
        birthDate: patient?.birthDate ?? null,
      },
      on,
      previous,
    );
    if ((input.publish || before?.status === 'published') && result.values.length === 0) {
      throw invalid('values', 'Preencha ao menos um resultado para finalizar');
    }
    await tx.delete(clinicalExamResults).where(eq(clinicalExamResults.eventId, eventId));
    await tx.insert(clinicalExamResults).values({
      eventId,
      examId: input.examId,
      referenceLabel: result.referenceLabel,
    });
    if (result.values.length) {
      await tx.insert(clinicalExamValues).values(
        result.values.map((v, position) => ({
          eventId,
          attributeId: v.attributeId,
          position,
          section: v.section,
          name: v.name,
          unit: v.unit,
          dataType: v.dataType,
          numericValue: typeof v.value === 'number' ? v.value : null,
          textValue: typeof v.value === 'string' ? v.value : null,
          low: v.low,
          high: v.high,
          flag: v.flag,
        })),
      );
    }
  }

  /**
   * Aplicação de vacina [RN-20]: a dose informada (sugerida pelo formulário) e a próxima data,
   * que precisa vir depois da aplicação. Aplicar de novo reabre um protocolo encerrado.
   */
  private async writeVaccination(
    tx: Executor,
    auth: AuthContext,
    eventId: string,
    patientId: string,
    input: ClinicalEventData,
    occurredAt: Date,
    before: ClinicalEvent | null,
  ): Promise<void> {
    if (input.kind !== 'vaccine') return;
    const previous = before?.data.kind === 'vaccine' ? before.data.vaccine.id : null;
    const { vaccine } = await this.vaccines.details(
      tx,
      auth,
      patientId,
      input.vaccineId,
      eventId,
      previous === input.vaccineId,
    );
    const appliedOn = instantToZoned(occurredAt, await unitTimeZone(tx, auth.unitId)).date;
    if (input.nextDueOn !== null && input.nextDueOn <= appliedOn) {
      throw invalid('nextDueOn', 'A próxima dose precisa ser depois da aplicação');
    }
    await tx.delete(clinicalVaccinations).where(eq(clinicalVaccinations.eventId, eventId));
    await tx.insert(clinicalVaccinations).values({
      eventId,
      patientId,
      vaccineId: vaccine.id,
      doseNumber: input.doseNumber,
      doseLabel: doseLabel(input.doseNumber, vaccine.primaryDoses),
      lotNumber: input.lotNumber,
      nextDueOn: input.nextDueOn,
    });
    await this.vaccines.reopen(tx, patientId, vaccine.id);
  }

  /** Publicados e invalidados de todos; rascunhos só do próprio autor. */
  private visibleTo(auth: AuthContext, patientId: string): SQL {
    return and(
      eq(clinicalEvents.patientId, patientId),
      eq(clinicalEvents.organizationId, auth.organizationId),
      or(ne(clinicalEvents.status, 'draft'), eq(clinicalEvents.authorId, auth.userId)),
    ) as SQL;
  }

  private async load(db: Executor, auth: AuthContext, ids: string[]): Promise<ClinicalEvent[]> {
    if (ids.length === 0) return [];
    const voider = alias(users, 'voider');
    const rows = await db
      .select({
        e: clinicalEvents,
        authorName: users.name,
        voiderName: voider.name,
        typeName: appointmentTypes.name,
        templateName: clinicalTemplates.name,
        patientArchivedAt: patients.archivedAt,
      })
      .from(clinicalEvents)
      .innerJoin(users, eq(users.id, clinicalEvents.authorId))
      .innerJoin(patients, eq(patients.id, clinicalEvents.patientId))
      .leftJoin(voider, eq(voider.id, clinicalEvents.voidedBy))
      .leftJoin(appointmentTypes, eq(appointmentTypes.id, clinicalEvents.appointmentTypeId))
      .leftJoin(clinicalTemplates, eq(clinicalTemplates.id, clinicalEvents.templateId))
      .where(inArray(clinicalEvents.id, ids));
    // Sequencial: dentro de uma transação a conexão é uma só.
    const vitalRows = await db
      .select()
      .from(clinicalVitals)
      .where(inArray(clinicalVitals.eventId, ids));
    const pathologyRows = await db
      .select({
        eventId: clinicalEventPathologies.eventId,
        id: pathologies.id,
        code: pathologies.code,
        name: pathologies.name,
      })
      .from(clinicalEventPathologies)
      .innerJoin(pathologies, eq(pathologies.id, clinicalEventPathologies.pathologyId))
      .where(inArray(clinicalEventPathologies.eventId, ids))
      .orderBy(asc(clinicalEventPathologies.position));
    const fileRows = await db
      .select({
        eventId: clinicalFiles.eventId,
        id: clinicalFiles.id,
        contentType: clinicalFiles.contentType,
        byteSize: clinicalFiles.byteSize,
      })
      .from(clinicalFiles)
      .where(inArray(clinicalFiles.eventId, ids));
    const examRows = await db
      .select({
        eventId: clinicalExamResults.eventId,
        examId: clinicalExamResults.examId,
        examName: exams.name,
        referenceLabel: clinicalExamResults.referenceLabel,
      })
      .from(clinicalExamResults)
      .innerJoin(exams, eq(exams.id, clinicalExamResults.examId))
      .where(inArray(clinicalExamResults.eventId, ids));
    const examValueRows = examRows.length
      ? await db
          .select()
          .from(clinicalExamValues)
          .where(inArray(clinicalExamValues.eventId, ids))
          .orderBy(asc(clinicalExamValues.position))
      : [];
    const vaccinationRows = await db
      .select({
        eventId: clinicalVaccinations.eventId,
        vaccineId: vaccines.id,
        vaccineName: vaccines.name,
        vaccineKind: vaccines.kind,
        doseNumber: clinicalVaccinations.doseNumber,
        doseLabel: clinicalVaccinations.doseLabel,
        lotNumber: clinicalVaccinations.lotNumber,
        nextDueOn: clinicalVaccinations.nextDueOn,
      })
      .from(clinicalVaccinations)
      .innerJoin(vaccines, eq(vaccines.id, clinicalVaccinations.vaccineId))
      .where(inArray(clinicalVaccinations.eventId, ids));
    const byId = new Map(
      rows.map(({ e, authorName, voiderName, typeName, templateName, patientArchivedAt }) => {
        const own = e.authorId === auth.userId;
        const can = (p: Permission) => auth.permissions.has(p);
        const writable = patientArchivedAt === null && can('clinical.record');
        const vitals = vitalRows.find((v) => v.eventId === e.id);
        const pathologiesOf = pathologyRows
          .filter((p) => p.eventId === e.id)
          .map(({ eventId: _e, ...p }) => p);
        const event: ClinicalEvent = {
          id: e.id,
          patientId: e.patientId,
          kind: e.kind,
          status: e.status,
          occurredAt: e.occurredAt.toISOString(),
          professional: { id: e.authorId, name: authorName },
          appointmentId: e.appointmentId,
          createdAt: e.createdAt.toISOString(),
          updatedAt: e.updatedAt.toISOString(),
          publishedAt: e.publishedAt?.toISOString() ?? null,
          void:
            e.voidedAt && e.voidReason
              ? { at: e.voidedAt.toISOString(), by: voiderName ?? '', reason: e.voidReason }
              : null,
          editable:
            writable &&
            e.kind !== 'photo' &&
            ((e.status === 'draft' && own) ||
              (e.status === 'published' && (own || can('clinical.edit_any')))),
          removable:
            writable &&
            ((e.status === 'draft' && own) ||
              (e.status === 'published' && (own || can('clinical.edit_any')))),
          data: contentOf(e, {
            vitals: vitals
              ? {
                  heartRate: vitals.heartRate,
                  respiratoryRate: vitals.respiratoryRate,
                  temperature: vitals.temperature,
                  capillaryRefill: vitals.capillaryRefill,
                  weightKg: vitals.weightKg,
                  bodyScore: vitals.bodyScore,
                }
              : emptyVitals,
            pathologies: pathologiesOf,
            file: fileRows.find((f) => f.eventId === e.id) ?? null,
            typeName,
            templateName,
            exam: examResultOf(
              examRows.find((r) => r.eventId === e.id),
              examValueRows.filter((v) => v.eventId === e.id),
            ),
            vaccination: vaccinationOf(vaccinationRows.find((r) => r.eventId === e.id)),
          }),
        };
        return [e.id, event] as const;
      }),
    );
    return ids.flatMap((id) => {
      const event = byId.get(id);
      return event ? [event] : [];
    });
  }

  private denyEdit(event: ClinicalEvent): AppError {
    if (event.status === 'voided') return conflict('Evento invalidado não pode ser corrigido.');
    if (event.kind === 'photo') return conflict('Foto não é editada: invalide e envie outra.');
    return forbidden();
  }

  private async assertPatient(db: Executor, auth: AuthContext, patientId: string): Promise<void> {
    const [row] = await db
      .select({ id: patients.id })
      .from(patients)
      .where(and(eq(patients.id, patientId), eq(patients.organizationId, auth.organizationId)));
    if (!row) throw notFound('Animal');
  }

  private async lockActivePatient(tx: Executor, auth: AuthContext, patientId: string) {
    const [row] = await tx
      .select({ archivedAt: patients.archivedAt })
      .from(patients)
      .where(and(eq(patients.id, patientId), eq(patients.organizationId, auth.organizationId)))
      .for('share');
    if (!row) throw notFound('Animal');
    if (row.archivedAt) throw conflict('A ficha está arquivada. Restaure-a para registrar.');
  }

  private async lockEvent(tx: Executor, auth: AuthContext, id: string): Promise<EventRow> {
    const [row] = await tx
      .select()
      .from(clinicalEvents)
      .where(and(eq(clinicalEvents.id, id), eq(clinicalEvents.organizationId, auth.organizationId)))
      .for('update');
    if (!row || (row.status === 'draft' && row.authorId !== auth.userId)) {
      throw notFound('Evento clínico');
    }
    return row;
  }
}

/** O que vai em JSONB: só texto livre; o que é consultável fica em colunas tipadas. */
function payloadOf(input: ClinicalEventData): Record<string, string> {
  switch (input.kind) {
    case 'encounter':
      return { summary: input.summary, narrative: input.narrative };
    case 'weight':
    case 'pathology':
      return { notes: input.notes };
    case 'observation':
      return { text: input.text };
    case 'document':
    case 'prescription':
      return { title: input.title, body: input.body };
    case 'exam':
    case 'vaccine':
      return { notes: input.notes };
  }
}

function contentOf(
  e: EventRow,
  related: {
    vitals: Vitals;
    pathologies: { id: string; code: string | null; name: string }[];
    file: { id: string; contentType: string; byteSize: number } | null;
    typeName: string | null;
    templateName: string | null;
    exam: Omit<Extract<ClinicalEventContent, { kind: 'exam' }>, 'kind' | 'notes'> | null;
    vaccination: Omit<Extract<ClinicalEventContent, { kind: 'vaccine' }>, 'kind' | 'notes'> | null;
  },
): ClinicalEventContent {
  const p = (e.payload ?? {}) as Record<string, unknown>;
  const str = (key: string) => (typeof p[key] === 'string' ? p[key] : '');
  switch (e.kind) {
    case 'encounter':
      return {
        kind: 'encounter',
        type:
          e.appointmentTypeId && related.typeName
            ? { id: e.appointmentTypeId, name: related.typeName }
            : null,
        summary: str('summary'),
        narrative: str('narrative'),
        vitals: related.vitals,
        pathologies: related.pathologies,
      };
    case 'weight':
      return { kind: 'weight', weightKg: related.vitals.weightKg ?? 0, notes: str('notes') };
    case 'pathology': {
      const pathology = related.pathologies[0];
      if (!pathology) throw new Error(`Evento ${e.id} de patologia sem patologia.`);
      return { kind: 'pathology', pathology, notes: str('notes') };
    }
    case 'observation':
      return { kind: 'observation', text: str('text') };
    case 'photo':
      if (!related.file) throw new Error(`Evento ${e.id} de foto sem arquivo.`);
      return {
        kind: 'photo',
        fileId: related.file.id,
        contentType: related.file.contentType,
        byteSize: related.file.byteSize,
        caption: str('caption'),
      };
    case 'document':
    case 'prescription':
      return {
        kind: e.kind,
        template:
          e.templateId && related.templateName
            ? { id: e.templateId, name: related.templateName }
            : null,
        title: str('title'),
        body: str('body'),
      };
    case 'exam':
      if (!related.exam) throw new Error(`Evento ${e.id} de exame sem resultado.`);
      return { kind: 'exam', ...related.exam, notes: str('notes') };
    case 'vaccine':
      if (!related.vaccination) throw new Error(`Evento ${e.id} de vacina sem aplicação.`);
      return { kind: 'vaccine', ...related.vaccination, notes: str('notes') };
  }
}

function examResultOf(
  result: { examId: string; examName: string; referenceLabel: string | null } | undefined,
  values: (typeof clinicalExamValues.$inferSelect)[],
): Omit<Extract<ClinicalEventContent, { kind: 'exam' }>, 'kind' | 'notes'> | null {
  if (!result) return null;
  return {
    exam: { id: result.examId, name: result.examName },
    referenceLabel: result.referenceLabel,
    values: values.map((v) => ({
      attributeId: v.attributeId,
      section: v.section,
      name: v.name,
      unit: v.unit,
      dataType: v.dataType,
      value: v.dataType === 'text' ? (v.textValue ?? '') : (v.numericValue ?? 0),
      low: v.low,
      high: v.high,
      flag: v.flag,
    })),
  };
}

function vaccinationOf(
  row:
    | {
        vaccineId: string;
        vaccineName: string;
        vaccineKind: Extract<ClinicalEventContent, { kind: 'vaccine' }>['vaccine']['kind'];
        doseNumber: number;
        doseLabel: string;
        lotNumber: string;
        nextDueOn: string | null;
      }
    | undefined,
): Omit<Extract<ClinicalEventContent, { kind: 'vaccine' }>, 'kind' | 'notes'> | null {
  if (!row) return null;
  return {
    vaccine: { id: row.vaccineId, name: row.vaccineName, kind: row.vaccineKind },
    doseNumber: row.doseNumber,
    dose: row.doseLabel,
    lotNumber: row.lotNumber,
    nextDueOn: row.nextDueOn,
  };
}

/** Campos planos, para o log mostrar "campo: antes → depois" (sinais vitais um a um). */
function snapshot(e: ClinicalEvent, patientId: string) {
  const content = e.data;
  const flat: Record<string, unknown> = { ...content };
  delete flat.kind;
  if ('vitals' in content) {
    delete flat.vitals;
    Object.assign(flat, content.vitals);
  }
  if (content.kind === 'vaccine') flat.vaccine = content.vaccine.name;
  if (content.kind === 'exam') {
    flat.exam = content.exam.name;
    flat.values = content.values
      .map((v) => `${v.name}: ${String(v.value)}${v.unit ? ` ${v.unit}` : ''}`)
      .join('; ');
  }
  return {
    patientId,
    kind: e.kind,
    status: e.status,
    occurredAt: e.occurredAt,
    ...flat,
    ...(e.void ? { voidReason: e.void.reason } : {}),
  };
}

const kg = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 });
const formatKg = (value: number) => kg.format(value);

function encodeCursor(occurredAt: string, id: string): string {
  return Buffer.from(JSON.stringify([occurredAt, id])).toString('base64url');
}

function decodeCursor(cursor: string): { at: Date; id: string } {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (
      Array.isArray(parsed) &&
      typeof parsed[0] === 'string' &&
      typeof parsed[1] === 'string' &&
      /^[0-9a-f-]{36}$/.test(parsed[1]) &&
      !Number.isNaN(Date.parse(parsed[0]))
    ) {
      return { at: new Date(parsed[0]), id: parsed[1] };
    }
  } catch {
    // cai no erro abaixo
  }
  throw invalid('cursor', 'Cursor inválido');
}
