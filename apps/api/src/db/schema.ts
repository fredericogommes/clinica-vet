import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  check,
  customType,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
};

export const organizations = pgTable('organizations', {
  id: uuid('id').primaryKey(),
  name: text('name').notNull(),
  ...timestamps,
});

export const units = pgTable(
  'units',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    name: text('name').notNull(),
    timeZone: text('time_zone').notNull().default('America/Sao_Paulo'),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [uniqueIndex('units_org_name_uq').on(t.organizationId, t.name)],
);

export const costCenters = pgTable(
  'cost_centers',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    unitId: uuid('unit_id')
      .notNull()
      .references(() => units.id),
    name: text('name').notNull(),
    isDefault: boolean('is_default').notNull().default(false),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('cost_centers_unit_name_uq').on(t.unitId, t.name),
    uniqueIndex('cost_centers_unit_default_uq')
      .on(t.unitId)
      .where(sql`${t.isDefault}`),
  ],
);

export const roles = pgTable(
  'roles',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    name: text('name').notNull(),
    description: text('description'),
    isTemplate: boolean('is_template').notNull().default(false),
    ...timestamps,
  },
  (t) => [uniqueIndex('roles_org_name_uq').on(t.organizationId, t.name)],
);

export const rolePermissions = pgTable(
  'role_permissions',
  {
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    permission: text('permission').notNull(),
  },
  (t) => [primaryKey({ columns: [t.roleId, t.permission] })],
);

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id),
    name: text('name').notNull(),
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    active: boolean('active').notNull().default(true),
    discountLimitPercent: numeric('discount_limit_percent', {
      precision: 5,
      scale: 2,
      mode: 'number',
    }),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('users_email_uq').on(sql`lower(${t.email})`),
    check(
      'users_discount_limit_ck',
      sql`${t.discountLimitPercent} is null or ${t.discountLimitPercent} between 0 and 100`,
    ),
  ],
);

export const userUnits = pgTable(
  'user_units',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    unitId: uuid('unit_id')
      .notNull()
      .references(() => units.id),
  },
  (t) => [primaryKey({ columns: [t.userId, t.unitId] })],
);

export const sessions = pgTable(
  'sessions',
  {
    /** SHA-256 do token do cookie; o token em si nunca é persistido. */
    tokenHash: text('token_hash').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    currentUnitId: uuid('current_unit_id')
      .notNull()
      .references(() => units.id),
    csrfToken: text('csrf_token').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
);

export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    unitId: uuid('unit_id').references(() => units.id),
    actorUserId: uuid('actor_user_id').references(() => users.id),
    entity: text('entity').notNull(),
    entityId: text('entity_id').notNull(),
    action: text('action').notNull(),
    before: jsonb('before'),
    after: jsonb('after'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('audit_log_org_time_idx').on(t.organizationId, t.occurredAt),
    index('audit_log_entity_idx').on(t.entity, t.entityId),
  ],
);

/** Contadores por organização para códigos internos legíveis (ficha do cliente, do animal). */
export const organizationCounters = pgTable(
  'organization_counters',
  {
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    name: text('name').notNull(),
    value: integer('value').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.organizationId, t.name] })],
);

const catalogColumns = {
  id: uuid('id').primaryKey(),
  organizationId: uuid('organization_id')
    .notNull()
    .references(() => organizations.id),
  name: text('name').notNull(),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  ...timestamps,
};

export const species = pgTable('species', catalogColumns, (t) => [
  uniqueIndex('species_org_name_uq').on(t.organizationId, sql`lower(${t.name})`),
]);

export const breeds = pgTable(
  'breeds',
  {
    ...catalogColumns,
    speciesId: uuid('species_id')
      .notNull()
      .references(() => species.id),
  },
  (t) => [
    uniqueIndex('breeds_species_name_uq').on(t.speciesId, sql`lower(${t.name})`),
    // Alvo da FK composta em patients: garante que a raça pertence à espécie do animal.
    unique('breeds_id_species_uq').on(t.id, t.speciesId),
  ],
);

export const coats = pgTable('coats', catalogColumns, (t) => [
  uniqueIndex('coats_org_name_uq').on(t.organizationId, sql`lower(${t.name})`),
]);

export const clientOrigins = pgTable('client_origins', catalogColumns, (t) => [
  uniqueIndex('client_origins_org_name_uq').on(t.organizationId, sql`lower(${t.name})`),
]);

/** O grupo decide se falta de saldo bloqueia a venda (ex. medicamento controlado) [RN-31]. */
export const productGroups = pgTable(
  'product_groups',
  {
    ...catalogColumns,
    blocksSaleWithoutStock: boolean('blocks_sale_without_stock').notNull().default(true),
  },
  (t) => [uniqueIndex('product_groups_org_name_uq').on(t.organizationId, sql`lower(${t.name})`)],
);

export const productBrands = pgTable('product_brands', catalogColumns, (t) => [
  uniqueIndex('product_brands_org_name_uq').on(t.organizationId, sql`lower(${t.name})`),
]);

export const clients = pgTable(
  'clients',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    code: integer('code').notNull(),
    personType: text('person_type', { enum: ['individual', 'company'] }).notNull(),
    name: text('name').notNull(),
    nationality: text('nationality'),
    sex: text('sex', { enum: ['female', 'male'] }),
    cpf: text('cpf'),
    cnpj: text('cnpj'),
    rg: text('rg'),
    birthDate: date('birth_date'),
    originId: uuid('origin_id').references(() => clientOrigins.id),
    profession: text('profession'),
    municipalRegistration: text('municipal_registration'),
    notes: text('notes'),
    cep: text('cep'),
    street: text('street'),
    number: text('number'),
    complement: text('complement'),
    district: text('district'),
    city: text('city'),
    state: text('state'),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('clients_org_code_uq').on(t.organizationId, t.code),
    uniqueIndex('clients_org_cpf_uq')
      .on(t.organizationId, t.cpf)
      .where(sql`${t.cpf} is not null`),
    uniqueIndex('clients_org_cnpj_uq')
      .on(t.organizationId, t.cnpj)
      .where(sql`${t.cnpj} is not null`),
    index('clients_org_name_idx').on(t.organizationId, t.name),
  ],
);

export const clientContacts = pgTable(
  'client_contacts',
  {
    id: uuid('id').primaryKey(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: ['mobile', 'phone', 'email'] }).notNull(),
    value: text('value').notNull(),
    isWhatsapp: boolean('is_whatsapp').notNull().default(false),
    position: integer('position').notNull(),
  },
  (t) => [
    index('client_contacts_client_idx').on(t.clientId),
    index('client_contacts_value_idx').on(t.value),
  ],
);

/**
 * Histórico de consentimento por canal (LGPD). Nunca é atualizado: cada mudança é uma nova
 * linha, e o estado vigente é a linha mais recente do canal.
 */
export const clientConsents = pgTable(
  'client_consents',
  {
    id: uuid('id').primaryKey(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    channel: text('channel', { enum: ['email', 'sms', 'sms_campaign', 'whatsapp'] }).notNull(),
    granted: boolean('granted').notNull(),
    source: text('source').notNull(),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
    recordedBy: uuid('recorded_by').references(() => users.id),
  },
  (t) => [index('client_consents_client_channel_idx').on(t.clientId, t.channel, t.recordedAt)],
);

export const patients = pgTable(
  'patients',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    code: integer('code').notNull(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id),
    name: text('name').notNull(),
    status: text('status', { enum: ['alive', 'deceased'] }).notNull(),
    deceasedOn: date('deceased_on'),
    sex: text('sex', { enum: ['female', 'male', 'unknown'] }).notNull(),
    sterilized: boolean('sterilized'),
    birthDate: date('birth_date'),
    speciesId: uuid('species_id').references(() => species.id),
    breedId: uuid('breed_id').references(() => breeds.id),
    coatId: uuid('coat_id').references(() => coats.id),
    microchip: text('microchip'),
    hasPedigree: boolean('has_pedigree').notNull().default(false),
    pedigreeNumber: text('pedigree_number'),
    markings: text('markings')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('patients_org_code_uq').on(t.organizationId, t.code),
    uniqueIndex('patients_org_microchip_uq')
      .on(t.organizationId, t.microchip)
      .where(sql`${t.microchip} is not null`),
    index('patients_client_idx').on(t.clientId),
    index('patients_org_name_idx').on(t.organizationId, t.name),
    foreignKey({
      name: 'patients_breed_species_fk',
      columns: [t.breedId, t.speciesId],
      foreignColumns: [breeds.id, breeds.speciesId],
    }),
  ],
);

