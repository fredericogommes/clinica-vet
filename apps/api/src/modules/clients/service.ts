import type {
  Client,
  ClientData,
  ClientListItem,
  Consent,
  UpdateConsentsRequest,
} from '@clinica/contracts';
import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import { actorOf } from '../../core/actor.js';
import { recordAudit } from '../../core/audit.js';
import { conflict, notFound } from '../../core/errors.js';
import { nextCounter } from '../../core/counters.js';
import { newId } from '../../core/ids.js';
import { containsText, likeEscape } from '../../core/search.js';
import type { Database, Executor } from '../../db/client.js';
import { isUniqueViolation, violatedConstraint } from '../../db/errors.js';
import {
  clientConsents,
  clientContacts,
  clientOrigins,
  clients,
  patients,
  species,
  users,
} from '../../db/schema.js';
import type { AuthContext } from '../auth/sessions.js';
import { assertActiveCatalogItem } from '../catalogs/service.js';

export interface ListClientsQuery {
  q: string;
  page: number;
  pageSize: number;
  archived: boolean;
}

const conflictMessages: Record<string, string> = {
  clients_org_cpf_uq: 'Já existe um cliente com este CPF.',
  clients_org_cnpj_uq: 'Já existe um cliente com este CNPJ.',
};

export class ClientService {
  constructor(private readonly db: Database) {}

