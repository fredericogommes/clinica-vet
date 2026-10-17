import {
  insuranceActiveOn,
  type Patient,
  type PatientData,
  type PatientListItem,
} from '@clinica/contracts';
import { and, asc, count, desc, eq, isNotNull, isNull, or, sql, type SQL } from 'drizzle-orm';
import { actorOf } from '../../core/actor.js';
import { recordAudit } from '../../core/audit.js';
import { AppError, conflict, notFound } from '../../core/errors.js';
import { nextCounter } from '../../core/counters.js';
import { newId } from '../../core/ids.js';
import { containsText } from '../../core/search.js';
import type { Database, Executor } from '../../db/client.js';
import { isUniqueViolation, violatedConstraint } from '../../db/errors.js';
import {
  appointmentPatients,
  breeds,
  clientContacts,
  clients,
  clinicalEvents,
  coats,
  insurers,
  patientOwnerHistory,
  patients,
  species,
} from '../../db/schema.js';
import type { AuthContext } from '../auth/sessions.js';

export interface ListPatientsQuery {
  q: string;
  page: number;
  pageSize: number;
  archived: boolean;
}

const invalid = (path: string, message: string) =>
  new AppError('validation_failed', 'Dados do animal inválidos.', [{ path, message }]);

export class PatientService {
  constructor(private readonly db: Database) {}

