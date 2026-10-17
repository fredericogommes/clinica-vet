import {
  toMinutes,
  type PortalBook,
  type PortalBookingOptions,
  type PortalSlotQuery,
  type PortalSlots,
} from '@clinica/contracts';
import type {
  PortalAccount,
  PortalAccountList,
  PortalAccountStatus,
  PortalHome,
  PortalLinkInfo,
  PortalPatient,
  PortalSession,
  PortalSettings,
} from '@clinica/contracts';
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, notInArray } from 'drizzle-orm';
import { hashPassword } from '../../core/passwords.js';
import { actorOf } from '../../core/actor.js';
import { recordAudit } from '../../core/audit.js';
import { AppError, notFound } from '../../core/errors.js';
import { newId } from '../../core/ids.js';
import type { Database, Executor } from '../../db/client.js';
import { isUniqueViolation } from '../../db/errors.js';
import {
  appointmentPatients,
  appointments,
  appointmentTypes,
  breeds,
  clientContacts,
  clients,
  clinicalEvents,
  clinicalExamResults,
  clinicalExamValues,
  clinicalVaccinations,
  clinicalVitals,
  exams,
  organizations,
  patients,
  portalAccounts,
  portalSessions,
  portalSettings,
  species,
  units,
  users,
  vaccines,
} from '../../db/schema.js';
import type { AuthContext } from '../auth/sessions.js';
import type { AppointmentService } from '../scheduling/appointment-service.js';
import { addDays, instantToZoned, zonedToInstant } from '../../core/zoned-time.js';
import {
  hashToken,
  isPortalEnabled,
  portalClosed,
  randomToken,
  type PortalContext,
  type PortalSessionService,
} from './sessions.js';

/** Validade do link de convite e de recuperação de senha. */
const LINK_TTL_MS = 7 * 24 * 3_600_000;

const DEFAULT_SETTINGS: PortalSettings = {
  enabled: false,
  sections: {
    appointments: true,
    weight: true,
    vaccines: true,
    exams: false,
    prescriptions: false,
  },
  booking: { enabled: false, typeIds: [], leadHours: 2, windowDays: 30 },
};

type SettingsRow = typeof portalSettings.$inferSelect;
const settingsOf = (row: SettingsRow | undefined): PortalSettings =>
  row
    ? {
        enabled: row.enabled,
        sections: {
          appointments: row.showAppointments,
          weight: row.showWeight,
          vaccines: row.showVaccines,
          exams: row.showExams,
          prescriptions: row.showPrescriptions,
        },
        booking: {
          enabled: row.bookingEnabled,
          typeIds: row.bookingTypeIds,
          leadHours: row.bookingLeadHours,
          windowDays: row.bookingWindowDays,
        },
      }
    : DEFAULT_SETTINGS;

type AccountRow = typeof portalAccounts.$inferSelect;
function statusOf(row: AccountRow | undefined): PortalAccountStatus {
  if (!row) return 'none';
  if (!row.active) return 'blocked';
  return row.passwordHash ? 'active' : 'invited';
}

const invalidLink = () =>
  new AppError(
    'not_found',
    'Este link não vale mais. Peça à clínica um novo link de acesso ao portal.',
  );

