import type { clinicalTemplateInputSchema, pathologyInputSchema } from '@clinica/contracts';
import {
  type AppointmentType,
  type AppointmentTypeInput,
  type Breed,
  type CatalogItem,
  type CatalogItemInput,
  type CatalogKind,
  type ClinicalTemplate,
  type ClinicalTemplateKind,
  type Pathology,
} from '@clinica/contracts';
import type { z } from 'zod';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { actorOf } from '../../core/actor.js';
import { recordAudit } from '../../core/audit.js';
import { conflict, notFound } from '../../core/errors.js';
import { newId } from '../../core/ids.js';
import type { Database, Executor } from '../../db/client.js';
import { isUniqueViolation, violatedConstraint } from '../../db/errors.js';
import {
  appointmentTypes,
  breeds,
  clientOrigins,
  clinicalTemplates,
  coats,
  pathologies,
  species,
} from '../../db/schema.js';
import type { AuthContext } from '../auth/sessions.js';

const tables = { species, coats, 'client-origins': clientOrigins } as const;
const entityNames: Record<CatalogKind, string> = {
  species: 'species',
  coats: 'coat',
  'client-origins': 'client_origin',
};

type Row = { id: string; name: string; archivedAt: Date | null };
const toItem = (r: Row): CatalogItem => ({
  id: r.id,
  name: r.name,
  archived: r.archivedAt !== null,
});

type TypeRow = {
  id: string;
  name: string;
  durationMinutes: number;
  recordTemplate: string;
  archivedAt: Date | null;
};
const toAppointmentType = (r: TypeRow): AppointmentType => ({
  id: r.id,
  name: r.name,
  durationMinutes: r.durationMinutes,
  recordTemplate: r.recordTemplate,
  archived: r.archivedAt !== null,
});
const typeSnapshot = (r: TypeRow) => ({
  name: r.name,
  durationMinutes: r.durationMinutes,
  recordTemplate: r.recordTemplate,
  archived: r.archivedAt !== null,
});

type PathologyRow = { id: string; code: string | null; name: string; archivedAt: Date | null };
const toPathology = (r: PathologyRow): Pathology => ({
  id: r.id,
  code: r.code,
  name: r.name,
  archived: r.archivedAt !== null,
});
const pathologySnapshot = ({ id: _id, ...rest }: Pathology) => rest;

type TemplateRow = {
  id: string;
  kind: ClinicalTemplateKind;
  name: string;
  body: string;
  archivedAt: Date | null;
};
const toTemplate = (r: TemplateRow): ClinicalTemplate => ({
  id: r.id,
  kind: r.kind,
  name: r.name,
  body: r.body,
  archived: r.archivedAt !== null,
});
const templateSnapshot = ({ id: _id, ...rest }: ClinicalTemplate) => rest;

/** Cadastros de apoio: espécies, raças, pelagens e origens de cliente. */
export class CatalogService {
  constructor(private readonly db: Database) {}

  async list(auth: AuthContext, kind: CatalogKind): Promise<CatalogItem[]> {
    const table = tables[kind];
    const rows = await this.db
      .select({ id: table.id, name: table.name, archivedAt: table.archivedAt })
      .from(table)
      .where(eq(table.organizationId, auth.organizationId))
      .orderBy(asc(sql`lower(${table.name})`));
    return rows.map(toItem);
  }

  async create(
    auth: AuthContext,
    kind: CatalogKind,
    input: CatalogItemInput,
  ): Promise<CatalogItem> {
    const table = tables[kind];
    const id = newId();
    const archivedAt = input.archived ? new Date() : null;
    await this.write(async (tx) => {
      await tx
        .insert(table)
        .values({ id, organizationId: auth.organizationId, name: input.name, archivedAt });
      await recordAudit(tx, actorOf(auth), {
        entity: entityNames[kind],
        entityId: id,
        action: 'create',
        after: { name: input.name, archived: archivedAt !== null },
      });
    });
    return { id, name: input.name, archived: archivedAt !== null };
  }

  async update(
    auth: AuthContext,
    kind: CatalogKind,
    id: string,
    input: CatalogItemInput,
  ): Promise<CatalogItem> {
    const table = tables[kind];
    return this.write(async (tx) => {
      const [current] = await tx
        .select({ id: table.id, name: table.name, archivedAt: table.archivedAt })
        .from(table)
        .where(and(eq(table.id, id), eq(table.organizationId, auth.organizationId)))
        .for('update');
      if (!current) throw notFound('Cadastro');
      const archivedAt = input.archived ? (current.archivedAt ?? new Date()) : null;
      await tx
        .update(table)
        .set({ name: input.name, archivedAt, updatedAt: new Date() })
        .where(eq(table.id, id));
      await recordAudit(tx, actorOf(auth), {
        entity: entityNames[kind],
        entityId: id,
        action: 'update',
        before: { name: current.name, archived: current.archivedAt !== null },
        after: { name: input.name, archived: archivedAt !== null },
      });
      return { id, name: input.name, archived: archivedAt !== null };
    });
  }

