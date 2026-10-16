import { z } from 'zod';
import { createDatabase } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import { organizations } from '../db/schema.js';
import { syncTemplateRoles } from '../modules/admin/provisioning.js';

const { DATABASE_URL } = z.object({ DATABASE_URL: z.url() }).parse(process.env);
const { db, pool } = createDatabase(DATABASE_URL);
try {
  await runMigrations(db);
  // Os perfis-modelo acompanham o catálogo de ações da versão implantada.
  await db.transaction(async (tx) => {
    for (const org of await tx.select({ id: organizations.id }).from(organizations)) {
      await syncTemplateRoles(tx, org.id);
    }
  });
  console.log('Migrações aplicadas e perfis-modelo sincronizados.');
} finally {
  await pool.end();
}