/** Responsáveis ao longo do tempo. A linha com `ended_at` nulo é o responsável atual. */
export const patientOwnerHistory = pgTable(
  'patient_owner_history',
  {
    id: uuid('id').primaryKey(),
    patientId: uuid('patient_id')
      .notNull()
      .references(() => patients.id, { onDelete: 'cascade' }),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    reason: text('reason'),
    changedBy: uuid('changed_by').references(() => users.id),
  },
  (t) => [
    index('patient_owner_history_patient_idx').on(t.patientId),
    uniqueIndex('patient_owner_history_current_uq')
      .on(t.patientId)
      .where(sql`${t.endedAt} is null`),
  ],
);

/** Tipos de atendimento [p.5]: alimentam a agenda e o modelo de prontuário [RN-18]. */
export const appointmentTypes = pgTable(
  'appointment_types',
  {
    ...catalogColumns,
    durationMinutes: integer('duration_minutes').notNull().default(60),
    recordTemplate: text('record_template').notNull().default(''),
    serviceId: uuid('service_id').references((): AnyPgColumn => products.id),
  },
  (t) => [
    uniqueIndex('appointment_types_org_name_uq').on(t.organizationId, sql`lower(${t.name})`),
    check('appointment_types_duration_ck', sql`${t.durationMinutes} between 15 and 720`),
  ],
);

/** Horário de funcionamento da unidade, em minutos desde a meia-noite. Dia sem linha = fechado. */
export const unitOpeningHours = pgTable(
  'unit_opening_hours',
  {
    unitId: uuid('unit_id')
      .notNull()
      .references(() => units.id),
    weekday: smallint('weekday').notNull(),
    startMinute: integer('start_minute').notNull(),
    endMinute: integer('end_minute').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.unitId, t.weekday] }),
    check(
      'unit_opening_hours_range_ck',
      sql`0 <= ${t.startMinute} and ${t.startMinute} < ${t.endMinute} and ${t.endMinute} <= 1440 and ${t.weekday} between 0 and 6`,
    ),
  ],
);

/** Profissionais com agenda na unidade [RN-11]: horário fixo semanal ou escala variável. */
export const scheduleMembers = pgTable(
  'schedule_members',
  {
    unitId: uuid('unit_id')
      .notNull()
      .references(() => units.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    mode: text('mode', { enum: ['fixed', 'variable'] }).notNull(),
    ...timestamps,
  },
  (t) => [primaryKey({ columns: [t.unitId, t.userId] })],
);

export const scheduleFixedHours = pgTable(
  'schedule_fixed_hours',
  {
    unitId: uuid('unit_id').notNull(),
    userId: uuid('user_id').notNull(),
    weekday: smallint('weekday').notNull(),
    startMinute: integer('start_minute').notNull(),
    endMinute: integer('end_minute').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.unitId, t.userId, t.weekday] }),
    foreignKey({
      name: 'schedule_fixed_hours_member_fk',
      columns: [t.unitId, t.userId],
      foreignColumns: [scheduleMembers.unitId, scheduleMembers.userId],
    }).onDelete('cascade'),
    check(
      'schedule_fixed_hours_range_ck',
      sql`0 <= ${t.startMinute} and ${t.startMinute} < ${t.endMinute} and ${t.endMinute} <= 1440 and ${t.weekday} between 0 and 6`,
    ),
  ],
);

/** Turnos da escala variável. Só turnos confirmados abrem horários na agenda. */
export const scheduleShifts = pgTable(
  'schedule_shifts',
  {
    id: uuid('id').primaryKey(),
    unitId: uuid('unit_id')
      .notNull()
      .references(() => units.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    date: date('date').notNull(),
    startMinute: integer('start_minute').notNull(),
    endMinute: integer('end_minute').notNull(),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index('schedule_shifts_unit_date_idx').on(t.unitId, t.date),
    check(
      'schedule_shifts_range_ck',
      sql`0 <= ${t.startMinute} and ${t.startMinute} < ${t.endMinute} and ${t.endMinute} <= 1440`,
    ),
  ],
);

export const appointments = pgTable(
  'appointments',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    unitId: uuid('unit_id')
      .notNull()
      .references(() => units.id),
    professionalId: uuid('professional_id')
      .notNull()
      .references(() => users.id),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id),
    typeId: uuid('type_id')
      .notNull()
      .references(() => appointmentTypes.id),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    status: text('status', {
      enum: ['scheduled', 'confirmed', 'waiting', 'in_progress', 'ready', 'cancelled', 'no_show'],
    }).notNull(),
    notes: text('notes'),
    fitIn: boolean('fit_in').notNull().default(false),
    /** Agendamentos criados juntos por recorrência compartilham a série. */
    seriesId: uuid('series_id'),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    arrivedAt: timestamp('arrived_at', { withTimezone: true }),
    startedAt: timestamp('started_at', { withTimezone: true }),
    readyAt: timestamp('ready_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancelReason: text('cancel_reason'),
    createdBy: uuid('created_by').references(() => users.id),
    ...timestamps,
  },
  (t) => [
    index('appointments_unit_starts_idx').on(t.unitId, t.startsAt),
    index('appointments_client_idx').on(t.clientId),
    index('appointments_series_idx').on(t.seriesId),
    check('appointments_range_ck', sql`${t.endsAt} > ${t.startsAt}`),
    // A exclusão "sem sobreposição por profissional" fica na migração (EXCLUDE USING gist).
  ],
);

export const appointmentPatients = pgTable(
  'appointment_patients',
  {
    appointmentId: uuid('appointment_id')
      .notNull()
      .references(() => appointments.id, { onDelete: 'cascade' }),
    patientId: uuid('patient_id')
      .notNull()
      .references(() => patients.id),
    position: integer('position').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.appointmentId, t.patientId] }),
    index('appointment_patients_patient_idx').on(t.patientId),
  ],
);

/** Diagnóstico codificado [D1, L8]: catálogo próprio com código interno opcional. */
export const pathologies = pgTable(
  'pathologies',
  { ...catalogColumns, code: text('code') },
  (t) => [
    uniqueIndex('pathologies_org_name_uq').on(t.organizationId, sql`lower(${t.name})`),
    uniqueIndex('pathologies_org_code_uq')
      .on(t.organizationId, sql`upper(${t.code})`)
      .where(sql`${t.code} is not null`),
  ],
);

/** Modelos de receita e de documento [p.13]. */
export const clinicalTemplates = pgTable(
  'clinical_templates',
  {
    ...catalogColumns,
    kind: text('kind', { enum: ['prescription', 'document'] }).notNull(),
    body: text('body').notNull(),
  },
  (t) => [
    uniqueIndex('clinical_templates_org_kind_name_uq').on(
      t.organizationId,
      t.kind,
      sql`lower(${t.name})`,
    ),
  ],
);

/**
 * Evento clínico polimórfico [RN-17]: tipo + conteúdo JSONB validado pelo contrato do tipo.
 * O que precisa ser consultado (sinais vitais, peso, diagnóstico) fica em tabelas tipadas.
 */
export const clinicalEvents = pgTable(
  'clinical_events',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    unitId: uuid('unit_id')
      .notNull()
      .references(() => units.id),
    patientId: uuid('patient_id')
      .notNull()
      .references(() => patients.id),
    kind: text('kind', {
      enum: [
        'encounter',
        'weight',
        'pathology',
        'observation',
        'photo',
        'document',
        'prescription',
        'exam',
        'vaccine',
      ],
    }).notNull(),
    status: text('status', { enum: ['draft', 'published', 'voided'] }).notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    authorId: uuid('author_id')
      .notNull()
      .references(() => users.id),
    appointmentId: uuid('appointment_id').references(() => appointments.id),
    appointmentTypeId: uuid('appointment_type_id').references(() => appointmentTypes.id),
    templateId: uuid('template_id').references(() => clinicalTemplates.id),
    payload: jsonb('payload').notNull(),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    voidedAt: timestamp('voided_at', { withTimezone: true }),
    voidedBy: uuid('voided_by').references(() => users.id),
    voidReason: text('void_reason'),
    updatedBy: uuid('updated_by').references(() => users.id),
    ...timestamps,
  },
  (t) => [
    index('clinical_events_patient_time_idx').on(t.patientId, t.occurredAt, t.id),
    index('clinical_events_author_idx').on(t.authorId),
    check(
      'clinical_events_status_ck',
      sql`(${t.status} = 'draft' and ${t.publishedAt} is null and ${t.voidedAt} is null)
        or (${t.status} = 'published' and ${t.publishedAt} is not null and ${t.voidedAt} is null)
        or (${t.status} = 'voided' and ${t.publishedAt} is not null and ${t.voidedAt} is not null
            and ${t.voidReason} is not null)`,
    ),
  ],
);