  /** Busca por nome, CPF/CNPJ, telefone, e-mail ou nome de animal. */
  async list(
    auth: AuthContext,
    query: ListClientsQuery,
  ): Promise<{ items: ClientListItem[]; total: number }> {
    const filters: SQL[] = [
      eq(clients.organizationId, auth.organizationId),
      query.archived ? isNotNull(clients.archivedAt) : isNull(clients.archivedAt),
    ];
    const term = query.q;
    if (term) {
      const digits = term.replace(/\D/g, '');
      const matches: SQL[] = [
        containsText(clients.name, term),
        sql`exists (select 1 from ${clientContacts} cc where cc.client_id = ${clients.id}
          and cc.kind = 'email' and cc.value like ${`%${likeEscape(term.toLowerCase())}%`})`,
        sql`exists (select 1 from ${patients} p where p.client_id = ${clients.id}
          and p.archived_at is null and unaccent(lower(p.name)) like unaccent(lower(${`%${likeEscape(term)}%`})))`,
      ];
      if (/^\d+$/.test(term)) matches.push(eq(clients.code, Number(term)));
      if (digits.length >= 3) {
        const like = `%${digits}%`;
        matches.push(
          sql`${clients.cpf} like ${like}`,
          sql`${clients.cnpj} like ${like}`,
          sql`exists (select 1 from ${clientContacts} cc where cc.client_id = ${clients.id}
            and cc.kind <> 'email' and cc.value like ${like})`,
        );
      }
      const any = or(...matches);
      if (any) filters.push(any);
    }
    const where = and(...filters);
    const [rows, totals] = await Promise.all([
      this.db
        .select({
          id: clients.id,
          code: clients.code,
          personType: clients.personType,
          name: clients.name,
          cpf: clients.cpf,
          cnpj: clients.cnpj,
          archivedAt: clients.archivedAt,
        })
        .from(clients)
        .where(where)
        .orderBy(asc(sql`lower(${clients.name})`), asc(clients.code))
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize),
      this.db.select({ n: count() }).from(clients).where(where),
    ]);
    const ids = rows.map((r) => r.id);
    const [contacts, pets] = ids.length
      ? await Promise.all([
          this.db
            .select()
            .from(clientContacts)
            .where(
              and(inArray(clientContacts.clientId, ids), sql`${clientContacts.kind} <> 'email'`),
            )
            .orderBy(asc(clientContacts.position)),
          this.db
            .select({ id: patients.id, name: patients.name, clientId: patients.clientId })
            .from(patients)
            .where(and(inArray(patients.clientId, ids), isNull(patients.archivedAt)))
            .orderBy(asc(patients.name)),
        ])
      : [[], []];
    return {
      items: rows.map((r) => {
        const phone = contacts.find((c) => c.clientId === r.id);
        return {
          id: r.id,
          code: r.code,
          personType: r.personType,
          name: r.name,
          document: r.cpf ?? r.cnpj,
          primaryPhone: phone?.value ?? null,
          primaryPhoneIsWhatsapp: phone?.isWhatsapp ?? false,
          patients: pets.filter((p) => p.clientId === r.id).map(({ id, name }) => ({ id, name })),
          archived: r.archivedAt !== null,
        };
      }),
      total: totals[0]?.n ?? 0,
    };
  }

  async get(auth: AuthContext, id: string, executor?: Executor): Promise<Client> {
    const db = executor ?? this.db;
    const [row] = await db
      .select({ client: clients, originName: clientOrigins.name })
      .from(clients)
      .leftJoin(clientOrigins, eq(clientOrigins.id, clients.originId))
      .where(and(eq(clients.id, id), eq(clients.organizationId, auth.organizationId)));
    if (!row) throw notFound('Cliente');
    const c = row.client;
    // Sequencial: dentro de uma transação a conexão é uma só.
    const contacts = await db
      .select({
        kind: clientContacts.kind,
        value: clientContacts.value,
        isWhatsapp: clientContacts.isWhatsapp,
      })
      .from(clientContacts)
      .where(eq(clientContacts.clientId, id))
      .orderBy(asc(clientContacts.position));
    const consents = await this.consentHistory(db, id);
    const pets = await db
      .select({
        id: patients.id,
        code: patients.code,
        name: patients.name,
        speciesName: species.name,
        status: patients.status,
        archivedAt: patients.archivedAt,
      })
      .from(patients)
      .leftJoin(species, eq(species.id, patients.speciesId))
      .where(eq(patients.clientId, id))
      .orderBy(asc(patients.name));
    return {
      id: c.id,
      code: c.code,
      personType: c.personType,
      name: c.name,
      nationality: c.nationality,
      sex: c.sex,
      cpf: c.cpf,
      cnpj: c.cnpj,
      rg: c.rg,
      birthDate: c.birthDate,
      originId: c.originId,
      originName: row.originName,
      profession: c.profession,
      municipalRegistration: c.municipalRegistration,
      notes: c.notes,
      contacts,
      address: {
        cep: c.cep,
        street: c.street,
        number: c.number,
        complement: c.complement,
        district: c.district,
        city: c.city,
        state: c.state,
      },
      consents,
      patients: pets.map(({ archivedAt, ...p }) => ({ ...p, archived: archivedAt !== null })),
      archived: c.archivedAt !== null,
      createdAt: c.createdAt.toISOString(),
    };
  }

  async create(auth: AuthContext, input: ClientData): Promise<Client> {
    const id = newId();
    return this.write(async (tx) => {
      await this.assertOrigin(tx, auth, input.originId);
      const code = await nextCounter(tx, auth.organizationId, 'client');
      await tx
        .insert(clients)
        .values({ id, organizationId: auth.organizationId, code, ...columnsOf(input) });
      await this.replaceContacts(tx, id, input);
      const after = await this.get(auth, id, tx);
      await recordAudit(tx, actorOf(auth), {
        entity: 'client',
        entityId: id,
        action: 'create',
        after: snapshot(after),
      });
      return after;
    });
  }

  async update(auth: AuthContext, id: string, input: ClientData): Promise<Client> {
    return this.write(async (tx) => {
      const before = await this.lockAndGet(tx, auth, id);
      if (before.archived) throw conflict('Restaure o cliente antes de editá-lo.');
      await this.assertOrigin(tx, auth, input.originId, before.originId);
      await tx
        .update(clients)
        .set({ ...columnsOf(input), updatedAt: new Date() })
        .where(eq(clients.id, id));
      await this.replaceContacts(tx, id, input);
      const after = await this.get(auth, id, tx);
      await recordAudit(tx, actorOf(auth), {
        entity: 'client',
        entityId: id,
        action: 'update',
        before: snapshot(before),
        after: snapshot(after),
      });
      return after;
    });
  }

  async setArchived(auth: AuthContext, id: string, archived: boolean): Promise<Client> {
    return this.write(async (tx) => {
      const before = await this.lockAndGet(tx, auth, id);
      if (before.archived === archived) return before;
      await tx
        .update(clients)
        .set({ archivedAt: archived ? new Date() : null, updatedAt: new Date() })
        .where(eq(clients.id, id));
      await recordAudit(tx, actorOf(auth), {
        entity: 'client',
        entityId: id,
        action: archived ? 'archive' : 'restore',
        before: { name: before.name, archived: before.archived },
        after: { name: before.name, archived },
      });
      return this.get(auth, id, tx);
    });
  }

  /**
   * Registra a decisão do cliente por canal (LGPD). Gera uma linha nova por canal alterado; o
   * histórico anterior nunca é sobrescrito.
   */
  async updateConsents(
    auth: AuthContext,
    id: string,
    input: UpdateConsentsRequest,
  ): Promise<Client> {
    return this.write(async (tx) => {
      const before = await this.lockAndGet(tx, auth, id);
      if (before.archived) throw conflict('Restaure o cliente antes de alterar o consentimento.');
      const current = currentConsents(before.consents);
      const channels = new Map(input.channels.map((c) => [c.channel, c.granted]));
      const changed = [...channels].filter(
        ([channel, granted]) => current.get(channel) !== granted,
      );
      if (changed.length === 0) return before;
      const recordedAt = new Date();
      await tx.insert(clientConsents).values(
        changed.map(([channel, granted]) => ({
          id: newId(),
          clientId: id,
          channel,
          granted,
          source: input.source,
          recordedAt,
          recordedBy: auth.userId,
        })),
      );
      await recordAudit(tx, actorOf(auth), {
        entity: 'client',
        entityId: id,
        action: 'consent',
        before: Object.fromEntries(
          changed.map(([channel]) => [channel, current.get(channel) ?? null]),
        ),
        after: { ...Object.fromEntries(changed), source: input.source },
      });
      return this.get(auth, id, tx);
    });
  }

  private async consentHistory(db: Executor, clientId: string): Promise<Consent[]> {
    const rows = await db
      .select({
        channel: clientConsents.channel,
        granted: clientConsents.granted,
        source: clientConsents.source,
        recordedAt: clientConsents.recordedAt,
        recordedByName: users.name,
      })
      .from(clientConsents)
      .leftJoin(users, eq(users.id, clientConsents.recordedBy))
      .where(eq(clientConsents.clientId, clientId))
      .orderBy(desc(clientConsents.recordedAt), desc(clientConsents.id));
    return rows.map((r) => ({ ...r, recordedAt: r.recordedAt.toISOString() }));
  }

  private async lockAndGet(tx: Executor, auth: AuthContext, id: string): Promise<Client> {
    const [row] = await tx
      .select({ id: clients.id })
      .from(clients)
      .where(and(eq(clients.id, id), eq(clients.organizationId, auth.organizationId)))
      .for('update');
    if (!row) throw notFound('Cliente');
    return this.get(auth, id, tx);
  }

  /** Origem precisa estar ativa, exceto quando o cliente já a tinha antes de ela ser arquivada. */
  private async assertOrigin(
    tx: Executor,
    auth: AuthContext,
    originId: string | null,
    previous: string | null = null,
  ): Promise<void> {
    if (!originId || originId === previous) return;
    await assertActiveCatalogItem(tx, auth.organizationId, 'client-origins', originId);
  }

  private async replaceContacts(tx: Executor, clientId: string, input: ClientData): Promise<void> {
    await tx.delete(clientContacts).where(eq(clientContacts.clientId, clientId));
    if (input.contacts.length === 0) return;
    await tx.insert(clientContacts).values(
      input.contacts.map((c, position) => ({
        id: newId(),
        clientId,
        kind: c.kind,
        value: c.value,
        isWhatsapp: c.isWhatsapp,
        position,
      })),
    );
  }

  private async write<T>(work: (tx: Executor) => Promise<T>): Promise<T> {
    try {
      return await this.db.transaction(work);
    } catch (error) {
      if (isUniqueViolation(error)) {
        const constraint = violatedConstraint(error);
        throw conflict(
          (constraint && conflictMessages[constraint]) ?? 'Já existe um registro com estes dados.',
        );
      }
      throw error;
    }
  }
}

