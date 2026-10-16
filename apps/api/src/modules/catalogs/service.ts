import type { Breed, CatalogItem, CatalogItemInput, CatalogKind } from '@clinica/contracts';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { actorOf } from '../../core/actor.js';
import { recordAudit } from '../../core/audit.js';
import { conflict, notFound } from '../../core/errors.js';
import { newId } from '../../core/ids.js';
import type { Database, Executor } from '../../db/client.js';
import { isUniqueViolation } from '../../db/errors.js';
import { breeds, clientOrigins, coats, species } from '../../db/schema.js';
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
      if (isUniqueViolation(error)) throw conflict('Já existe um cadastro com este nome.');
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
