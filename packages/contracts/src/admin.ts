import { z } from 'zod';
import { allPermissions, type Permission } from './permissions.js';

const permissionSchema = z.enum(allPermissions as [Permission, ...Permission[]]);

export const roleSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  description: z.string().nullable(),
  isTemplate: z.boolean(),
  permissions: z.array(permissionSchema),
  userCount: z.number().int(),
});
export type Role = z.infer<typeof roleSchema>;

export const cloneRoleRequestSchema = z.object({
  name: z.string().trim().min(2, 'Mínimo de 2 caracteres').max(80),
});

export const updateRoleRequestSchema = z.object({
  name: z.string().trim().min(2, 'Mínimo de 2 caracteres').max(80),
  description: z.string().trim().max(500).nullable(),
  permissions: z.array(permissionSchema),
});
export type UpdateRoleRequest = z.infer<typeof updateRoleRequestSchema>;

export const userSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  email: z.string(),
  active: z.boolean(),
  roleId: z.uuid(),
  roleName: z.string(),
  unitIds: z.array(z.uuid()),
  lastLoginAt: z.string().nullable(),
  discountLimitPercent: z.number().nullable(),
});
export type User = z.infer<typeof userSchema>;

export const passwordSchema = z
  .string()
  .min(10, 'A senha deve ter pelo menos 10 caracteres')
  .max(256, 'A senha deve ter no máximo 256 caracteres');

export const createUserRequestSchema = z.object({
  name: z.string().trim().min(2, 'Informe o nome').max(120),
  email: z.email('Informe um e-mail válido').trim().toLowerCase(),
  password: passwordSchema,
  roleId: z.uuid('Selecione um perfil'),
  unitIds: z.array(z.uuid()).min(1, 'Selecione ao menos uma unidade'),
  /** Limite de desconto do usuário no PDV; vazio usa o limite da clínica [RN-26]. */
  discountLimitPercent: z
    .number({ message: 'Informe um percentual' })
    .min(0, 'Não pode ser negativo')
    .max(100, 'Máximo de 100%')
    .nullable()
    .default(null),
});
export type CreateUserRequest = z.infer<typeof createUserRequestSchema>;

export const updateUserRequestSchema = z.object({
  name: z.string().trim().min(2, 'Informe o nome').max(120),
  active: z.boolean(),
  roleId: z.uuid('Selecione um perfil'),
  unitIds: z.array(z.uuid()).min(1, 'Selecione ao menos uma unidade'),
  /** Limite de desconto do usuário no PDV; vazio usa o limite da clínica [RN-26]. */
  discountLimitPercent: z
    .number({ message: 'Informe um percentual' })
    .min(0, 'Não pode ser negativo')
    .max(100, 'Máximo de 100%')
    .nullable()
    .default(null),
});
export type UpdateUserRequest = z.infer<typeof updateUserRequestSchema>;

export const auditEntrySchema = z.object({
  id: z.uuid(),
  occurredAt: z.string(),
  actorName: z.string().nullable(),
  entity: z.string(),
  entityId: z.string(),
  action: z.string(),
  before: z.unknown(),
  after: z.unknown(),
});
export type AuditEntry = z.infer<typeof auditEntrySchema>;

export const pageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

/** Filtro opcional da auditoria por registro, usado no "Histórico de alterações" das fichas. */
export const auditQuerySchema = pageQuerySchema.extend({
  entity: z
    .string()
    .regex(/^[a-z_]{1,40}$/)
    .optional(),
  entityId: z.uuid().optional(),
});
export type AuditQuery = z.infer<typeof auditQuerySchema>;

export function pageSchema<T extends z.ZodType>(item: T) {
  return z.object({
    items: z.array(item),
    page: z.number().int(),
    pageSize: z.number().int(),
    total: z.number().int(),
  });
}