export const currentConsents = (history: Consent[]): Map<Consent['channel'], boolean> => {
  const current = new Map<Consent['channel'], boolean>();
  // O histórico vem do mais recente para o mais antigo: a primeira linha de cada canal vale.
  for (const c of history) if (!current.has(c.channel)) current.set(c.channel, c.granted);
  return current;
};

function columnsOf(input: ClientData) {
  return {
    personType: input.personType,
    name: input.name,
    nationality: input.nationality,
    sex: input.personType === 'individual' ? input.sex : null,
    cpf: input.personType === 'individual' ? input.cpf : null,
    cnpj: input.personType === 'company' ? input.cnpj : null,
    rg: input.personType === 'individual' ? input.rg : null,
    birthDate: input.personType === 'individual' ? input.birthDate : null,
    originId: input.originId,
    profession: input.profession,
    municipalRegistration: input.municipalRegistration,
    notes: input.notes,
    ...input.address,
  };
}

/** Retrato do cliente para auditoria, sem as listas derivadas (animais e consentimentos). */
function snapshot(c: Client) {
  return {
    code: c.code,
    personType: c.personType,
    name: c.name,
    nationality: c.nationality,
    sex: c.sex,
    cpf: c.cpf,
    cnpj: c.cnpj,
    rg: c.rg,
    birthDate: c.birthDate,
    origin: c.originId ? { id: c.originId, name: c.originName } : null,
    profession: c.profession,
    municipalRegistration: c.municipalRegistration,
    notes: c.notes,
    contacts: c.contacts,
    address: c.address,
    archived: c.archived,
  };
}