/** Sinais vitais e peso, um registro por evento (atendimento ou pesagem). */
export const clinicalVitals = pgTable(
  'clinical_vitals',
  {
    eventId: uuid('event_id')
      .primaryKey()
      .references(() => clinicalEvents.id, { onDelete: 'cascade' }),
    heartRate: smallint('heart_rate'),
    respiratoryRate: smallint('respiratory_rate'),
    temperature: numeric('temperature', { precision: 4, scale: 1, mode: 'number' }),
    capillaryRefill: numeric('capillary_refill', { precision: 3, scale: 1, mode: 'number' }),
    weightKg: numeric('weight_kg', { precision: 8, scale: 3, mode: 'number' }),
    bodyScore: smallint('body_score'),
  },
  (t) => [
    check(
      'clinical_vitals_ranges_ck',
      sql`(${t.heartRate} is null or ${t.heartRate} between 10 and 400)
        and (${t.respiratoryRate} is null or ${t.respiratoryRate} between 4 and 200)
        and (${t.temperature} is null or ${t.temperature} between 30 and 45)
        and (${t.capillaryRefill} is null or ${t.capillaryRefill} between 0 and 10)
        and (${t.weightKg} is null or ${t.weightKg} between 0.001 and 2000)
        and (${t.bodyScore} is null or ${t.bodyScore} between 1 and 9)`,
    ),
  ],
);

export const clinicalEventPathologies = pgTable(
  'clinical_event_pathologies',
  {
    eventId: uuid('event_id')
      .notNull()
      .references(() => clinicalEvents.id, { onDelete: 'cascade' }),
    pathologyId: uuid('pathology_id')
      .notNull()
      .references(() => pathologies.id),
    position: integer('position').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.eventId, t.pathologyId] }),
    index('clinical_event_pathologies_pathology_idx').on(t.pathologyId),
  ],
);

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => 'bytea' });

/** Imagens clínicas no próprio banco: entram no backup diário junto com o prontuário. */
export const clinicalFiles = pgTable(
  'clinical_files',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    eventId: uuid('event_id')
      .notNull()
      .references(() => clinicalEvents.id, { onDelete: 'cascade' }),
    contentType: text('content_type').notNull(),
    byteSize: integer('byte_size').notNull(),
    sha256: text('sha256').notNull(),
    data: bytea('data').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('clinical_files_event_uq').on(t.eventId)],
);

/**
 * Produto e serviço na mesma tabela [RN-22]. Campos fiscais desde o início [RN-45]; os de
 * mercadoria ficam nulos em serviço e o código de serviço municipal, nulo em produto.
 */
export const products = pgTable(
  'products',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    code: integer('code').notNull(),
    kind: text('kind', { enum: ['product', 'service'] }).notNull(),
    serviceKind: text('service_kind'),
    name: text('name').notNull(),
    unit: text('unit').notNull(),
    barcode: text('barcode'),
    brandId: uuid('brand_id').references(() => productBrands.id),
    groupId: uuid('group_id').references(() => productGroups.id),
    ncm: text('ncm'),
    origin: text('origin').notNull().default('0'),
    acquisition: text('acquisition').notNull().default('resale'),
    cfop: text('cfop'),
    taxSituation: text('tax_situation'),
    municipalServiceCode: text('municipal_service_code'),
    taxProfile: text('tax_profile').notNull().default(''),
    salePrice: numeric('sale_price', { precision: 14, scale: 2, mode: 'number' }).notNull(),
    cost: numeric('cost', { precision: 14, scale: 2, mode: 'number' }),
    purpose: text('purpose').notNull().default('sale'),
    desiredMarkup: numeric('desired_markup', { precision: 7, scale: 2, mode: 'number' }),
    allowPriceChange: boolean('allow_price_change').notNull().default(false),
    showInPriceList: boolean('show_in_price_list').notNull().default(true),
    discountLimitPercent: numeric('discount_limit_percent', {
      precision: 5,
      scale: 2,
      mode: 'number',
    }),
    defaultCommissionPercent: numeric('default_commission_percent', {
      precision: 5,
      scale: 2,
      mode: 'number',
    })
      .notNull()
      .default(0),
    tracksStock: boolean('tracks_stock').notNull().default(false),
    tracksLots: boolean('tracks_lots').notNull().default(false),
    minStock: numeric('min_stock', { precision: 14, scale: 3, mode: 'number' }),
    idealStock: numeric('ideal_stock', { precision: 14, scale: 3, mode: 'number' }),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('products_org_code_uq').on(t.organizationId, t.code),
    uniqueIndex('products_org_barcode_uq')
      .on(t.organizationId, t.barcode)
      .where(sql`${t.barcode} is not null`),
    index('products_org_name_idx').on(t.organizationId, sql`lower(${t.name})`),
    check(
      'products_kind_ck',
      sql`(${t.kind} = 'product' and ${t.serviceKind} is null and ${t.municipalServiceCode} is null)
        or (${t.kind} = 'service' and ${t.serviceKind} is not null and ${t.ncm} is null
          and ${t.barcode} is null and not ${t.tracksStock})`,
    ),
    check(
      'products_values_ck',
      sql`${t.salePrice} >= 0 and (${t.cost} is null or ${t.cost} >= 0)
        and (${t.desiredMarkup} is null or ${t.desiredMarkup} >= 0)
        and (${t.discountLimitPercent} is null or ${t.discountLimitPercent} between 0 and 100)
        and ${t.defaultCommissionPercent} between 0 and 100
        and (${t.minStock} is null or ${t.minStock} >= 0)
        and (${t.idealStock} is null or ${t.idealStock} >= 0)
        and (not ${t.tracksLots} or ${t.tracksStock})`,
    ),
  ],
);

/** Comissão diferenciada por profissional; sem linha, vale a comissão padrão do item [p.16]. */
export const productCommissions = pgTable(
  'product_commissions',
  {
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    percent: numeric('percent', { precision: 5, scale: 2, mode: 'number' }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.productId, t.userId] }),
    check('product_commissions_percent_ck', sql`${t.percent} between 0 and 100`),
  ],
);

const money = (name: string) => numeric(name, { precision: 14, scale: 2, mode: 'number' });

/**
 * Venda e orçamento na mesma tabela, com status [RN-23]. Totais gravados são sempre os que o
 * servidor calculou [RN-28]; o código é sequencial por organização.
 */
export const sales = pgTable(
  'sales',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    unitId: uuid('unit_id')
      .notNull()
      .references(() => units.id),
    costCenterId: uuid('cost_center_id').references(() => costCenters.id),
    code: integer('code').notNull(),
    status: text('status', { enum: ['quote', 'open', 'closed', 'cancelled'] }).notNull(),
    saleType: text('sale_type').notNull(),
    clientId: uuid('client_id').references(() => clients.id),
    patientId: uuid('patient_id').references(() => patients.id),
    discountMode: text('discount_mode', { enum: ['amount', 'percent'] }).notNull(),
    discountValue: money('discount_value').notNull().default(0),
    grossTotal: money('gross_total').notNull(),
    discountTotal: money('discount_total').notNull(),
    netTotal: money('net_total').notNull(),
    notes: text('notes').notNull().default(''),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    /** Quando virou venda (lançada como venda ou orçamento convertido); nulo no orçamento. */
    soldAt: timestamp('sold_at', { withTimezone: true }),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    closedBy: uuid('closed_by').references(() => users.id),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancelledBy: uuid('cancelled_by').references(() => users.id),
    cancelReason: text('cancel_reason'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('sales_org_code_uq').on(t.organizationId, t.code),
    index('sales_org_created_idx').on(t.organizationId, t.createdAt),
    index('sales_unit_sold_idx').on(t.unitId, t.soldAt),
    index('sales_patient_idx').on(t.patientId),
    index('sales_client_idx').on(t.clientId),
    check('sales_patient_client_ck', sql`${t.patientId} is null or ${t.clientId} is not null`),
    check(
      'sales_totals_ck',
      sql`${t.grossTotal} >= 0 and ${t.discountTotal} >= 0 and ${t.discountTotal} <= ${t.grossTotal}
        and ${t.netTotal} = ${t.grossTotal} - ${t.discountTotal} and ${t.discountValue} >= 0`,
    ),
    check(
      'sales_closed_ck',
      // Baixada tem quem baixou; estornada (cancelada depois de baixada) guarda a baixa.
      sql`(${t.closedAt} is null) = (${t.closedBy} is null)
        and (${t.status} <> 'closed' or ${t.closedAt} is not null)
        and (${t.status} not in ('quote', 'open') or ${t.closedAt} is null)`,
    ),
    check(
      'sales_sold_ck',
      sql`(${t.status} <> 'quote' or ${t.soldAt} is null)
        and (${t.status} not in ('open', 'closed') or ${t.soldAt} is not null)`,
    ),
    check(
      'sales_cancel_ck',
      sql`(${t.status} = 'cancelled') = (${t.cancelledAt} is not null and ${t.cancelReason} is not null)`,
    ),
  ],
);

