import {
  defaultTemplates,
  messageTriggers,
  renderTemplate,
  templateVariables,
  triggerOffsets,
  type Message,
  type MessageList,
  type MessageRun,
  type MessageSetting,
  type MessageTrigger,
  type MessageVariable,
  type MessagingSettings,
  type SkipReason,
  type messageQuerySchema,
  type messageSettingInputSchema,
} from '@clinica/contracts';
import { and, asc, eq, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { actorOf } from '../../core/actor.js';
import { recordAudit } from '../../core/audit.js';
import { conflict, notFound } from '../../core/errors.js';
import { newId } from '../../core/ids.js';
import { instantToZoned, zonedToInstant } from '../../core/zoned-time.js';
import type { Database, Executor } from '../../db/client.js';
import { messageSettings, messages, organizations, units } from '../../db/schema.js';
import type { AuthContext } from '../auth/sessions.js';
import type { MessageSender } from './sender.js';

type SettingInput = z.output<typeof messageSettingInputSchema>;
type Query = z.output<typeof messageQuerySchema>;

/** Janela de envio automático, no fuso da clínica: ninguém recebe lembrete de madrugada. */
export const SEND_WINDOW = { from: 8 * 60, to: 20 * 60 } as const;
/** Mensagem que ninguém enviou em 3 dias perde o sentido e sai da fila. */
const EXPIRE_AFTER_MS = 3 * 86_400_000;
/** Cadastros e resultados mais antigos que isso não geram mensagem (evita rajada ao religar). */
const RECENT_MS = 2 * 86_400_000;
const MAX_ATTEMPTS = 3;

/** Um fato que pede mensagem: quem recebe e o valor de cada variável. */
interface Candidate {
  trigger: MessageTrigger;
  dedupeKey: string;
  clientId: string;
  patientId: string | null;
  values: Partial<Record<MessageVariable, string>>;
}

const brDate = (iso: string) => iso.split('-').reverse().join('/');
const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;
const toIso = (v: Date | string) => new Date(v).toISOString();

export class MessagingService {
  constructor(
    private readonly db: Database,
    private readonly sender: MessageSender,
    private readonly now: () => Date = () => new Date(),
  ) {}

  get delivery(): 'api' | 'manual' {
    return this.sender.configured ? 'api' : 'manual';
  }

  // Configuração ---------------------------------------------------------------------------------

  /** Gatilhos da clínica, criando os que faltam já ligados [RN-34]. */
  async settings(organizationId: string, db: Executor = this.db): Promise<MessageSetting[]> {
    await db
      .insert(messageSettings)
      .values(
        messageTriggers.map((trigger) => ({
          organizationId,
          trigger,
          offset: triggerOffsets[trigger]?.default ?? null,
          template: defaultTemplates[trigger],
        })),
      )
      .onConflictDoNothing();
    const rows = await db
      .select()
      .from(messageSettings)
      .where(eq(messageSettings.organizationId, organizationId));
    const order = (t: MessageTrigger) => messageTriggers.indexOf(t);
    return rows
      .sort((a, b) => order(a.trigger) - order(b.trigger))
      .map((r) => ({
        trigger: r.trigger,
        enabled: r.enabled,
        offset: r.offset,
        template: r.template,
        providerTemplate: r.providerTemplate,
        activeSince: r.activeSince.toISOString(),
      }));
  }

  async view(auth: AuthContext): Promise<MessagingSettings> {
    return { delivery: this.delivery, settings: await this.settings(auth.organizationId) };
  }

  async save(auth: AuthContext, input: SettingInput): Promise<MessagingSettings> {
    await this.db.transaction(async (tx) => {
      const before = (await this.settings(auth.organizationId, tx)).find(
        (s) => s.trigger === input.trigger,
      );
      if (!before) throw notFound('Mensagem automática');
      const turnedOn = input.enabled && !before.enabled;
      await tx
        .update(messageSettings)
        .set({
          enabled: input.enabled,
          offset: input.offset,
          template: input.template,
          providerTemplate: input.providerTemplate,
          // Religar não dispara mensagens para o que aconteceu enquanto estava desligado.
          ...(turnedOn ? { activeSince: this.now() } : {}),
          updatedBy: auth.userId,
          updatedAt: this.now(),
        })
        .where(
          and(
            eq(messageSettings.organizationId, auth.organizationId),
            eq(messageSettings.trigger, input.trigger),
          ),
        );
      await recordAudit(tx, actorOf(auth), {
        entity: 'message_setting',
        entityId: auth.organizationId,
        action: 'update',
        before,
        after: input,
      });
    });
    return this.view(auth);
  }

  // Fila -----------------------------------------------------------------------------------------

  async list(auth: AuthContext, query: Query): Promise<MessageList> {
    const timeZone = await this.orgTimeZone(auth.organizationId);
    const today = instantToZoned(this.now(), timeZone).date;
    const startOfDay = zonedToInstant(today, 0, timeZone);
    const statuses = {
      aguardando: ['pending'],
      enviadas: ['sent'],
      'nao-enviadas': ['failed', 'skipped', 'cancelled'],
      todas: ['pending', 'sent', 'failed', 'skipped', 'cancelled'],
    }[query.situacao];
    const where = sql`m.organization_id = ${auth.organizationId}
      and m.status in (${sql.join(
        statuses.map((s) => sql`${s}`),
        sql`, `,
      )})
      and (${query.tipo ?? null}::text is null or m.trigger = ${query.tipo ?? null}::text)`;
    // Aguardando: a mais antiga primeiro (é a ordem de envio); o resto, a mais recente primeiro.
    const order =
      query.situacao === 'aguardando'
        ? sql`m.created_at asc, m.id asc`
        : sql`coalesce(m.sent_at, m.created_at) desc, m.id desc`;
    const [counts] = (
      await this.db.execute<{
        total: number;
        pending: number;
        sent_today: number;
        not_sent: number;
      }>(
        sql`select
          (select count(*) from messages m where ${where})::int as total,
          count(*) filter (where status = 'pending')::int as pending,
          count(*) filter (where status = 'sent' and sent_at >= ${startOfDay.toISOString()}::timestamptz)::int as sent_today,
          count(*) filter (where status in ('failed', 'skipped'))::int as not_sent
        from messages where organization_id = ${auth.organizationId}`,
      )
    ).rows;
    const rows = (
      await this.db.execute<{
        id: string;
        trigger: MessageTrigger;
        status: Message['status'];
        client_id: string;
        client_name: string;
        patient_id: string | null;
        patient_name: string | null;
        phone: string | null;
        body: string;
        skip_reason: Message['skipReason'];
        channel: Message['channel'];
        sent_at: Date | string | null;
        sent_by: string | null;
        last_error: string | null;
        created_at: Date | string;
      }>(sql`
        select m.id, m.trigger, m.status, m.client_id, c.name as client_name, m.patient_id,
          p.name as patient_name, m.phone, m.body, m.skip_reason, m.channel, m.sent_at,
          u.name as sent_by, m.last_error, m.created_at
        from messages m
        join clients c on c.id = m.client_id
        left join patients p on p.id = m.patient_id
        left join users u on u.id = m.sent_by
        where ${where}
        order by ${order}
        limit ${query.pageSize} offset ${(query.page - 1) * query.pageSize}`)
    ).rows;
    return {
      items: rows.map((r) => ({
        id: r.id,
        trigger: r.trigger,
        status: r.status,
        client: { id: r.client_id, name: r.client_name },
        patient: r.patient_id ? { id: r.patient_id, name: r.patient_name ?? '' } : null,
        phone: r.phone,
        body: r.body,
        skipReason: r.skip_reason,
        channel: r.channel,
        sentAt: r.sent_at ? toIso(r.sent_at) : null,
        sentBy: r.sent_by,
        error: r.last_error,
        createdAt: toIso(r.created_at),
      })),
      total: counts?.total ?? 0,
      page: query.page,
      pageSize: query.pageSize,
      counts: {
        pending: counts?.pending ?? 0,
        sentToday: counts?.sent_today ?? 0,
        notSent: counts?.not_sent ?? 0,
      },
      delivery: this.delivery,
    };
  }

  /** Enviada pelo WhatsApp da recepção, a partir da fila. */
  async markSent(auth: AuthContext, id: string): Promise<void> {
    await this.transition(auth, id, 'send', async (tx) => {
      await tx
        .update(messages)
        .set({ status: 'sent', channel: 'manual', sentAt: this.now(), sentBy: auth.userId })
        .where(eq(messages.id, id));
    });
  }

  async cancel(auth: AuthContext, id: string): Promise<void> {
    await this.transition(auth, id, 'cancel', async (tx) => {
      await tx.update(messages).set({ status: 'cancelled' }).where(eq(messages.id, id));
    });
  }

  private async transition(
    auth: AuthContext,
    id: string,
    action: 'send' | 'cancel',
    apply: (tx: Executor) => Promise<void>,
  ) {
    await this.db.transaction(async (tx) => {
      const [row] = await tx
        .select({ status: messages.status, phone: messages.phone })
        .from(messages)
        .where(and(eq(messages.id, id), eq(messages.organizationId, auth.organizationId)))
        .for('update');
      if (!row) throw notFound('Mensagem');
      if (row.status !== 'pending' && row.status !== 'failed') {
        throw conflict('Esta mensagem já saiu da fila.');
      }
      if (action === 'send' && !row.phone) throw conflict('O cliente não tem celular.');
      await apply(tx);
      await recordAudit(tx, actorOf(auth), {
        entity: 'message',
        entityId: id,
        action,
        before: { status: row.status },
      });
    });
  }

  // Geração e envio ------------------------------------------------------------------------------

  /** Rodada de todas as clínicas; chamada pelo agendador do servidor. */
  async runAll(): Promise<MessageRun> {
    const orgs = await this.db.select({ id: organizations.id }).from(organizations);
    const total = { created: 0, sent: 0 };
    for (const org of orgs) {
      const r = await this.run(org.id);
      total.created += r.created;
      total.sent += r.sent;
    }
    return total;
  }

  /** Gera as mensagens devidas, tira da fila as que perderam o sentido e envia pela API. */
  async run(organizationId: string): Promise<MessageRun> {
    const timeZone = await this.orgTimeZone(organizationId);
    const settings = await this.settings(organizationId);
    const [org] = await this.db
      .select({ name: organizations.name })
      .from(organizations)
      .where(eq(organizations.id, organizationId));
    const clinic = org?.name ?? '';
    let created = 0;
    for (const setting of settings) {
      if (!setting.enabled) continue;
      const candidates = await this.candidates(organizationId, setting, timeZone);
      created += await this.enqueue(organizationId, setting, candidates, clinic);
    }
    await this.expire(organizationId);
    const sent = await this.dispatch(organizationId, settings, timeZone);
    return { created, sent };
  }

  private async candidates(
    organizationId: string,
    setting: MessageSetting,
    timeZone: string,
  ): Promise<Candidate[]> {
    const now = this.now();
    const today = instantToZoned(now, timeZone).date;
    const since = new Date(
      Math.max(Date.parse(setting.activeSince), now.getTime() - RECENT_MS),
    ).toISOString();
    const trigger = setting.trigger;
    const rows = async <T extends Record<string, unknown>>(query: ReturnType<typeof sql>) =>
      (await this.db.execute<T>(query)).rows;

    switch (trigger) {
      case 'vaccine_reminder': {
        const until = instantToZoned(
          new Date(now.getTime() + (setting.offset ?? 0) * 86_400_000),
          timeZone,
        ).date;
        const list = await rows<{
          patient_id: string;
          patient_name: string;
          client_id: string;
          client_name: string;
          vaccine_id: string;
          vaccine_name: string;
          next_due_on: string;
        }>(sql`
          with latest as (
            select distinct on (cv.patient_id, cv.vaccine_id)
              cv.patient_id, cv.vaccine_id, cv.next_due_on
            from clinical_vaccinations cv
            join clinical_events e on e.id = cv.event_id and e.status = 'published'
            where e.organization_id = ${organizationId}
            order by cv.patient_id, cv.vaccine_id, e.occurred_at desc, e.id desc
          )
          select l.patient_id, p.name as patient_name, c.id as client_id, c.name as client_name,
            l.vaccine_id, v.name as vaccine_name, l.next_due_on::text as next_due_on
          from latest l
          join patients p on p.id = l.patient_id
          join clients c on c.id = p.client_id
          join vaccines v on v.id = l.vaccine_id
          where l.next_due_on between ${today}::date and ${until}::date
            and p.status = 'alive' and p.archived_at is null and c.archived_at is null
            and not exists (select 1 from vaccine_protocol_closures pc
              where pc.patient_id = l.patient_id and pc.vaccine_id = l.vaccine_id)`);
        return list.map((r) => ({
          trigger,
          dedupeKey: `vaccine:${r.patient_id}:${r.vaccine_id}:${r.next_due_on}`,
          clientId: r.client_id,
          patientId: r.patient_id,
          values: {
            cliente: firstName(r.client_name),
            animal: r.patient_name,
            vacina: r.vaccine_name,
            data: brDate(r.next_due_on),
          },
        }));
      }
      case 'appointment_reminder': {
        const until = new Date(now.getTime() + (setting.offset ?? 24) * 3_600_000);
        const list = await rows<{
          id: string;
          starts_at: Date | string;
          time_zone: string;
          client_id: string;
          client_name: string;
          professional: string;
          patient_id: string | null;
          patients: string | null;
        }>(sql`
          select a.id, a.starts_at, u2.time_zone, c.id as client_id, c.name as client_name,
            u.name as professional,
            (select ap.patient_id from appointment_patients ap
              where ap.appointment_id = a.id order by ap.position limit 1) as patient_id,
            (select string_agg(p.name, ' e ' order by ap.position) from appointment_patients ap
              join patients p on p.id = ap.patient_id where ap.appointment_id = a.id) as patients
          from appointments a
          join clients c on c.id = a.client_id
          join users u on u.id = a.professional_id
          join units u2 on u2.id = a.unit_id
          where a.organization_id = ${organizationId}
            and a.status in ('scheduled', 'confirmed')
            and a.starts_at > ${now.toISOString()}::timestamptz
            and a.starts_at <= ${until.toISOString()}::timestamptz
            and c.archived_at is null`);
        return list.map((r) => {
          const at = instantToZoned(new Date(r.starts_at), r.time_zone);
          const hh = String(Math.floor(at.minutes / 60)).padStart(2, '0');
          const mm = String(at.minutes % 60).padStart(2, '0');
          return {
            trigger,
            // Remarcar muda o horário e gera um lembrete novo.
            dedupeKey: `appointment:${r.id}:${toIso(r.starts_at)}`,
            clientId: r.client_id,
            patientId: r.patient_id,
            values: {
              cliente: firstName(r.client_name),
              animal: r.patients ?? '',
              data: brDate(at.date),
              hora: `${hh}:${mm}`,
              profissional: r.professional,
            },
          };
        });
      }
      case 'exam_result': {
        const list = await rows<{
          event_id: string;
          patient_id: string;
          patient_name: string;
          client_id: string;
          client_name: string;
          exam_name: string;
        }>(sql`
          select e.id as event_id, p.id as patient_id, p.name as patient_name,
            c.id as client_id, c.name as client_name, x.name as exam_name
          from clinical_events e
          join clinical_exam_results r on r.event_id = e.id
          join exams x on x.id = r.exam_id
          join patients p on p.id = e.patient_id
          join clients c on c.id = p.client_id
          where e.organization_id = ${organizationId} and e.kind = 'exam'
            and e.status = 'published' and e.published_at >= ${since}::timestamptz
            and p.status = 'alive' and p.archived_at is null and c.archived_at is null`);
        return list.map((r) => ({
          trigger,
          dedupeKey: `exam:${r.event_id}`,
          clientId: r.client_id,
          patientId: r.patient_id,
          values: { cliente: firstName(r.client_name), animal: r.patient_name, exame: r.exam_name },
        }));
      }
      case 'welcome_client': {
        const list = await rows<{ id: string; name: string }>(sql`
          select c.id, c.name from clients c
          where c.organization_id = ${organizationId} and c.archived_at is null
            and c.created_at >= ${since}::timestamptz`);
        return list.map((r) => ({
          trigger,
          dedupeKey: `welcome-client:${r.id}`,
          clientId: r.id,
          patientId: null,
          values: { cliente: firstName(r.name) },
        }));
      }
      case 'welcome_patient': {
        // Animal cadastrado junto com o cliente (na mesma hora) já recebe as boas-vindas do cliente.
        const list = await rows<{
          id: string;
          name: string;
          client_id: string;
          client_name: string;
        }>(sql`
          select p.id, p.name, c.id as client_id, c.name as client_name
          from patients p join clients c on c.id = p.client_id
          where p.organization_id = ${organizationId} and p.archived_at is null
            and p.status = 'alive' and c.archived_at is null
            and p.created_at >= ${since}::timestamptz
            and p.created_at - c.created_at >= interval '1 hour'`);
        return list.map((r) => ({
          trigger,
          dedupeKey: `welcome-patient:${r.id}`,
          clientId: r.client_id,
          patientId: r.id,
          values: { cliente: firstName(r.client_name), animal: r.name },
        }));
      }
      case 'patient_birthday':
      case 'client_birthday': {
        const year = today.slice(0, 4);
        const monthDay = today.slice(5);
        const leap = new Date(`${year}-02-29T12:00:00Z`).getUTCDate() === 29;
        // Quem nasceu em 29/02 comemora em 28/02 nos anos que não são bissextos.
        const days = monthDay === '02-28' && !leap ? ['02-28', '02-29'] : [monthDay];
        const match = (col: ReturnType<typeof sql>) =>
          sql`to_char(${col}, 'MM-DD') in (${sql.join(
            days.map((d) => sql`${d}`),
            sql`, `,
          )}) and ${col} < ${`${year}-01-01`}::date`;
        if (trigger === 'patient_birthday') {
          const list = await rows<{
            id: string;
            name: string;
            client_id: string;
            client_name: string;
          }>(sql`
            select p.id, p.name, c.id as client_id, c.name as client_name
            from patients p join clients c on c.id = p.client_id
            where p.organization_id = ${organizationId} and p.archived_at is null
              and p.status = 'alive' and c.archived_at is null and ${match(sql`p.birth_date`)}`);
          return list.map((r) => ({
            trigger,
            dedupeKey: `patient-birthday:${r.id}:${year}`,
            clientId: r.client_id,
            patientId: r.id,
            values: { cliente: firstName(r.client_name), animal: r.name },
          }));
        }
        const list = await rows<{ id: string; name: string }>(sql`
          select c.id, c.name from clients c
          where c.organization_id = ${organizationId} and c.archived_at is null
            and c.person_type = 'individual' and ${match(sql`c.birth_date`)}`);
        return list.map((r) => ({
          trigger,
          dedupeKey: `client-birthday:${r.id}:${year}`,
          clientId: r.id,
          patientId: null,
          values: { cliente: firstName(r.name) },
        }));
      }
    }
  }

  /**
   * Põe na fila o que ainda não foi gerado. Sem celular ou com WhatsApp recusado (LGPD), a
   * mensagem fica registrada como não enviada, para a clínica ver por quê.
   */
  private async enqueue(
    organizationId: string,
    setting: MessageSetting,
    candidates: Candidate[],
    clinic: string,
  ): Promise<number> {
    if (candidates.length === 0) return 0;
    const clientIds = [...new Set(candidates.map((c) => c.clientId))];
    const reach = (
      await this.db.execute<{ id: string; phone: string | null; refused: boolean }>(sql`
        select c.id,
          (select cc.value from client_contacts cc
            where cc.client_id = c.id and (cc.is_whatsapp or cc.kind = 'mobile')
            order by cc.is_whatsapp desc, cc.position limit 1) as phone,
          coalesce((select not k.granted from client_consents k
            where k.client_id = c.id and k.channel = 'whatsapp'
            order by k.recorded_at desc limit 1), false) as refused
        from clients c
        where c.id in (${sql.join(
          clientIds.map((id) => sql`${id}::uuid`),
          sql`, `,
        )})`)
    ).rows;
    const byClient = new Map(reach.map((r) => [r.id, r]));
    const variables = templateVariables(setting.template);
    const rows = candidates.map((c) => {
      const values = { ...c.values, clinica: clinic };
      const contact = byClient.get(c.clientId);
      const phone = contact?.phone ?? null;
      const skipReason: SkipReason | null = contact?.refused
        ? 'no_consent'
        : !phone
          ? 'no_phone'
          : null;
      return {
        id: newId(),
        organizationId,
        trigger: c.trigger,
        dedupeKey: c.dedupeKey,
        clientId: c.clientId,
        patientId: c.patientId,
        phone,
        body: renderTemplate(setting.template, values),
        params: variables.map((v) => values[v as MessageVariable] ?? ''),
        status: skipReason ? ('skipped' as const) : ('pending' as const),
        skipReason,
      };
    });
    const inserted = await this.db
      .insert(messages)
      .values(rows)
      .onConflictDoNothing()
      .returning({ id: messages.id });
    return inserted.length;
  }

  /** Lembrete de agendamento cancelado ou já passado, e qualquer pendência de 3 dias, saem. */
  private async expire(organizationId: string) {
    const now = this.now();
    await this.db.execute(sql`
      update messages m set status = 'cancelled', last_error = 'O agendamento mudou ou já passou.'
      where m.organization_id = ${organizationId} and m.status in ('pending', 'failed')
        and m.trigger = 'appointment_reminder'
        and not exists (select 1 from appointments a
          where a.id = split_part(m.dedupe_key, ':', 2)::uuid
            and a.status in ('scheduled', 'confirmed')
            and a.starts_at > ${now.toISOString()}::timestamptz
            and m.dedupe_key = 'appointment:' || a.id || ':' ||
              to_char(a.starts_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))`);
    await this.db.execute(sql`
      update messages set status = 'cancelled', last_error = 'Ficou 3 dias sem envio.'
      where organization_id = ${organizationId} and status = 'pending'
        and created_at < ${new Date(now.getTime() - EXPIRE_AFTER_MS).toISOString()}::timestamptz`);
  }

  /**
   * Envio pela API oficial, só dentro da janela de horário e para gatilhos com modelo aprovado
   * na Meta. Cada mensagem é reservada antes do envio, então duas rodadas não enviam em dobro.
   */
  private async dispatch(
    organizationId: string,
    settings: MessageSetting[],
    timeZone: string,
  ): Promise<number> {
    if (!this.sender.configured) return 0;
    const { minutes } = instantToZoned(this.now(), timeZone);
    if (minutes < SEND_WINDOW.from || minutes >= SEND_WINDOW.to) return 0;
    const templates = new Map(
      settings.filter((s) => s.enabled && s.providerTemplate).map((s) => [s.trigger, s]),
    );
    if (templates.size === 0) return 0;
    const claimed = await this.db
      .update(messages)
      .set({ attempts: sql`${messages.attempts} + 1` })
      .where(
        sql`${messages.id} in (select id from messages
          where organization_id = ${organizationId} and status = 'pending'
            and attempts < ${MAX_ATTEMPTS}
            and trigger in (${sql.join(
              [...templates.keys()].map((t) => sql`${t}`),
              sql`, `,
            )})
          order by created_at limit 20 for update skip locked)`,
      )
      .returning();
    let sent = 0;
    for (const m of claimed) {
      const setting = templates.get(m.trigger);
      if (!setting || !m.phone) continue;
      try {
        const { id } = await this.sender.send({
          phone: m.phone,
          template: setting.providerTemplate,
          params: m.params,
        });
        await this.db
          .update(messages)
          .set({ status: 'sent', channel: 'api', sentAt: this.now(), providerMessageId: id })
          .where(eq(messages.id, m.id));
        sent++;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await this.db
          .update(messages)
          .set({
            status: m.attempts >= MAX_ATTEMPTS ? 'failed' : 'pending',
            lastError: message.slice(0, 500),
          })
          .where(eq(messages.id, m.id));
      }
    }
    return sent;
  }

  private async orgTimeZone(organizationId: string): Promise<string> {
    const [unit] = await this.db
      .select({ timeZone: units.timeZone })
      .from(units)
      .where(eq(units.organizationId, organizationId))
      .orderBy(asc(units.createdAt))
      .limit(1);
    return unit?.timeZone ?? 'America/Sao_Paulo';
  }
}