  async list(
    auth: AuthContext,
    query: ListPatientsQuery,
  ): Promise<{ items: PatientListItem[]; total: number }> {
    const filters: SQL[] = [
      eq(patients.organizationId, auth.organizationId),
      query.archived ? isNotNull(patients.archivedAt) : isNull(patients.archivedAt),
    ];
    if (query.q) {
      const matches: SQL[] = [
        containsText(patients.name, query.q),
        containsText(clients.name, query.q),
        eq(patients.microchip, query.q.replace(/\s/g, '')),
      ];
      if (/^\d+$/.test(query.q)) matches.push(eq(patients.code, Number(query.q)));
      const any = or(...matches);
      if (any) filters.push(any);
    }
    const where = and(...filters);
    const [rows, totals] = await Promise.all([
      this.db
        .select({
          id: patients.id,
          code: patients.code,
          name: patients.name,
          speciesName: species.name,
          breedName: breeds.name,
          status: patients.status,
          markings: patients.markings,
          ownerId: clients.id,
          ownerName: clients.name,
          archivedAt: patients.archivedAt,
        })
        .from(patients)
        .innerJoin(clients, eq(clients.id, patients.clientId))
        .leftJoin(species, eq(species.id, patients.speciesId))
        .leftJoin(breeds, eq(breeds.id, patients.breedId))
        .where(where)
        .orderBy(asc(sql`lower(${patients.name})`), asc(patients.code))
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize),
      this.db
        .select({ n: count() })
        .from(patients)
        .innerJoin(clients, eq(clients.id, patients.clientId))
        .where(where),
    ]);
    return {
      items: rows.map(({ ownerId, ownerName, archivedAt, ...r }) => ({
        ...r,
        owner: { id: ownerId, name: ownerName },
        archived: archivedAt !== null,
      })),
      total: totals[0]?.n ?? 0,
    };
  }

  async get(auth: AuthContext, id: string, executor?: Executor): Promise<Patient> {
    const db = executor ?? this.db;
    const [row] = await db
      .select({
        patient: patients,
        speciesName: species.name,
        breedName: breeds.name,
        coatName: coats.name,
        ownerCode: clients.code,
        ownerName: clients.name,
        insurerName: insurers.name,
        insurerArchivedAt: insurers.archivedAt,
      })
      .from(patients)
      .innerJoin(clients, eq(clients.id, patients.clientId))
      .leftJoin(insurers, eq(insurers.id, patients.insurerId))
      .leftJoin(species, eq(species.id, patients.speciesId))
      .leftJoin(breeds, eq(breeds.id, patients.breedId))
      .leftJoin(coats, eq(coats.id, patients.coatId))
      .where(and(eq(patients.id, id), eq(patients.organizationId, auth.organizationId)));
    if (!row) throw notFound('Animal');
    const p = row.patient;
    // Sequencial: dentro de uma transação a conexão é uma só.
    const phones = await db
      .select({ value: clientContacts.value })
      .from(clientContacts)
      .where(and(eq(clientContacts.clientId, p.clientId), sql`${clientContacts.kind} <> 'email'`))
      .orderBy(asc(clientContacts.position))
      .limit(1);
    const history = await db
      .select({
        clientId: patientOwnerHistory.clientId,
        clientName: clients.name,
        startedAt: patientOwnerHistory.startedAt,
        endedAt: patientOwnerHistory.endedAt,
        reason: patientOwnerHistory.reason,
      })
      .from(patientOwnerHistory)
      .innerJoin(clients, eq(clients.id, patientOwnerHistory.clientId))
      .where(eq(patientOwnerHistory.patientId, id))
      .orderBy(desc(patientOwnerHistory.startedAt), desc(patientOwnerHistory.id));
    return {
      id: p.id,
      code: p.code,
      name: p.name,
      status: p.status,
      deceasedOn: p.deceasedOn,
      sex: p.sex,
      sterilized: p.sterilized,
      birthDate: p.birthDate,
      speciesId: p.speciesId,
      speciesName: row.speciesName,
      breedId: p.breedId,
      breedName: row.breedName,
      coatId: p.coatId,
      coatName: row.coatName,
      microchip: p.microchip,
      hasPedigree: p.hasPedigree,
      pedigreeNumber: p.pedigreeNumber,
      markings: p.markings,
      insurance:
        p.insurerId && p.insuranceCardNumber !== null && row.insurerName !== null
          ? {
              insurerId: p.insurerId,
              insurerName: row.insurerName,
              cardNumber: p.insuranceCardNumber,
              validUntil: p.insuranceValidUntil,
              active: insuranceActiveOn(
                { validUntil: p.insuranceValidUntil },
                row.insurerArchivedAt !== null,
                new Date().toISOString().slice(0, 10),
              ),
            }
          : null,
      archived: p.archivedAt !== null,
      owner: {
        id: p.clientId,
        code: row.ownerCode,
        name: row.ownerName,
        primaryPhone: phones[0]?.value ?? null,
      },
      ownerHistory: history.map((h) => ({
        clientId: h.clientId,
        clientName: h.clientName,
        from: h.startedAt.toISOString(),
        to: h.endedAt?.toISOString() ?? null,
        reason: h.reason,
      })),
    };
  }

  async create(auth: AuthContext, clientId: string, input: PatientData): Promise<Patient> {
    const id = newId();
    return this.write(async (tx) => {
      await this.lockActiveClient(tx, auth, clientId, 'clientId');
      await this.assertCatalogs(tx, auth, input, null);
      const code = await nextCounter(tx, auth.organizationId, 'patient');
      await tx.insert(patients).values({
        id,
        organizationId: auth.organizationId,
        code,
        clientId,
        ...columnsOf(input),
      });
      await tx.insert(patientOwnerHistory).values({
        id: newId(),
        patientId: id,
        clientId,
        changedBy: auth.userId,
      });
      const after = await this.get(auth, id, tx);
      await recordAudit(tx, actorOf(auth), {
        entity: 'patient',
        entityId: id,
        action: 'create',
        after: snapshot(after),
      });
      return after;
    });
  }

  async update(auth: AuthContext, id: string, input: PatientData): Promise<Patient> {
    return this.write(async (tx) => {
      const before = await this.lockAndGet(tx, auth, id);
      if (before.archived) throw conflict('Restaure o animal antes de editá-lo.');
      await this.assertCatalogs(tx, auth, input, before);
      await tx
        .update(patients)
        .set({ ...columnsOf(input), updatedAt: new Date() })
        .where(eq(patients.id, id));
      const after = await this.get(auth, id, tx);
      await recordAudit(tx, actorOf(auth), {
        entity: 'patient',
        entityId: id,
        action: 'update',
        before: snapshot(before),
        after: snapshot(after),
      });
      return after;
    });
  }

  /** Troca o responsável preservando quem foi dono antes e por quê (RN-05). */
  async transferOwner(
    auth: AuthContext,
    id: string,
    clientId: string,
    reason: string | null,
  ): Promise<Patient> {
    return this.write(async (tx) => {
      const before = await this.lockAndGet(tx, auth, id);
      if (before.archived) throw conflict('Restaure o animal antes de trocar o responsável.');
      if (before.owner.id === clientId)
        throw conflict('Este cliente já é o responsável pelo animal.');
      const target = await this.lockActiveClient(tx, auth, clientId, 'clientId');
      const now = new Date();
      await tx
        .update(patientOwnerHistory)
        .set({ endedAt: now })
        .where(and(eq(patientOwnerHistory.patientId, id), isNull(patientOwnerHistory.endedAt)));
      await tx.insert(patientOwnerHistory).values({
        id: newId(),
        patientId: id,
        clientId,
        startedAt: now,
        reason,
        changedBy: auth.userId,
      });
      await tx.update(patients).set({ clientId, updatedAt: now }).where(eq(patients.id, id));
      await recordAudit(tx, actorOf(auth), {
        entity: 'patient',
        entityId: id,
        action: 'transfer_owner',
        before: { name: before.name, owner: { id: before.owner.id, name: before.owner.name } },
        after: { name: before.name, owner: { id: clientId, name: target.name }, reason },
      });
      return this.get(auth, id, tx);
    });
  }

  async setArchived(auth: AuthContext, id: string, archived: boolean): Promise<Patient> {
    return this.write(async (tx) => {
      const before = await this.lockAndGet(tx, auth, id);
      if (before.archived === archived) return before;
      await tx
        .update(patients)
        .set({ archivedAt: archived ? new Date() : null, updatedAt: new Date() })
        .where(eq(patients.id, id));
      await recordAudit(tx, actorOf(auth), {
        entity: 'patient',
        entityId: id,
        action: archived ? 'archive' : 'restore',
        before: { name: before.name, archived: before.archived },
        after: { name: before.name, archived },
      });
      return this.get(auth, id, tx);
    });
  }

  /**
   * Exclusão definitiva [RN-21] só para ficha sem histórico (cadastro feito por engano). Com
   * prontuário ou agendamento, o caminho é arquivar: o histórico clínico não é apagado.
   */
  async remove(auth: AuthContext, id: string): Promise<void> {
    await this.write(async (tx) => {
      const before = await this.lockAndGet(tx, auth, id);
      const [events] = await tx
        .select({ n: count() })
        .from(clinicalEvents)
        .where(eq(clinicalEvents.patientId, id));
      const [bookings] = await tx
        .select({ n: count() })
        .from(appointmentPatients)
        .where(eq(appointmentPatients.patientId, id));
      if ((events?.n ?? 0) > 0 || (bookings?.n ?? 0) > 0) {
        throw conflict(
          'Este animal tem prontuário ou agendamentos e não pode ser excluído. Arquive a ficha.',
        );
      }
      await tx.delete(patients).where(eq(patients.id, id));
      await recordAudit(tx, actorOf(auth), {
        entity: 'patient',
        entityId: id,
        action: 'delete',
        before: { code: before.code, name: before.name, owner: before.owner.name },
      });
    });
  }

  private async lockAndGet(tx: Executor, auth: AuthContext, id: string): Promise<Patient> {
    const [row] = await tx
      .select({ id: patients.id })
      .from(patients)
      .where(and(eq(patients.id, id), eq(patients.organizationId, auth.organizationId)))
      .for('update');
    if (!row) throw notFound('Animal');
    return this.get(auth, id, tx);
  }

  private async lockActiveClient(tx: Executor, auth: AuthContext, clientId: string, path: string) {
    const [client] = await tx
      .select({ name: clients.name, archivedAt: clients.archivedAt })
      .from(clients)
      .where(and(eq(clients.id, clientId), eq(clients.organizationId, auth.organizationId)))
      .for('share');
    if (!client) throw invalid(path, 'Cliente não encontrado');
    if (client.archivedAt) throw invalid(path, 'Cliente arquivado');
    return client;
  }

  /**
   * Espécie, raça e pelagem precisam ser da organização e estar ativas. Um item arquivado depois
   * do cadastro continua aceito enquanto não for trocado, para não travar a edição da ficha.
   */
  private async assertCatalogs(
    tx: Executor,
    auth: AuthContext,
    input: PatientData,
    before: Patient | null,
  ): Promise<void> {
    if (input.speciesId && input.speciesId !== before?.speciesId) {
      const [row] = await tx
        .select({ id: species.id })
        .from(species)
        .where(
          and(
            eq(species.id, input.speciesId),
            eq(species.organizationId, auth.organizationId),
            isNull(species.archivedAt),
          ),
        );
      if (!row) throw invalid('patient.speciesId', 'Espécie inválida');
    }
    if (input.breedId) {
      const [row] = await tx
        .select({ speciesId: breeds.speciesId, archivedAt: breeds.archivedAt })
        .from(breeds)
        .where(and(eq(breeds.id, input.breedId), eq(breeds.organizationId, auth.organizationId)));
      if (!row || (row.archivedAt && input.breedId !== before?.breedId)) {
        throw invalid('patient.breedId', 'Raça inválida');
      }
      if (row.speciesId !== input.speciesId) {
        throw invalid('patient.breedId', 'A raça não pertence à espécie selecionada');
      }
    }
    if (input.coatId && input.coatId !== before?.coatId) {
      const [row] = await tx
        .select({ id: coats.id })
        .from(coats)
        .where(
          and(
            eq(coats.id, input.coatId),
            eq(coats.organizationId, auth.organizationId),
            isNull(coats.archivedAt),
          ),
        );
      if (!row) throw invalid('patient.coatId', 'Pelagem inválida');
    }
    // O plano de um convênio arquivado continua no animal, mas não se cadastra um novo nele.
    if (input.insurance && input.insurance.insurerId !== before?.insurance?.insurerId) {
      const [row] = await tx
        .select({ id: insurers.id })
        .from(insurers)
        .where(
          and(
            eq(insurers.id, input.insurance.insurerId),
            eq(insurers.organizationId, auth.organizationId),
            isNull(insurers.archivedAt),
          ),
        );
      if (!row) throw invalid('patient.insurance.insurerId', 'Convênio indisponível');
    }
  }

  private async write<T>(work: (tx: Executor) => Promise<T>): Promise<T> {
    try {
      return await this.db.transaction(work);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw conflict(
          violatedConstraint(error) === 'patients_org_microchip_uq'
            ? 'Já existe um animal com este microchip.'
            : 'Já existe um registro com estes dados.',
        );
      }
      throw error;
    }
  }
}

