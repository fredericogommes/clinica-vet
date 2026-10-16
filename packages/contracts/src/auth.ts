import { z } from 'zod';
import { allPermissions, type Permission } from './permissions.js';

export const loginRequestSchema = z.object({
  email: z.email('Informe um e-mail válido').trim().toLowerCase(),
  password: z.string().min(1, 'Informe a senha').max(256),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const unitSummarySchema = z.object({ id: z.uuid(), name: z.string() });

export const sessionSchema = z.object({
  user: z.object({ id: z.uuid(), name: z.string(), email: z.string() }),
  organization: z.object({ id: z.uuid(), name: z.string() }),
  currentUnit: unitSummarySchema,
  units: z.array(unitSummarySchema),
  permissions: z.array(z.enum(allPermissions as [Permission, ...Permission[]])),
  csrfToken: z.string(),
});
export type Session = z.infer<typeof sessionSchema>;

export const switchUnitRequestSchema = z.object({ unitId: z.uuid() });
