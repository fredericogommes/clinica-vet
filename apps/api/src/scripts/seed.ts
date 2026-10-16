import { z } from 'zod';
import { passwordSchema } from '@clinica/contracts';
import { createDatabase } from '../db/client.js';
import { organizations } from '../db/schema.js';
import { provisionOrganization } from '../modules/admin/provisioning.js';

/** Cria a organização inicial e o primeiro administrador. Não faz nada se já houver organização. */
const env = z
  .object({
    DATABASE_URL: z.url(),
    SEED_ORGANIZATION_NAME: z.string().min(2),
    SEED_UNIT_NAME: z.string().min(2),
    SEED_ADMIN_NAME: z.string().min(2),
    SEED_ADMIN_EMAIL: z.email(),
    SEED_ADMIN_PASSWORD: passwordSchema,
  })
  .parse(process.env);

const { db, pool } = createDatabase(env.DATABASE_URL);
try {
  const existing = await db.select({ id: organizations.id }).from(organizations).limit(1);
  if (existing.length > 0) {
    console.log('Já existe uma organização; nada foi alterado.');
  } else {
    await db.transaction((tx) =>
      provisionOrganization(tx, {
        organizationName: env.SEED_ORGANIZATION_NAME,
        unitName: env.SEED_UNIT_NAME,
        admin: {
          name: env.SEED_ADMIN_NAME,
          email: env.SEED_ADMIN_EMAIL,
          password: env.SEED_ADMIN_PASSWORD,
        },
      }),
    );
    console.log(`Organização criada. Administrador: ${env.SEED_ADMIN_EMAIL}`);
  }
} finally {
  await pool.end();
}