/**
 * Item da venda com profissional responsável [RN-24]. Nome, preço e comissão são copiados do
 * cadastro no momento da venda: mudar o produto depois não reescreve vendas passadas.
 */
export const saleItems = pgTable(
  'sale_items',
  {
    id: uuid('id').primaryKey(),
    saleId: uuid('sale_id')
      .notNull()
      .references(() => sales.id, { onDelete: 'cascade' }),
    position: smallint('position').notNull(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id),
    professionalId: uuid('professional_id')
      .notNull()
      .references(() => users.id),
    name: text('name').notNull(),
    kind: text('kind', { enum: ['product', 'service'] }).notNull(),
    serviceKind: text('service_kind'),
    unit: text('unit').notNull(),
    quantity: numeric('quantity', { precision: 14, scale: 3, mode: 'number' }).notNull(),
    listPrice: money('list_price').notNull(),
    unitPrice: money('unit_price').notNull(),
    grossTotal: money('gross_total').notNull(),
    discountAmount: money('discount_amount').notNull(),
    netTotal: money('net_total').notNull(),
    commissionPercent: numeric('commission_percent', {
      precision: 5,
      scale: 2,
      mode: 'number',
    }).notNull(),
    clinicalEventId: uuid('clinical_event_id').references(() => clinicalEvents.id),
  },
  (t) => [
    uniqueIndex('sale_items_sale_position_uq').on(t.saleId, t.position),
    // Um evento clínico lança no máximo um item: publicar de novo não duplica a cobrança.
    uniqueIndex('sale_items_clinical_event_uq')
      .on(t.clinicalEventId)
      .where(sql`${t.clinicalEventId} is not null`),
    index('sale_items_product_idx').on(t.productId),
    index('sale_items_professional_idx').on(t.professionalId),
    check(
      'sale_items_values_ck',
      sql`${t.quantity} > 0 and ${t.unitPrice} >= 0 and ${t.listPrice} >= 0
        and ${t.discountAmount} >= 0 and ${t.discountAmount} <= ${t.grossTotal}
        and ${t.netTotal} = ${t.grossTotal} - ${t.discountAmount}
        and ${t.commissionPercent} between 0 and 100`,
    ),
  ],
);

const quantity = (name: string) => numeric(name, { precision: 14, scale: 3, mode: 'number' });

/**
 * Saldo do produto por unidade [RN-31]. Nunca negativo: a saída sem saldo de grupo liberado vira
 * pendência, e só um dos dois é positivo por vez. A linha é travada (FOR UPDATE) em toda
 * reserva, baixa, estorno e ajuste, o que serializa vendas concorrentes do mesmo item.
 */
export const stockBalances = pgTable(
  'stock_balances',
  {
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    unitId: uuid('unit_id')
      .notNull()
      .references(() => units.id),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id),
    onHand: quantity('on_hand').notNull().default(0),
    shortfall: quantity('shortfall').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.unitId, t.productId] }),
    check(
      'stock_balances_ck',
      // Saldo e pendência convivem só com lote vencido, que fica fora do disponível.
      sql`${t.onHand} >= 0 and ${t.shortfall} >= 0`,
    ),
  ],
);

/**
 * Lote e validade por entrada [RN-32]. A soma dos lotes é o saldo do produto que controla lote;
 * a baixa tira primeiro do lote que vence antes.
 */
export const stockLots = pgTable(
  'stock_lots',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    unitId: uuid('unit_id')
      .notNull()
      .references(() => units.id),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id),
    code: text('code').notNull(),
    expiresOn: date('expires_on', { mode: 'string' }),
    onHand: quantity('on_hand').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('stock_lots_code_uq').on(t.unitId, t.productId, t.code),
    index('stock_lots_expiry_idx').on(t.unitId, t.productId, t.expiresOn),
    check('stock_lots_ck', sql`${t.onHand} >= 0`),
  ],
);

/** Entrada, contagem, venda e estorno: cada mudança de saldo, com o saldo resultante. */
export const stockMovements = pgTable(
  'stock_movements',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    unitId: uuid('unit_id')
      .notNull()
      .references(() => units.id),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id),
    kind: text('kind', {
      enum: [
        'entry',
        'count',
        'sale',
        'sale_return',
        'purchase',
        'purchase_cancel',
        'exit',
        'exit_cancel',
      ],
    }).notNull(),
    quantity: quantity('quantity').notNull(),
    shortfall: quantity('shortfall').notNull().default(0),
    onHandAfter: quantity('on_hand_after').notNull(),
    shortfallAfter: quantity('shortfall_after').notNull(),
    notes: text('notes').notNull().default(''),
    saleId: uuid('sale_id').references(() => sales.id),
    purchaseId: uuid('purchase_id').references((): AnyPgColumn => purchases.id),
    exitId: uuid('exit_id').references((): AnyPgColumn => stockExits.id),
    countId: uuid('count_id').references((): AnyPgColumn => stockCounts.id),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('stock_movements_product_idx').on(t.unitId, t.productId, t.createdAt),
    index('stock_movements_sale_idx').on(t.saleId),
    index('stock_movements_purchase_idx').on(t.purchaseId),
    index('stock_movements_exit_idx').on(t.exitId),
    index('stock_movements_count_idx').on(t.countId),
    check(
      'stock_movements_ck',
      sql`${t.onHandAfter} >= 0 and ${t.shortfall} >= 0 and ${t.shortfallAfter} >= 0
        and (${t.kind} not in ('sale', 'sale_return') or ${t.saleId} is not null)
        and (${t.kind} not in ('purchase', 'purchase_cancel') or ${t.purchaseId} is not null)
        and (${t.kind} not in ('exit', 'exit_cancel') or ${t.exitId} is not null)
        and (${t.kind} not in ('sale', 'purchase_cancel', 'exit') or ${t.quantity} < 0)
        and (${t.kind} not in ('entry', 'sale_return', 'purchase', 'exit_cancel') or ${t.quantity} > 0)`,
    ),
  ],
);

/** Quanto cada movimento tirou ou pôs em cada lote: é o rastreio do lote até a venda. */
export const stockMovementLots = pgTable(
  'stock_movement_lots',
  {
    movementId: uuid('movement_id')
      .notNull()
      .references(() => stockMovements.id),
    lotId: uuid('lot_id')
      .notNull()
      .references(() => stockLots.id),
    quantity: quantity('quantity').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.movementId, t.lotId] }),
    index('stock_movement_lots_lot_idx').on(t.lotId),
    check('stock_movement_lots_ck', sql`${t.quantity} <> 0`),
  ],
);

/** Parâmetros de venda da organização [p.10, Configuração]. */
export const salesSettings = pgTable(
  'sales_settings',
  {
    organizationId: uuid('organization_id')
      .primaryKey()
      .references(() => organizations.id),
    discountLimitPercent: numeric('discount_limit_percent', {
      precision: 5,
      scale: 2,
      mode: 'number',
    })
      .notNull()
      .default(10),
    defaultSaleType: text('default_sale_type').notNull().default('in_person_consumer'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check('sales_settings_discount_ck', sql`${t.discountLimitPercent} between 0 and 100`)],
);

/**
 * Forma de recebimento por adquirente e bandeira [RN-27, p.9], com prazo de liquidação,
 * parcelamento e taxa. Arquivada some do PDV, mas continua nos recebimentos já gravados.
 */
export const paymentMethods = pgTable(
  'payment_methods',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    name: text('name').notNull(),
    kind: text('kind', {
      enum: ['cash', 'pix', 'debit', 'credit', 'voucher', 'other'],
    }).notNull(),
    acquirer: text('acquirer').notNull().default(''),
    brand: text('brand').notNull().default(''),
    settlementDays: smallint('settlement_days').notNull().default(0),
    maxInstallments: smallint('max_installments').notNull().default(1),
    feePercent: numeric('fee_percent', { precision: 5, scale: 2, mode: 'number' })
      .notNull()
      .default(0),
    /** Conta financeira onde o dinheiro cai [RN-37]; nula usa a conta padrão do tipo. */
    accountId: uuid('account_id').references((): AnyPgColumn => financialAccounts.id),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('payment_methods_org_name_uq').on(t.organizationId, sql`lower(${t.name})`),
    check(
      'payment_methods_values_ck',
      sql`${t.settlementDays} between 0 and 365 and ${t.maxInstallments} between 1 and 24
        and ${t.feePercent} between 0 and 30
        and (${t.maxInstallments} = 1 or ${t.kind} in ('credit', 'voucher'))`,
    ),
  ],
);