  async listBreeds(auth: AuthContext, speciesId: string): Promise<Breed[]> {
    await this.findSpecies(this.db, auth, speciesId);
    const rows = await this.db
      .select({
        id: breeds.id,
        name: breeds.name,
        archivedAt: breeds.archivedAt,
        speciesId: breeds.speciesId,
      })
      .from(breeds)
      .where(eq(breeds.speciesId, speciesId))
      .orderBy(asc(sql`lower(${breeds.name})`));
    return rows.map((r) => ({ ...toItem(r), speciesId: r.speciesId }));
  }

  async createBreed(auth: AuthContext, speciesId: string, input: CatalogItemInput): Promise<Breed> {
    const id = newId();
    const archivedAt = input.archived ? new Date() : null;
    await this.write(async (tx) => {
      const parent = await this.findSpecies(tx, auth, speciesId);
      await tx.insert(breeds).values({
        id,
        organizationId: auth.organizationId,
        speciesId,
        name: input.name,
        archivedAt,
      });
      await recordAudit(tx, actorOf(auth), {
        entity: 'breed',
        entityId: id,
        action: 'create',
        after: { name: input.name, species: parent.name, archived: archivedAt !== null },
      });
    });
    return { id, name: input.name, archived: archivedAt !== null, speciesId };
  }

  async updateBreed(auth: AuthContext, id: string, input: CatalogItemInput): Promise<Breed> {
    return this.write(async (tx) => {
      const [current] = await tx
        .select()
        .from(breeds)
        .where(and(eq(breeds.id, id), eq(breeds.organizationId, auth.organizationId)))
        .for('update');
      if (!current) throw notFound('Raça');
      const archivedAt = input.archived ? (current.archivedAt ?? new Date()) : null;
      await tx
        .update(breeds)
        .set({ name: input.name, archivedAt, updatedAt: new Date() })
        .where(eq(breeds.id, id));
      await recordAudit(tx, actorOf(auth), {
        entity: 'breed',
        entityId: id,
        action: 'update',
        before: { name: current.name, archived: current.archivedAt !== null },
        after: { name: input.name, archived: archivedAt !== null },
      });
      return { id, name: input.name, archived: archivedAt !== null, speciesId: current.speciesId };
    });
  }

  async listAppointmentTypes(auth: AuthContext): Promise<AppointmentType[]> {
    const rows = await this.db
      .select()
      .from(appointmentTypes)
      .where(eq(appointmentTypes.organizationId, auth.organizationId))
      .orderBy(asc(sql`lower(${appointmentTypes.name})`));
    return rows.map(toAppointmentType);
  }

  async createAppointmentType(
    auth: AuthContext,
    input: AppointmentTypeInput,
  ): Promise<AppointmentType> {
    const id = newId();
    const archivedAt = input.archived ? new Date() : null;
    const values = {
      id,
      organizationId: auth.organizationId,
      name: input.name,
      durationMinutes: input.durationMinutes,
      recordTemplate: input.recordTemplate ?? '',
      archivedAt,
    };
    await this.write(async (tx) => {
      await tx.insert(appointmentTypes).values(values);
      await recordAudit(tx, actorOf(auth), {
        entity: 'appointment_type',
        entityId: id,
        action: 'create',
        after: typeSnapshot(values),
      });
    });
    return toAppointmentType(values);
  }

  async updateAppointmentType(
    auth: AuthContext,
    id: string,
    input: AppointmentTypeInput,
  ): Promise<AppointmentType> {
    return this.write(async (tx) => {
      const [current] = await tx
        .select()
        .from(appointmentTypes)
        .where(
          and(
            eq(appointmentTypes.id, id),
            eq(appointmentTypes.organizationId, auth.organizationId),
          ),
        )
        .for('update');
      if (!current) throw notFound('Tipo de atendimento');
      const next = {
        ...current,
        name: input.name,
        durationMinutes: input.durationMinutes,
        recordTemplate: input.recordTemplate ?? current.recordTemplate,
        archivedAt: input.archived ? (current.archivedAt ?? new Date()) : null,
      };
      await tx
        .update(appointmentTypes)
        .set({
          name: next.name,
          durationMinutes: next.durationMinutes,
          recordTemplate: next.recordTemplate,
          archivedAt: next.archivedAt,
          updatedAt: new Date(),
        })
        .where(eq(appointmentTypes.id, id));
      await recordAudit(tx, actorOf(auth), {
        entity: 'appointment_type',
        entityId: id,
        action: 'update',
        before: typeSnapshot(current),
        after: typeSnapshot(next),
      });
      return toAppointmentType(next);
    });
  }