/** Lado da equipe: configuração do portal e acesso de cada cliente. */
export class PortalAdminService {
  constructor(
    private readonly db: Database,
    private readonly webOrigin: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async settings(auth: AuthContext): Promise<PortalSettings> {
    return settingsOf(await this.settingsRow(this.db, auth.organizationId));
  }

  async updateSettings(auth: AuthContext, input: PortalSettings): Promise<PortalSettings> {
    return this.db.transaction(async (tx) => {
      const before = settingsOf(await this.settingsRow(tx, auth.organizationId));
      const values = {
        enabled: input.enabled,
        showAppointments: input.sections.appointments,
        showWeight: input.sections.weight,
        showVaccines: input.sections.vaccines,
        showExams: input.sections.exams,
        showPrescriptions: input.sections.prescriptions,
        bookingEnabled: input.booking.enabled,
        bookingTypeIds: input.booking.typeIds,
        bookingLeadHours: input.booking.leadHours,
        bookingWindowDays: input.booking.windowDays,
        updatedAt: this.now(),
      };
      if (input.booking.typeIds.length > 0) {
        const found = await tx
          .select({ id: appointmentTypes.id })
          .from(appointmentTypes)
          .where(
            and(
              inArray(appointmentTypes.id, input.booking.typeIds),
              eq(appointmentTypes.organizationId, auth.organizationId),
              isNull(appointmentTypes.archivedAt),
            ),
          );
        if (found.length !== new Set(input.booking.typeIds).size) {
          throw new AppError('validation_failed', 'Tipo de atendimento não encontrado.', [
            { path: 'booking.typeIds', message: 'Tipo de atendimento não encontrado ou arquivado' },
          ]);
        }
      }
      await tx
        .insert(portalSettings)
        .values({ organizationId: auth.organizationId, ...values })
        .onConflictDoUpdate({ target: portalSettings.organizationId, set: values });
      await recordAudit(tx, actorOf(auth), {
        entity: 'portal_settings',
        entityId: auth.organizationId,
        action: 'update',
        before,
        after: input,
      });
      return input;
    });
  }

  async accounts(auth: AuthContext): Promise<PortalAccountList> {
    const rows = await this.db
      .select({ a: portalAccounts, code: clients.code, name: clients.name })
      .from(portalAccounts)
      .innerJoin(clients, eq(clients.id, portalAccounts.clientId))
      .where(eq(portalAccounts.organizationId, auth.organizationId))
      .orderBy(asc(clients.name))
      .limit(1000);
    return {
      items: rows.map(({ a, code, name }) => ({
        client: { id: a.clientId, code, name },
        email: a.email,
        status: statusOf(a),
        invitedAt: a.invitedAt.toISOString(),
        lastLoginAt: a.lastLoginAt?.toISOString() ?? null,
      })),
    };
  }

  async account(
    auth: AuthContext,
    clientId: string,
    db: Executor = this.db,
  ): Promise<PortalAccount> {
    await this.assertClient(db, auth, clientId);
    const [row] = await db
      .select()
      .from(portalAccounts)
      .where(eq(portalAccounts.clientId, clientId));
    const contacts = await db
      .select({
        kind: clientContacts.kind,
        value: clientContacts.value,
        wa: clientContacts.isWhatsapp,
      })
      .from(clientContacts)
      .where(eq(clientContacts.clientId, clientId))
      .orderBy(asc(clientContacts.position));
    const linkValid =
      row?.linkExpiresAt && row.linkExpiresAt > this.now() ? row.linkExpiresAt : null;
    return {
      portalEnabled: await isPortalEnabled(db, auth.organizationId),
      status: statusOf(row),
      email: row?.email ?? null,
      invitedAt: row?.invitedAt.toISOString() ?? null,
      linkExpiresAt: linkValid?.toISOString() ?? null,
      activatedAt: row?.activatedAt?.toISOString() ?? null,
      lastLoginAt: row?.lastLoginAt?.toISOString() ?? null,
      suggestedEmail: contacts.find((c) => c.kind === 'email')?.value ?? null,
      whatsapp: contacts.find((c) => c.kind === 'mobile' && c.wa)?.value ?? null,
    };
  }

  /**
   * Convite (cliente sem acesso) ou recuperação de senha (cliente com acesso): gera um link novo,
   * que substitui o anterior. A senha atual continua valendo até o tutor criar a nova.
   */
  async invite(
    auth: AuthContext,
    clientId: string,
    email: string,
  ): Promise<{ account: PortalAccount; link: string; expiresAt: string }> {
    const token = randomToken();
    const expiresAt = new Date(this.now().getTime() + LINK_TTL_MS);
    try {
      return await this.db.transaction(async (tx) => {
        const client = await this.assertClient(tx, auth, clientId);
        if (client.archivedAt) {
          throw new AppError('conflict', 'Cliente arquivado não recebe acesso ao portal.');
        }
        const [existing] = await tx
          .select()
          .from(portalAccounts)
          .where(eq(portalAccounts.clientId, clientId))
          .for('update');
        if (existing && !existing.active) {
          throw new AppError(
            'conflict',
            'O acesso está bloqueado. Desbloqueie antes de enviar um link.',
          );
        }
        const id = existing?.id ?? newId();
        if (existing) {
          await tx
            .update(portalAccounts)
            .set({
              email,
              linkTokenHash: hashToken(token),
              linkExpiresAt: expiresAt,
              updatedAt: this.now(),
            })
            .where(eq(portalAccounts.id, id));
        } else {
          await tx.insert(portalAccounts).values({
            id,
            organizationId: auth.organizationId,
            clientId,
            email,
            linkTokenHash: hashToken(token),
            linkExpiresAt: expiresAt,
            invitedAt: this.now(),
            invitedBy: auth.userId,
          });
        }
        await recordAudit(tx, actorOf(auth), {
          entity: 'portal_account',
          entityId: id,
          action: existing?.passwordHash ? 'password_link' : 'invite',
          before: existing ? { email: existing.email } : undefined,
          after: { clientId, email, linkExpiresAt: expiresAt.toISOString() },
        });
        return {
          account: await this.account(auth, clientId, tx),
          link: `${this.webOrigin}/portal/acesso/${token}`,
          expiresAt: expiresAt.toISOString(),
        };
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new AppError('conflict', 'Este e-mail já é o login de outro cliente no portal.', [
          { path: 'email', message: 'E-mail já usado no portal' },
        ]);
      }
      throw error;
    }
  }

  /** Bloquear derruba as sessões abertas e invalida o link pendente. */
  async setBlocked(auth: AuthContext, clientId: string, blocked: boolean): Promise<PortalAccount> {
    return this.db.transaction(async (tx) => {
      await this.assertClient(tx, auth, clientId);
      const [row] = await tx
        .select()
        .from(portalAccounts)
        .where(eq(portalAccounts.clientId, clientId))
        .for('update');
      if (!row) throw notFound('Acesso ao portal');
      if (row.active === !blocked) return this.account(auth, clientId, tx);
      await tx
        .update(portalAccounts)
        .set({
          active: !blocked,
          ...(blocked ? { linkTokenHash: null, linkExpiresAt: null } : {}),
          updatedAt: this.now(),
        })
        .where(eq(portalAccounts.id, row.id));
      if (blocked) await tx.delete(portalSessions).where(eq(portalSessions.accountId, row.id));
      await recordAudit(tx, actorOf(auth), {
        entity: 'portal_account',
        entityId: row.id,
        action: blocked ? 'block' : 'unblock',
      });
      return this.account(auth, clientId, tx);
    });
  }

  private async settingsRow(db: Executor, organizationId: string) {
    const [row] = await db
      .select()
      .from(portalSettings)
      .where(eq(portalSettings.organizationId, organizationId));
    return row;
  }

  private async assertClient(db: Executor, auth: AuthContext, clientId: string) {
    const [client] = await db
      .select({ id: clients.id, archivedAt: clients.archivedAt })
      .from(clients)
      .where(and(eq(clients.id, clientId), eq(clients.organizationId, auth.organizationId)));
    if (!client) throw notFound('Cliente');
    return client;
  }
}

/** Lado do tutor: tudo filtrado pelo cliente da sessão e pelo que a clínica escolheu mostrar. */
export class PortalService {
  constructor(
    private readonly db: Database,
    private readonly sessions: PortalSessionService,
    private readonly appointmentService: AppointmentService,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async linkInfo(token: string): Promise<PortalLinkInfo> {
    const row = await this.linkAccount(this.db, token);
    return {
      clinic: row.clinic,
      clientName: row.clientName,
      email: row.email,
      firstAccess: row.passwordHash === null,
    };
  }

  /** Cria ou troca a senha pelo link; o link vale uma vez e a sessão já sai aberta. */
  async setPassword(token: string, password: string): Promise<string> {
    const passwordHash = await hashPassword(password);
    return this.db.transaction(async (tx) => {
      const row = await this.linkAccount(tx, token, true);
      if (!(await isPortalEnabled(tx, row.organizationId))) throw portalClosed();
      await tx.delete(portalSessions).where(eq(portalSessions.accountId, row.id));
      await tx
        .update(portalAccounts)
        .set({
          passwordHash,
          linkTokenHash: null,
          linkExpiresAt: null,
          activatedAt: row.activatedAt ?? this.now(),
          updatedAt: this.now(),
        })
        .where(eq(portalAccounts.id, row.id));
      await recordAudit(
        tx,
        { organizationId: row.organizationId, unitId: null, userId: null },
        {
          entity: 'portal_account',
          entityId: row.id,
          action: row.passwordHash === null ? 'activate' : 'password_reset',
        },
      );
      return this.sessions.start(tx, row.id);
    });
  }

  async session(ctx: PortalContext): Promise<PortalSession> {
    const [row] = await this.db
      .select({
        clinic: organizations.name,
        clientName: clients.name,
        email: portalAccounts.email,
      })
      .from(portalAccounts)
      .innerJoin(clients, eq(clients.id, portalAccounts.clientId))
      .innerJoin(organizations, eq(organizations.id, portalAccounts.organizationId))
      .where(eq(portalAccounts.id, ctx.accountId));
    if (!row) throw new AppError('unauthenticated', 'Entre no portal para continuar.');
    const settings = await this.settings(ctx);
    return {
      clinic: row.clinic,
      client: { name: row.clientName, email: row.email },
      timeZone: await this.timeZone(ctx),
      sections: settings.sections,
      booking: bookingOpen(settings),
      csrfToken: ctx.csrfToken,
    };
  }

  async home(ctx: PortalContext): Promise<PortalHome> {
    const settings = await this.settings(ctx);
    const list = await this.patientRows(ctx);
    // Quem agenda pelo portal sempre vê os próprios agendamentos.
    if (!settings.sections.appointments && !bookingOpen(settings)) {
      return { patients: list, appointments: null };
    }
    const rows = await this.db
      .select({
        id: appointments.id,
        startsAt: appointments.startsAt,
        status: appointments.status,
        origin: appointments.origin,
        type: appointmentTypes.name,
        professional: users.name,
        unit: units.name,
      })
      .from(appointments)
      .innerJoin(appointmentTypes, eq(appointmentTypes.id, appointments.typeId))
      .innerJoin(users, eq(users.id, appointments.professionalId))
      .innerJoin(units, eq(units.id, appointments.unitId))
      .where(
        and(
          eq(appointments.clientId, ctx.clientId),
          gte(appointments.endsAt, this.now()),
          notInArray(appointments.status, ['cancelled', 'no_show', 'ready']),
        ),
      )
      .orderBy(asc(appointments.startsAt))
      .limit(20);
    const names = rows.length
      ? await this.db
          .select({ appointmentId: appointmentPatients.appointmentId, name: patients.name })
          .from(appointmentPatients)
          .innerJoin(patients, eq(patients.id, appointmentPatients.patientId))
          .where(
            inArray(
              appointmentPatients.appointmentId,
              rows.map((r) => r.id),
            ),
          )
          .orderBy(asc(appointmentPatients.position))
      : [];
    return {
      patients: list,
      appointments: rows.map((r) => ({
        id: r.id,
        startsAt: r.startsAt.toISOString(),
        type: r.type,
        professional: r.professional,
        unit: r.unit,
        status: r.status,
        patients: names.filter((n) => n.appointmentId === r.id).map((n) => n.name),
        bookedOnline: r.origin === 'portal',
        cancellable:
          r.origin === 'portal' &&
          (r.status === 'scheduled' || r.status === 'confirmed') &&
          r.startsAt > this.earliest(settings),
      })),
    };
  }

  /** O que o tutor pode escolher para agendar: unidades, tipos liberados e os próprios animais. */
  async bookingOptions(ctx: PortalContext): Promise<PortalBookingOptions> {
    const settings = await this.bookingSettings(ctx);
    const unitRows = await this.db
      .select({ id: units.id, name: units.name, timeZone: units.timeZone })
      .from(units)
      .where(and(eq(units.organizationId, ctx.organizationId), isNull(units.archivedAt)))
      .orderBy(asc(units.name));
    const types = await this.db
      .select({
        id: appointmentTypes.id,
        name: appointmentTypes.name,
        durationMinutes: appointmentTypes.durationMinutes,
      })
      .from(appointmentTypes)
      .where(
        and(
          inArray(appointmentTypes.id, settings.booking.typeIds),
          eq(appointmentTypes.organizationId, ctx.organizationId),
          isNull(appointmentTypes.archivedAt),
        ),
      )
      .orderBy(asc(appointmentTypes.name));
    const timeZone = unitRows[0]?.timeZone ?? (await this.timeZone(ctx));
    const firstDate = instantToZoned(this.earliest(settings), timeZone).date;
    const today = instantToZoned(this.now(), timeZone).date;
    return {
      units: unitRows.map(({ id, name }) => ({ id, name })),
      types,
      patients: (await this.patientRows(ctx))
        .filter((p) => !p.deceased)
        .map(({ id, name }) => ({ id, name })),
      firstDate,
      lastDate: addDays(today, settings.booking.windowDays),
      leadHours: settings.booking.leadHours,
    };
  }

  async bookingSlots(ctx: PortalContext, query: PortalSlotQuery): Promise<PortalSlots> {
    const settings = await this.bookingSettings(ctx);
    const { type, timeZone } = await this.bookable(ctx, settings, query.unitId, query.typeId);
    if (
      query.date > addDays(instantToZoned(this.now(), timeZone).date, settings.booking.windowDays)
    ) {
      return [];
    }
    const slots = await this.appointmentService.openSlots(
      { organizationId: ctx.organizationId, unitId: query.unitId },
      { date: query.date, durationMinutes: type.durationMinutes },
      this.earliest(settings),
    );
    return slots.map(({ start, professionalId, professionalName }) => ({
      start,
      professionalId,
      professionalName,
    }));
  }

  async book(ctx: PortalContext, input: PortalBook): Promise<void> {
    const settings = await this.bookingSettings(ctx);
    const { type, timeZone } = await this.bookable(ctx, settings, input.unitId, input.typeId);
    const startsAt = zonedToInstant(input.date, toMinutes(input.start), timeZone);
    const lastDate = addDays(
      instantToZoned(this.now(), timeZone).date,
      settings.booking.windowDays,
    );
    if (startsAt <= this.earliest(settings) || input.date > lastDate) {
      throw new AppError('conflict', 'Este horário está fora do período aberto para agendamento.');
    }
    await this.appointmentService.bookFromPortal(
      { organizationId: ctx.organizationId, unitId: input.unitId },
      {
        clientId: ctx.clientId,
        patientIds: input.patientIds,
        typeId: input.typeId,
        professionalId: input.professionalId,
        date: input.date,
        start: input.start,
        durationMinutes: type.durationMinutes,
        notes: input.notes === '' ? null : input.notes,
      },
      ctx.accountId,
    );
  }

  async cancel(ctx: PortalContext, appointmentId: string): Promise<void> {
    const settings = await this.bookingSettings(ctx);
    await this.appointmentService.cancelFromPortal(
      ctx.organizationId,
      ctx.clientId,
      appointmentId,
      this.earliest(settings),
      ctx.accountId,
    );
  }

  /** Primeiro instante que o tutor pode marcar ou cancelar: agora mais a antecedência. */
  private earliest(settings: PortalSettings): Date {
    return new Date(this.now().getTime() + settings.booking.leadHours * 3_600_000);
  }

  private async bookingSettings(ctx: PortalContext): Promise<PortalSettings> {
    const settings = await this.settings(ctx);
    if (!bookingOpen(settings)) {
      throw new AppError('forbidden', 'A clínica não está recebendo agendamentos pelo portal.');
    }
    return settings;
  }

  private async bookable(
    ctx: PortalContext,
    settings: PortalSettings,
    unitId: string,
    typeId: string,
  ) {
    const [unit] = await this.db
      .select({ timeZone: units.timeZone })
      .from(units)
      .where(
        and(
          eq(units.id, unitId),
          eq(units.organizationId, ctx.organizationId),
          isNull(units.archivedAt),
        ),
      );
    if (!unit) throw notFound('Unidade');
    const [type] = settings.booking.typeIds.includes(typeId)
      ? await this.db
          .select({ durationMinutes: appointmentTypes.durationMinutes })
          .from(appointmentTypes)
          .where(
            and(
              eq(appointmentTypes.id, typeId),
              eq(appointmentTypes.organizationId, ctx.organizationId),
              isNull(appointmentTypes.archivedAt),
            ),
          )
      : [];
    if (!type) throw notFound('Tipo de atendimento');
    return { type, timeZone: unit.timeZone };
  }

  /** Ficha do animal no portal. Animal de outro cliente responde como inexistente. */
  async patient(ctx: PortalContext, patientId: string): Promise<PortalPatient> {
    const [patient] = (await this.patientRows(ctx)).filter((p) => p.id === patientId);
    if (!patient) throw notFound('Animal');
    const { sections } = await this.settings(ctx);
    const published = and(
      eq(clinicalEvents.patientId, patientId),
      eq(clinicalEvents.status, 'published'),
    );
    return {
      patient,
      weights: sections.weight ? await this.weights(published) : null,
      vaccines: sections.vaccines ? await this.vaccinations(published) : null,
      exams: sections.exams ? await this.exams(published) : null,
      prescriptions: sections.prescriptions ? await this.prescriptions(published) : null,
    };
  }

  private async weights(published: ReturnType<typeof and>): Promise<PortalPatient['weights']> {
    const rows = await this.db
      .select({
        eventId: clinicalEvents.id,
        occurredAt: clinicalEvents.occurredAt,
        weightKg: clinicalVitals.weightKg,
      })
      .from(clinicalVitals)
      .innerJoin(clinicalEvents, eq(clinicalEvents.id, clinicalVitals.eventId))
      .where(and(published, isNotNull(clinicalVitals.weightKg)))
      .orderBy(asc(clinicalEvents.occurredAt), asc(clinicalEvents.id))
      .limit(500);
    return rows.flatMap((r) =>
      r.weightKg === null
        ? []
        : [{ eventId: r.eventId, occurredAt: r.occurredAt.toISOString(), weightKg: r.weightKg }],
    );
  }

  private async vaccinations(
    published: ReturnType<typeof and>,
  ): Promise<PortalPatient['vaccines']> {
    const rows = await this.db
      .select({
        id: clinicalEvents.id,
        appliedAt: clinicalEvents.occurredAt,
        name: vaccines.name,
        kind: vaccines.kind,
        dose: clinicalVaccinations.doseLabel,
        nextDueOn: clinicalVaccinations.nextDueOn,
      })
      .from(clinicalVaccinations)
      .innerJoin(clinicalEvents, eq(clinicalEvents.id, clinicalVaccinations.eventId))
      .innerJoin(vaccines, eq(vaccines.id, clinicalVaccinations.vaccineId))
      .where(published)
      .orderBy(desc(clinicalEvents.occurredAt), desc(clinicalEvents.id))
      .limit(200);
    return rows.map((r) => ({ ...r, appliedAt: r.appliedAt.toISOString() }));
  }

  private async exams(published: ReturnType<typeof and>): Promise<PortalPatient['exams']> {
    const rows = await this.db
      .select({
        id: clinicalEvents.id,
        at: clinicalEvents.occurredAt,
        payload: clinicalEvents.payload,
        name: exams.name,
        referenceLabel: clinicalExamResults.referenceLabel,
      })
      .from(clinicalExamResults)
      .innerJoin(clinicalEvents, eq(clinicalEvents.id, clinicalExamResults.eventId))
      .innerJoin(exams, eq(exams.id, clinicalExamResults.examId))
      .where(published)
      .orderBy(desc(clinicalEvents.occurredAt), desc(clinicalEvents.id))
      .limit(100);
    if (rows.length === 0) return [];
    const values = await this.db
      .select()
      .from(clinicalExamValues)
      .where(
        inArray(
          clinicalExamValues.eventId,
          rows.map((r) => r.id),
        ),
      )
      .orderBy(asc(clinicalExamValues.position));
    return rows.map((r) => ({
      id: r.id,
      at: r.at.toISOString(),
      name: r.name,
      referenceLabel: r.referenceLabel,
      notes: textOf(r.payload, 'notes'),
      values: values
        .filter((v) => v.eventId === r.id)
        .map((v) => ({
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
    }));
  }

  private async prescriptions(
    published: ReturnType<typeof and>,
  ): Promise<PortalPatient['prescriptions']> {
    const rows = await this.db
      .select({
        id: clinicalEvents.id,
        at: clinicalEvents.occurredAt,
        payload: clinicalEvents.payload,
        professional: users.name,
      })
      .from(clinicalEvents)
      .innerJoin(users, eq(users.id, clinicalEvents.authorId))
      .where(and(published, eq(clinicalEvents.kind, 'prescription')))
      .orderBy(desc(clinicalEvents.occurredAt), desc(clinicalEvents.id))
      .limit(100);
    return rows.map((r) => ({
      id: r.id,
      at: r.at.toISOString(),
      title: textOf(r.payload, 'title'),
      body: textOf(r.payload, 'body'),
      professional: r.professional,
    }));
  }

  private async patientRows(ctx: PortalContext): Promise<PortalHome['patients']> {
    const rows = await this.db
      .select({
        id: patients.id,
        name: patients.name,
        species: species.name,
        breed: breeds.name,
        sex: patients.sex,
        birthDate: patients.birthDate,
        status: patients.status,
      })
      .from(patients)
      .leftJoin(species, eq(species.id, patients.speciesId))
      .leftJoin(breeds, eq(breeds.id, patients.breedId))
      .where(and(eq(patients.clientId, ctx.clientId), isNull(patients.archivedAt)))
      .orderBy(asc(patients.status), asc(patients.name));
    return rows.map(({ status, ...p }) => ({ ...p, deceased: status === 'deceased' }));
  }

  private async settings(ctx: PortalContext): Promise<PortalSettings> {
    const [row] = await this.db
      .select()
      .from(portalSettings)
      .where(eq(portalSettings.organizationId, ctx.organizationId));
    return settingsOf(row);
  }

  /** Fuso da primeira unidade ativa; a clínica com várias unidades costuma ter um fuso só. */
  private async timeZone(ctx: PortalContext): Promise<string> {
    const [unit] = await this.db
      .select({ timeZone: units.timeZone })
      .from(units)
      .where(and(eq(units.organizationId, ctx.organizationId), isNull(units.archivedAt)))
      .orderBy(asc(units.name))
      .limit(1);
    return unit?.timeZone ?? 'America/Sao_Paulo';
  }

  private async linkAccount(db: Executor, token: string, lock = false) {
    const query = db
      .select({
        id: portalAccounts.id,
        organizationId: portalAccounts.organizationId,
        email: portalAccounts.email,
        passwordHash: portalAccounts.passwordHash,
        activatedAt: portalAccounts.activatedAt,
        active: portalAccounts.active,
        linkExpiresAt: portalAccounts.linkExpiresAt,
        clientName: clients.name,
        clientArchivedAt: clients.archivedAt,
        clinic: organizations.name,
      })
      .from(portalAccounts)
      .innerJoin(clients, eq(clients.id, portalAccounts.clientId))
      .innerJoin(organizations, eq(organizations.id, portalAccounts.organizationId))
      .where(eq(portalAccounts.linkTokenHash, hashToken(token)));
    const [row] = lock ? await query.for('update', { of: portalAccounts }) : await query;
    if (
      !row?.linkExpiresAt ||
      row.linkExpiresAt <= this.now() ||
      !row.active ||
      row.clientArchivedAt
    ) {
      throw invalidLink();
    }
    return row;
  }
}

const bookingOpen = (s: PortalSettings) => s.booking.enabled && s.booking.typeIds.length > 0;

const textOf = (payload: unknown, key: string): string => {
  if (typeof payload !== 'object' || payload === null) return '';
  const value = (payload as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : '';
};