/**
 * Forma usada para baixar a venda; uma venda aceita várias [RN-27]. Nome, tipo, prazo e taxa são
 * copiados da forma no momento do recebimento.
 */
export const salePayments = pgTable(
  'sale_payments',
  {
    id: uuid('id').primaryKey(),
    saleId: uuid('sale_id')
      .notNull()
      .references(() => sales.id),
    position: smallint('position').notNull(),
    paymentMethodId: uuid('payment_method_id')
      .notNull()
      .references(() => paymentMethods.id),
    methodName: text('method_name').notNull(),
    kind: text('kind').notNull(),
    amount: money('amount').notNull(),
    installments: smallint('installments').notNull(),
    settlementDays: smallint('settlement_days').notNull(),
    feePercent: numeric('fee_percent', { precision: 5, scale: 2, mode: 'number' }).notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull(),
    receivedBy: uuid('received_by')
      .notNull()
      .references(() => users.id),
    /** Caixa em que o recebimento entrou [RN-29]; nulo só nos recebimentos anteriores ao caixa. */
    cashSessionId: uuid('cash_session_id').references((): AnyPgColumn => cashSessions.id),
    /** Estornada junto com a venda; as parcelas deixam de valer. */
    reversedAt: timestamp('reversed_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('sale_payments_sale_position_uq').on(t.saleId, t.position),
    index('sale_payments_method_idx').on(t.paymentMethodId),
    index('sale_payments_cash_session_idx').on(t.cashSessionId),
    check(
      'sale_payments_values_ck',
      sql`${t.amount} > 0 and ${t.installments} between 1 and 24 and ${t.feePercent} between 0 and 30`,
    ),
  ],
);

/**
 * Parcela a receber de cada forma: valor, taxa e data prevista de liquidação. É a agenda de
 * recebíveis que a conciliação de cartões e o fluxo de caixa previsto usam (Fase 2).
 */
export const saleReceivables = pgTable(
  'sale_receivables',
  {
    id: uuid('id').primaryKey(),
    salePaymentId: uuid('sale_payment_id')
      .notNull()
      .references(() => salePayments.id),
    number: smallint('number').notNull(),
    dueDate: date('due_date').notNull(),
    amount: money('amount').notNull(),
    feeAmount: money('fee_amount').notNull(),
    netAmount: money('net_amount').notNull(),
  },
  (t) => [
    uniqueIndex('sale_receivables_payment_number_uq').on(t.salePaymentId, t.number),
    index('sale_receivables_due_idx').on(t.dueDate),
    check(
      'sale_receivables_values_ck',
      sql`${t.amount} > 0 and ${t.feeAmount} >= 0 and ${t.netAmount} = ${t.amount} - ${t.feeAmount}`,
    ),
  ],
);

/**
 * Caixa por operador, unidade e dia [RN-29, p.10]: abre com troco inicial, recebe vendas e fecha
 * com a contagem do dinheiro. Um operador tem no máximo um caixa aberto por unidade.
 */
export const cashSessions = pgTable(
  'cash_sessions',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    unitId: uuid('unit_id')
      .notNull()
      .references(() => units.id),
    code: integer('code').notNull(),
    operatorId: uuid('operator_id')
      .notNull()
      .references(() => users.id),
    status: text('status', { enum: ['open', 'closed'] }).notNull(),
    openedAt: timestamp('opened_at', { withTimezone: true }).notNull(),
    openingAmount: money('opening_amount').notNull(),
    openingNotes: text('opening_notes').notNull().default(''),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    closedBy: uuid('closed_by').references(() => users.id),
    expectedCash: money('expected_cash'),
    countedCash: money('counted_cash'),
    closingNotes: text('closing_notes').notNull().default(''),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('cash_sessions_org_code_uq').on(t.organizationId, t.code),
    uniqueIndex('cash_sessions_open_uq')
      .on(t.unitId, t.operatorId)
      .where(sql`${t.status} = 'open'`),
    index('cash_sessions_unit_opened_idx').on(t.unitId, t.openedAt),
    check('cash_sessions_opening_ck', sql`${t.openingAmount} >= 0`),
    check(
      'cash_sessions_closed_ck',
      sql`(${t.status} = 'closed') = (${t.closedAt} is not null and ${t.closedBy} is not null
        and ${t.expectedCash} is not null and ${t.countedCash} is not null)`,
    ),
    check('cash_sessions_counted_ck', sql`${t.countedCash} is null or ${t.countedCash} >= 0`),
  ],
);

/**
 * Movimento do caixa que não é recebimento: sangria, suprimento e estorno de venda baixada
 * (devolução na forma original). O valor é sempre positivo; o tipo diz se entra ou sai.
 */
export const cashMovements = pgTable(
  'cash_movements',
  {
    id: uuid('id').primaryKey(),
    cashSessionId: uuid('cash_session_id')
      .notNull()
      .references(() => cashSessions.id),
    kind: text('kind', { enum: ['supply', 'withdrawal', 'refund'] }).notNull(),
    amount: money('amount').notNull(),
    description: text('description').notNull(),
    methodName: text('method_name'),
    paymentKind: text('payment_kind'),
    saleId: uuid('sale_id').references(() => sales.id),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('cash_movements_session_idx').on(t.cashSessionId),
    check('cash_movements_amount_ck', sql`${t.amount} > 0`),
    check(
      'cash_movements_refund_ck',
      sql`(${t.kind} = 'refund') = (${t.saleId} is not null and ${t.paymentKind} is not null)`,
    ),
  ],
);

