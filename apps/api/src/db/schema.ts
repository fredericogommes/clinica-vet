import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
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
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [uniqueIndex('users_email_uq').on(sql`lower(${t.email})`)],
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

/** Tipos de atendimento [p.5]: alimentam a agenda e, depois, o modelo de prontuário. */
export const appointmentTypes = pgTable(
  'appointment_types',
  {
    ...catalogColumns,
    durationMinutes: integer('duration_minutes').notNull().default(60),
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