function columnsOf(input: PatientData) {
  return {
    name: input.name,
    status: input.status,
    deceasedOn: input.status === 'deceased' ? input.deceasedOn : null,
    sex: input.sex,
    sterilized: input.sterilized,
    birthDate: input.birthDate,
    speciesId: input.speciesId,
    breedId: input.breedId,
    coatId: input.coatId,
    microchip: input.microchip,
    hasPedigree: input.hasPedigree,
    pedigreeNumber: input.hasPedigree ? input.pedigreeNumber : null,
    markings: [...new Set(input.markings)],
    insurerId: input.insurance?.insurerId ?? null,
    insuranceCardNumber: input.insurance?.cardNumber ?? null,
    insuranceValidUntil: input.insurance?.validUntil ?? null,
  };
}

function snapshot(p: Patient) {
  return {
    code: p.code,
    name: p.name,
    status: p.status,
    deceasedOn: p.deceasedOn,
    sex: p.sex,
    sterilized: p.sterilized,
    birthDate: p.birthDate,
    species: p.speciesId ? { id: p.speciesId, name: p.speciesName } : null,
    breed: p.breedId ? { id: p.breedId, name: p.breedName } : null,
    coat: p.coatId ? { id: p.coatId, name: p.coatName } : null,
    microchip: p.microchip,
    hasPedigree: p.hasPedigree,
    pedigreeNumber: p.pedigreeNumber,
    markings: p.markings,
    insurance: p.insurance
      ? {
          insurer: p.insurance.insurerName,
          cardNumber: p.insurance.cardNumber,
          validUntil: p.insurance.validUntil,
        }
      : null,
    owner: { id: p.owner.id, name: p.owner.name },
    archived: p.archived,
  };
}