/** Montagem do painel de cada usuário [p.3]: ordem e widgets ligados, entre os liberados ao perfil. */
export const dashboardLayouts = pgTable('dashboard_layouts', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  organizationId: uuid('organization_id')
    .notNull()
    .references(() => organizations.id),
  widgets: jsonb('widgets').$type<{ id: string; visible: boolean }[]>().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

const examNumber = (name: string) => numeric(name, { precision: 14, scale: 4, mode: 'number' });

/** Exame do catálogo [RN-33]; o serviço, quando houver, é lançado na venda do animal [RN-19]. */
export const exams = pgTable(
  'exams',
  {
    ...catalogColumns,
    serviceId: uuid('service_id').references((): AnyPgColumn => products.id),
  },
  (t) => [uniqueIndex('exams_org_name_uq').on(t.organizationId, sql`lower(${t.name})`)],
);

/**
 * Linha do exame, na ordem de exibição: título de seção ou campo tipado. Campo já usado em
 * resultado não é apagado, só arquivado, para o histórico continuar apontando para ele.
 */
export const examAttributes = pgTable(
  'exam_attributes',
  {
    id: uuid('id').primaryKey(),
    examId: uuid('exam_id')
      .notNull()
      .references(() => exams.id, { onDelete: 'cascade' }),
    position: smallint('position').notNull(),
    kind: text('kind', { enum: ['section', 'field'] }).notNull(),
    name: text('name').notNull(),
    unit: text('unit').notNull().default(''),
    dataType: text('data_type', { enum: ['decimal', 'integer', 'text'] }),
    decimals: smallint('decimals'),
    maxLength: smallint('max_length'),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
  },
  (t) => [
    index('exam_attributes_exam_idx').on(t.examId, t.position),
    check(
      'exam_attributes_type_ck',
      sql`(${t.kind} = 'section' and ${t.dataType} is null)
        or (${t.kind} = 'field' and ${t.dataType} is not null
          and (${t.dataType} <> 'decimal' or ${t.decimals} between 0 and 4)
          and (${t.dataType} <> 'text' or ${t.maxLength} between 1 and 200))`,
    ),
  ],
);

/** Faixa etária (meses, inclusiva) de uma espécie na tabela de referência do exame. */
export const examReferences = pgTable(
  'exam_references',
  {
    id: uuid('id').primaryKey(),
    examId: uuid('exam_id')
      .notNull()
      .references(() => exams.id, { onDelete: 'cascade' }),
    speciesId: uuid('species_id')
      .notNull()
      .references(() => species.id),
    label: text('label').notNull(),
    minMonths: integer('min_months').notNull(),
    maxMonths: integer('max_months').notNull(),
  },
  (t) => [
    index('exam_references_exam_idx').on(t.examId, t.speciesId),
    check(
      'exam_references_months_ck',
      sql`${t.minMonths} >= 0 and ${t.maxMonths} >= ${t.minMonths} and ${t.maxMonths} <= 9999`,
    ),
  ],
);

export const examReferenceRanges = pgTable(
  'exam_reference_ranges',
  {
    referenceId: uuid('reference_id')
      .notNull()
      .references(() => examReferences.id, { onDelete: 'cascade' }),
    attributeId: uuid('attribute_id')
      .notNull()
      .references(() => examAttributes.id, { onDelete: 'cascade' }),
    low: examNumber('low'),
    high: examNumber('high'),
  },
  (t) => [
    primaryKey({ columns: [t.referenceId, t.attributeId] }),
    check(
      'exam_reference_ranges_ck',
      sql`(${t.low} is not null or ${t.high} is not null)
        and (${t.low} is null or ${t.high} is null or ${t.low} <= ${t.high})`,
    ),
  ],
);

/** Resultado de exame lançado na ficha: um por evento clínico do tipo exame. */
export const clinicalExamResults = pgTable('clinical_exam_results', {
  eventId: uuid('event_id')
    .primaryKey()
    .references(() => clinicalEvents.id, { onDelete: 'cascade' }),
  examId: uuid('exam_id')
    .notNull()
    .references(() => exams.id),
  referenceLabel: text('reference_label'),
});

/**
 * Valor de cada campo do resultado, com nome, unidade e faixa copiados ao registrar: mudar o
 * cadastro ou a referência depois não reescreve resultado antigo. Numérico em coluna própria
 * para a evolução do parâmetro [p.14].
 */
export const clinicalExamValues = pgTable(
  'clinical_exam_values',
  {
    eventId: uuid('event_id')
      .notNull()
      .references(() => clinicalExamResults.eventId, { onDelete: 'cascade' }),
    attributeId: uuid('attribute_id')
      .notNull()
      .references(() => examAttributes.id),
    position: smallint('position').notNull(),
    section: text('section'),
    name: text('name').notNull(),
    unit: text('unit').notNull(),
    dataType: text('data_type', { enum: ['decimal', 'integer', 'text'] }).notNull(),
    numericValue: examNumber('numeric_value'),
    textValue: text('text_value'),
    low: examNumber('low'),
    high: examNumber('high'),
    flag: text('flag', { enum: ['low', 'normal', 'high'] }),
  },
  (t) => [
    primaryKey({ columns: [t.eventId, t.attributeId] }),
    index('clinical_exam_values_attribute_idx').on(t.attributeId),
    check(
      'clinical_exam_values_ck',
      sql`(${t.dataType} = 'text' and ${t.textValue} is not null and ${t.numericValue} is null
          and ${t.flag} is null)
        or (${t.dataType} <> 'text' and ${t.numericValue} is not null and ${t.textValue} is null)`,
    ),
  ],
);

/**
 * Vacina, vermífugo ou antiparasitário do cadastro [RN-20]: a série inicial e o reforço definem
 * a próxima dose sugerida na aplicação.
 */
export const vaccines = pgTable(
  'vaccines',
  {
    ...catalogColumns,
    kind: text('kind', { enum: ['vaccine', 'dewormer', 'antiparasitic'] }).notNull(),
    primaryDoses: smallint('primary_doses').notNull(),
    primaryIntervalDays: smallint('primary_interval_days'),
    boosterIntervalDays: smallint('booster_interval_days'),
    serviceId: uuid('service_id').references((): AnyPgColumn => products.id),
  },
  (t) => [
    uniqueIndex('vaccines_org_name_uq').on(t.organizationId, sql`lower(${t.name})`),
    check(
      'vaccines_doses_ck',
      sql`${t.primaryDoses} between 1 and 6
        and (${t.primaryDoses} = 1 or ${t.primaryIntervalDays} is not null)
        and (${t.primaryIntervalDays} is null or ${t.primaryIntervalDays} between 1 and 1095)
        and (${t.boosterIntervalDays} is null or ${t.boosterIntervalDays} between 1 and 1095)`,
    ),
  ],
);

/** Aplicação registrada na ficha: um por evento clínico do tipo vacina. */
export const clinicalVaccinations = pgTable(
  'clinical_vaccinations',
  {
    eventId: uuid('event_id')
      .primaryKey()
      .references(() => clinicalEvents.id, { onDelete: 'cascade' }),
    patientId: uuid('patient_id')
      .notNull()
      .references(() => patients.id),
    vaccineId: uuid('vaccine_id')
      .notNull()
      .references(() => vaccines.id),
    doseNumber: smallint('dose_number').notNull(),
    /** "2ª dose" ou "Reforço", pela série do cadastro no dia da aplicação. */
    doseLabel: text('dose_label').notNull(),
    lotNumber: text('lot_number').notNull().default(''),
    nextDueOn: date('next_due_on', { mode: 'string' }),
  },
  (t) => [
    index('clinical_vaccinations_patient_idx').on(t.patientId, t.vaccineId),
    index('clinical_vaccinations_due_idx').on(t.nextDueOn),
    check('clinical_vaccinations_dose_ck', sql`${t.doseNumber} between 1 and 50`),
  ],
);

/**
 * Protocolo encerrado pelo veterinário (animal não volta, troca de vacina). Uma aplicação
 * posterior ao encerramento reabre o protocolo.
 */
export const vaccineProtocolClosures = pgTable(
  'vaccine_protocol_closures',
  {
    patientId: uuid('patient_id')
      .notNull()
      .references(() => patients.id),
    vaccineId: uuid('vaccine_id')
      .notNull()
      .references(() => vaccines.id),
    closedAt: timestamp('closed_at', { withTimezone: true }).notNull(),
    closedBy: uuid('closed_by')
      .notNull()
      .references(() => users.id),
    reason: text('reason').notNull(),
  },
  (t) => [primaryKey({ columns: [t.patientId, t.vaccineId] })],
);

/**
 * Mensagem automática por gatilho [RN-34]: ligada por padrão. A linha nasce na primeira leitura
 * da configuração; `active_since` impede que boas-vindas e resultados anteriores gerem mensagem.
 */
export const messageSettings = pgTable(
  'message_settings',
  {
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    trigger: text('trigger', {
      enum: [
        'vaccine_reminder',
        'appointment_reminder',
        'exam_result',
        'welcome_client',
        'welcome_patient',
        'patient_birthday',
        'client_birthday',
      ],
    }).notNull(),
    enabled: boolean('enabled').notNull().default(true),
    offset: smallint('offset'),
    template: text('template').notNull(),
    providerTemplate: text('provider_template').notNull().default(''),
    activeSince: timestamp('active_since', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid('updated_by').references(() => users.id),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.organizationId, t.trigger] })],
);

/**
 * Fila e histórico de mensagens. `dedupe_key` garante uma mensagem por fato (a dose de um
 * protocolo, um agendamento, um aniversário por ano), mesmo com a geração rodando várias vezes.
 */