  async listPathologies(auth: AuthContext): Promise<Pathology[]> {
    const rows = await this.db
      .select()
      .from(pathologies)
      .where(eq(pathologies.organizationId, auth.organizationId))
      .orderBy(asc(sql`lower(${pathologies.name})`));
    return rows.map(toPathology);
  }

  async savePathology(
    auth: AuthContext,
    id: string | null,
    input: z.output<typeof pathologyInputSchema>,
  ): Promise<Pathology> {
    return this.write(async (tx) => {
      const [current] = id
        ? await tx
            .select()
            .from(pathologies)
            .where(and(eq(pathologies.id, id), eq(pathologies.organizationId, auth.organizationId)))
            .for('update')
        : [];
      if (id && !current) throw notFound('Patologia');
      const values = {
        code: input.code,
        name: input.name,
        archivedAt: input.archived ? (current?.archivedAt ?? new Date()) : null,
      };
      const saved = toPathology({ id: id ?? newId(), ...values });
      if (current) {
        await tx
          .update(pathologies)
          .set({ ...values, updatedAt: new Date() })
          .where(eq(pathologies.id, current.id));
      } else {
        await tx
          .insert(pathologies)
          .values({ id: saved.id, organizationId: auth.organizationId, ...values });
      }
      await recordAudit(tx, actorOf(auth), {
        entity: 'pathology',
        entityId: saved.id,
        action: current ? 'update' : 'create',
        ...(current ? { before: pathologySnapshot(toPathology(current)) } : {}),
        after: pathologySnapshot(saved),
      });
      return saved;
    });
  }

  async listTemplates(auth: AuthContext): Promise<ClinicalTemplate[]> {
    const rows = await this.db
      .select()
      .from(clinicalTemplates)
      .where(eq(clinicalTemplates.organizationId, auth.organizationId))
      .orderBy(asc(clinicalTemplates.kind), asc(sql`lower(${clinicalTemplates.name})`));
    return rows.map(toTemplate);
  }

  async saveTemplate(
    auth: AuthContext,
    id: string | null,
    input: z.output<typeof clinicalTemplateInputSchema>,
  ): Promise<ClinicalTemplate> {
    return this.write(async (tx) => {
      const [current] = id
        ? await tx
            .select()
            .from(clinicalTemplates)
            .where(
              and(
                eq(clinicalTemplates.id, id),
                eq(clinicalTemplates.organizationId, auth.organizationId),
              ),
            )
            .for('update')
        : [];
      if (id && !current) throw notFound('Modelo');
      const values = {
        kind: input.kind,
        name: input.name,
        body: input.body,
        archivedAt: input.archived ? (current?.archivedAt ?? new Date()) : null,
      };
      const saved = toTemplate({ id: id ?? newId(), ...values });
      if (current) {
        await tx
          .update(clinicalTemplates)
          .set({ ...values, updatedAt: new Date() })
          .where(eq(clinicalTemplates.id, current.id));
      } else {
        await tx
          .insert(clinicalTemplates)
          .values({ id: saved.id, organizationId: auth.organizationId, ...values });
      }
      await recordAudit(tx, actorOf(auth), {
        entity: 'clinical_template',
        entityId: saved.id,
        action: current ? 'update' : 'create',
        ...(current ? { before: templateSnapshot(toTemplate(current)) } : {}),
        after: templateSnapshot(saved),
      });
      return saved;
    });
  }

  private async findSpecies(db: Executor, auth: AuthContext, speciesId: string) {
    const [row] = await db
      .select({ id: species.id, name: species.name })
      .from(species)
      .where(and(eq(species.id, speciesId), eq(species.organizationId, auth.organizationId)));
    if (!row) throw notFound('Espécie');
    return row;
  }

  private async write<T>(work: (tx: Executor) => Promise<T>): Promise<T> {
    try {
      return await this.db.transaction(work);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw conflict(
          violatedConstraint(error) === 'pathologies_org_code_uq'
            ? 'Já existe uma patologia com este código.'
            : 'Já existe um cadastro com este nome.',
        );
      }
      throw error;
    }
  }
}

/** Confere que os itens de cadastro referenciados existem, estão ativos e são da organização. */
export async function assertActiveCatalogItem(
  tx: Executor,
  organizationId: string,
  kind: CatalogKind,
  id: string,
): Promise<string> {
  const table = tables[kind];
  const [row] = await tx
    .select({ name: table.name })
    .from(table)
    .where(
      and(eq(table.id, id), eq(table.organizationId, organizationId), isNull(table.archivedAt)),
    );
  if (!row) throw notFound('Cadastro');
  return row.name;
}