export const messages = pgTable(
  'messages',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    trigger: text('trigger', {
      enum: [
        'vaccine_reminder',
        'appointment_reminder',
        'exam_result',
        'welcome_client',
        'welcome_patient',
        'patient_birthday',
        'client_birthday',
      ],
    }).notNull(),
    dedupeKey: text('dedupe_key').notNull(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    patientId: uuid('patient_id').references(() => patients.id, { onDelete: 'cascade' }),
    phone: text('phone'),
    body: text('body').notNull(),
    /** Valores das variáveis na ordem do texto: parâmetros do modelo aprovado na Meta. */
    params: text('params')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    status: text('status', {
      enum: ['pending', 'sent', 'failed', 'skipped', 'cancelled'],
    }).notNull(),
    skipReason: text('skip_reason', { enum: ['no_phone', 'no_consent'] }),
    channel: text('channel', { enum: ['api', 'manual'] }),
    attempts: smallint('attempts').notNull().default(0),
    lastError: text('last_error'),
    providerMessageId: text('provider_message_id'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    sentBy: uuid('sent_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('messages_org_dedupe_uq').on(t.organizationId, t.dedupeKey),
    index('messages_org_status_idx').on(t.organizationId, t.status, t.createdAt),
    check(
      'messages_status_ck',
      sql`(${t.status} = 'skipped') = (${t.skipReason} is not null)
        and (${t.status} = 'sent') = (${t.sentAt} is not null and ${t.channel} is not null)`,
    ),
  ],
);

/**
 * Conta financeira [p.18]: banco, dinheiro ou outra. O saldo é o inicial mais os lançamentos
 * pagos; nunca é gravado, para não divergir dos lançamentos.
 */
export const financialAccounts = pgTable(
  'financial_accounts',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    name: text('name').notNull(),
    kind: text('kind', { enum: ['bank', 'cash', 'other'] }).notNull(),
    openingBalance: money('opening_balance').notNull().default(0),
    openingDate: date('opening_date').notNull(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('financial_accounts_org_name_uq').on(t.organizationId, sql`lower(${t.name})`),
  ],
);

/**
 * Plano de contas [p.18]: receitas e despesas com um nível de subcategoria. As categorias com
 * `system_key` são usadas pelos lançamentos automáticos das vendas.
 */
export const financialCategories = pgTable(
  'financial_categories',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    name: text('name').notNull(),
    kind: text('kind', { enum: ['income', 'expense'] }).notNull(),
    parentId: uuid('parent_id').references((): AnyPgColumn => financialCategories.id),
    systemKey: text('system_key', { enum: ['sales', 'card_fees'] }),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('financial_categories_org_name_uq').on(
      t.organizationId,
      t.kind,
      sql`coalesce(${t.parentId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
      sql`lower(${t.name})`,
    ),
    uniqueIndex('financial_categories_org_system_uq')
      .on(t.organizationId, t.systemKey)
      .where(sql`${t.systemKey} is not null`),
    index('financial_categories_parent_idx').on(t.parentId),
  ],
);

export const suppliers = pgTable(
  'suppliers',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    name: text('name').notNull(),
    document: text('document').notNull().default(''),
    phone: text('phone').notNull().default(''),
    email: text('email').notNull().default(''),
    notes: text('notes').notNull().default(''),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('suppliers_org_name_uq').on(t.organizationId, sql`lower(${t.name})`),
    uniqueIndex('suppliers_org_document_uq')
      .on(t.organizationId, t.document)
      .where(sql`${t.document} <> ''`),
  ],
);

/**
 * Lançamento financeiro [p.18–19, RN-35]: receita, despesa ou uma das pontas de uma
 * transferência. Valor sempre positivo; `direction` diz se entra ou sai da conta. Parcelas e
 * repetições compartilham `group_id`; as duas pontas da transferência, `transfer_id`.
 */
export const financialEntries = pgTable(
  'financial_entries',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    unitId: uuid('unit_id')
      .notNull()
      .references(() => units.id),
    kind: text('kind', { enum: ['income', 'expense', 'transfer'] }).notNull(),
    direction: text('direction', { enum: ['in', 'out'] }).notNull(),
    origin: text('origin', {
      enum: ['manual', 'sale', 'card_fee', 'card_adjustment', 'transfer', 'purchase'],
    }).notNull(),
    status: text('status', { enum: ['open', 'paid', 'cancelled'] }).notNull(),
    description: text('description').notNull(),
    document: text('document').notNull().default(''),
    accountId: uuid('account_id')
      .notNull()
      .references(() => financialAccounts.id),
    categoryId: uuid('category_id').references(() => financialCategories.id),
    supplierId: uuid('supplier_id').references(() => suppliers.id),
    clientId: uuid('client_id').references(() => clients.id),
    costCenterId: uuid('cost_center_id').references(() => costCenters.id),
    saleId: uuid('sale_id').references(() => sales.id),
    saleReceivableId: uuid('sale_receivable_id').references(() => saleReceivables.id),
    transferId: uuid('transfer_id'),
    cardSettlementId: uuid('card_settlement_id').references((): AnyPgColumn => cardSettlements.id),
    purchaseId: uuid('purchase_id').references((): AnyPgColumn => purchases.id),
    groupId: uuid('group_id'),
    installmentNumber: smallint('installment_number'),
    installmentTotal: smallint('installment_total'),
    amount: money('amount').notNull(),
    paidAmount: money('paid_amount'),
    dueDate: date('due_date').notNull(),
    competenceDate: date('competence_date').notNull(),
    paidOn: date('paid_on'),
    paidBy: uuid('paid_by').references(() => users.id),
    notes: text('notes').notNull().default(''),
    /** Cancelado depois de pago guarda a data e o valor pagos, como histórico. */
    cancelReason: text('cancel_reason'),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => users.id),
    ...timestamps,
  },
  (t) => [
    index('financial_entries_org_date_idx').on(
      t.organizationId,
      sql`coalesce(${t.paidOn}, ${t.dueDate})`,
    ),
    index('financial_entries_account_idx').on(t.accountId),
    index('financial_entries_open_idx')
      .on(t.organizationId, t.dueDate)
      .where(sql`${t.status} = 'open'`),
    index('financial_entries_sale_idx').on(t.saleId),
    index('financial_entries_group_idx').on(t.groupId),
    index('financial_entries_transfer_idx').on(t.transferId),
    index('financial_entries_settlement_idx').on(t.cardSettlementId),
    index('financial_entries_purchase_idx').on(t.purchaseId),
    uniqueIndex('financial_entries_receivable_uq')
      .on(t.saleReceivableId, t.origin)
      .where(sql`${t.saleReceivableId} is not null`),
    check(
      'financial_entries_values_ck',
      sql`${t.amount} > 0 and (${t.paidAmount} is null or ${t.paidAmount} > 0)`,
    ),
    check(
      'financial_entries_paid_ck',
      sql`(${t.status} <> 'paid' or (${t.paidOn} is not null and ${t.paidAmount} is not null))
        and (${t.status} <> 'open' or (${t.paidOn} is null and ${t.paidAmount} is null))`,
    ),
    check(
      'financial_entries_kind_ck',
      sql`(${t.kind} = 'transfer') = (${t.transferId} is not null)
        and (${t.kind} = 'transfer' or ${t.categoryId} is not null)
        and (${t.kind} <> 'income' or ${t.direction} = 'in')
        and (${t.kind} <> 'expense' or ${t.direction} = 'out')`,
    ),
    check(
      'financial_entries_installment_ck',
      sql`(${t.installmentNumber} is null) = (${t.installmentTotal} is null)
        and (${t.installmentNumber} is null or ${t.installmentNumber} between 1 and ${t.installmentTotal})`,
    ),
  ],
);

/**
 * Depósito de adquirente conciliado [p.18, RN-37]: as parcelas de cartão de uma forma, previstas
 * para o mesmo dia na mesma conta, confirmadas com a data e o valor que caíram. A diferença para
 * o líquido previsto vira um lançamento de ajuste.
 */
export const cardSettlements = pgTable(
  'card_settlements',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    paymentMethodId: uuid('payment_method_id')
      .notNull()
      .references(() => paymentMethods.id),
    accountId: uuid('account_id')
      .notNull()
      .references(() => financialAccounts.id),
    expectedDate: date('expected_date').notNull(),
    depositDate: date('deposit_date').notNull(),
    gross: money('gross').notNull(),
    fee: money('fee').notNull(),
    expectedNet: money('expected_net').notNull(),
    receivedNet: money('received_net').notNull(),
    adjustmentEntryId: uuid('adjustment_entry_id').references(
      (): AnyPgColumn => financialEntries.id,
    ),
    reconciledBy: uuid('reconciled_by')
      .notNull()
      .references(() => users.id),
    reconciledAt: timestamp('reconciled_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    index('card_settlements_org_date_idx').on(t.organizationId, t.expectedDate),
    check(
      'card_settlements_values_ck',
      sql`${t.gross} > 0 and ${t.fee} >= 0 and ${t.expectedNet} = ${t.gross} - ${t.fee}
        and ${t.receivedNet} > 0`,
    ),
  ],
);

/**
 * Compra por nota [p.17]: rascunho editável (digitado ou importado do XML da NF-e) que, ao ser
 * confirmado, dá entrada no estoque com lote e validade, atualiza o custo dos produtos e lança
 * as parcelas a pagar. Cancelar a compra confirmada desfaz a entrada e as parcelas em aberto.
 */
export const purchases = pgTable(
  'purchases',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    unitId: uuid('unit_id')
      .notNull()
      .references(() => units.id),
    code: integer('code').notNull(),
    status: text('status', { enum: ['draft', 'confirmed', 'cancelled'] }).notNull(),
    source: text('source', { enum: ['manual', 'xml'] }).notNull(),
    supplierId: uuid('supplier_id')
      .notNull()
      .references(() => suppliers.id),
    invoiceNumber: text('invoice_number').notNull().default(''),
    invoiceSeries: text('invoice_series').notNull().default(''),
    /** Chave de acesso da NF-e (44 dígitos), vazia na compra digitada sem nota eletrônica. */
    invoiceKey: text('invoice_key').notNull().default(''),
    issuedOn: date('issued_on'),
    enteredOn: date('entered_on').notNull(),
    freight: money('freight').notNull().default(0),
    /** Seguro, outras despesas e impostos fora do valor dos itens (IPI, ST). */
    otherCosts: money('other_costs').notNull().default(0),
    discount: money('discount').notNull().default(0),
    itemsTotal: money('items_total').notNull(),
    total: money('total').notNull(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => financialAccounts.id),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => financialCategories.id),
    notes: text('notes').notNull().default(''),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    confirmedBy: uuid('confirmed_by').references(() => users.id),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    cancelledBy: uuid('cancelled_by').references(() => users.id),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancelReason: text('cancel_reason'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('purchases_org_code_uq').on(t.organizationId, t.code),
    // A mesma nota não entra duas vezes; a compra cancelada libera a chave.
    uniqueIndex('purchases_org_key_uq')
      .on(t.organizationId, t.invoiceKey)
      .where(sql`${t.invoiceKey} <> '' and ${t.status} <> 'cancelled'`),
    index('purchases_org_date_idx').on(t.organizationId, t.enteredOn),
    check(
      'purchases_values_ck',
      sql`${t.freight} >= 0 and ${t.otherCosts} >= 0 and ${t.discount} >= 0
        and ${t.itemsTotal} >= 0 and ${t.total} >= 0
        and ${t.total} = ${t.itemsTotal} + ${t.freight} + ${t.otherCosts} - ${t.discount}`,
    ),
    check(
      'purchases_status_ck',
      sql`(${t.status} <> 'confirmed' or ${t.confirmedAt} is not null)
        and (${t.status} <> 'cancelled' or (${t.cancelledAt} is not null and ${t.cancelReason} is not null))`,
    ),
  ],
);

/** Item da nota: o produto da clínica (escolhido ou reconhecido) e o que veio do fornecedor. */
export const purchaseItems = pgTable(
  'purchase_items',
  {
    id: uuid('id').primaryKey(),
    purchaseId: uuid('purchase_id')
      .notNull()
      .references(() => purchases.id, { onDelete: 'cascade' }),
    position: smallint('position').notNull(),
    productId: uuid('product_id').references(() => products.id),
    /** Descrição, código, EAN e unidade como o fornecedor mandou. */
    description: text('description').notNull(),
    supplierCode: text('supplier_code').notNull().default(''),
    ean: text('ean').notNull().default(''),
    supplierUnit: text('supplier_unit').notNull().default(''),
    quantity: quantity('quantity').notNull(),
    /** Unidades do produto em cada unidade do fornecedor (ex. caixa com 10). */
    factor: quantity('factor').notNull().default(1),
    total: money('total').notNull(),
    lotCode: text('lot_code'),
    expiresOn: date('expires_on'),
  },
  (t) => [
    uniqueIndex('purchase_items_position_uq').on(t.purchaseId, t.position),
    index('purchase_items_product_idx').on(t.productId),
    check(
      'purchase_items_values_ck',
      sql`${t.quantity} > 0 and ${t.factor} > 0 and ${t.total} >= 0
        and (${t.lotCode} is null) = (${t.expiresOn} is null)`,
    ),
  ],
);

/** Parcelas a pagar previstas na compra (duplicatas da nota ou digitadas). */
export const purchaseInstallments = pgTable(
  'purchase_installments',
  {
    purchaseId: uuid('purchase_id')
      .notNull()
      .references(() => purchases.id, { onDelete: 'cascade' }),
    number: smallint('number').notNull(),
    dueDate: date('due_date').notNull(),
    amount: money('amount').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.purchaseId, t.number] }),
    check('purchase_installments_ck', sql`${t.amount} > 0`),
  ],
);

/**
 * O que a clínica aprendeu de cada fornecedor: o código do item na nota leva ao produto e ao
 * fator de conversão, para a próxima importação já vir casada.
 */
export const supplierProducts = pgTable(
  'supplier_products',
  {
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    supplierId: uuid('supplier_id')
      .notNull()
      .references(() => suppliers.id),
    supplierCode: text('supplier_code').notNull(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id),
    factor: quantity('factor').notNull().default(1),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.supplierId, t.supplierCode] })],
);

/**
 * Outra saída de estoque [p.17]: perda, quebra, vencimento, uso interno ou doação. Baixa na
 * hora, lote a lote, e guarda o custo do momento para medir quanto se perdeu; cancelar devolve.
 */
export const stockExits = pgTable(
  'stock_exits',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    unitId: uuid('unit_id')
      .notNull()
      .references(() => units.id),
    code: integer('code').notNull(),
    reason: text('reason', {
      enum: ['loss', 'breakage', 'expired', 'internal_use', 'donation', 'other'],
    }).notNull(),
    occurredOn: date('occurred_on').notNull(),
    notes: text('notes').notNull().default(''),
    totalCost: money('total_cost').notNull().default(0),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    cancelledBy: uuid('cancelled_by').references(() => users.id),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancelReason: text('cancel_reason'),
  },
  (t) => [
    uniqueIndex('stock_exits_org_code_uq').on(t.organizationId, t.code),
    index('stock_exits_unit_date_idx').on(t.unitId, t.occurredOn),
    check(
      'stock_exits_ck',
      sql`${t.totalCost} >= 0 and (${t.cancelledAt} is null) = (${t.cancelReason} is null)`,
    ),
  ],
);

export const stockExitItems = pgTable(
  'stock_exit_items',
  {
    id: uuid('id').primaryKey(),
    exitId: uuid('exit_id')
      .notNull()
      .references(() => stockExits.id, { onDelete: 'cascade' }),
    position: smallint('position').notNull(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id),
    lotId: uuid('lot_id').references(() => stockLots.id),
    quantity: quantity('quantity').notNull(),
    /** Custo do produto no momento da saída; nulo quando o produto não tinha custo. */
    unitCost: money('unit_cost'),
  },
  (t) => [
    uniqueIndex('stock_exit_items_position_uq').on(t.exitId, t.position),
    index('stock_exit_items_product_idx').on(t.productId),
    check('stock_exit_items_ck', sql`${t.quantity} > 0`),
  ],
);

/**
 * Inventário [p.17]: contagem física de vários produtos de uma vez. Enquanto aberto, guarda o
 * que foi contado; ao aplicar, cada linha contada vira o saldo (por lote quando controla lote).
 */
export const stockCounts = pgTable(
  'stock_counts',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    unitId: uuid('unit_id')
      .notNull()
      .references(() => units.id),
    code: integer('code').notNull(),
    status: text('status', { enum: ['open', 'applied', 'cancelled'] }).notNull(),
    groupId: uuid('group_id').references(() => productGroups.id),
    notes: text('notes').notNull().default(''),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    closedBy: uuid('closed_by').references(() => users.id),
    closedAt: timestamp('closed_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('stock_counts_org_code_uq').on(t.organizationId, t.code),
    index('stock_counts_unit_idx').on(t.unitId, t.status),
    check('stock_counts_ck', sql`(${t.status} = 'open') = (${t.closedAt} is null)`),
  ],
);

export const stockCountLines = pgTable(
  'stock_count_lines',
  {
    id: uuid('id').primaryKey(),
    countId: uuid('count_id')
      .notNull()
      .references(() => stockCounts.id, { onDelete: 'cascade' }),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id),
    lotId: uuid('lot_id').references(() => stockLots.id),
    /** Saldo do sistema quando o inventário foi aplicado (antes, mostra-se o saldo atual). */
    expected: quantity('expected'),
    counted: quantity('counted'),
  },
  (t) => [
    uniqueIndex('stock_count_lines_uq').on(
      t.countId,
      t.productId,
      sql`coalesce(${t.lotId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
    ),
    check('stock_count_lines_ck', sql`${t.counted} is null or ${t.counted} >= 0`),
  ],
);
