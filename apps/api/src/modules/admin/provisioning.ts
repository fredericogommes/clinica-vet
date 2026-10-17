import { and, eq } from 'drizzle-orm';
import type { Executor } from '../../db/client.js';
import {
  appointmentTypes,
  breeds,
  clinicalTemplates,
  costCenters,
  examAttributes,
  exams,
  organizations,
  paymentMethods,
  rolePermissions,
  roles,
  species,
  unitOpeningHours,
  units,
  userUnits,
  users,
  vaccines,
} from '../../db/schema.js';
import { newId } from '../../core/ids.js';
import { hashPassword } from '../../core/passwords.js';
import {
  consultationRecordTemplate,
  starterClinicalTemplates,
} from '../clinical/starter-templates.js';
import { starterExams } from '../exams/starter-exams.js';
import { starterVaccines } from '../vaccines/starter-vaccines.js';
import { roleTemplates } from './role-templates.js';

/** Cria ou atualiza os perfis-modelo de uma organização a partir do código. Idempotente. */
export async function syncTemplateRoles(tx: Executor, organizationId: string): Promise<void> {
  for (const template of roleTemplates) {
    const [existing] = await tx
      .select({ id: roles.id })
      .from(roles)
      .where(and(eq(roles.organizationId, organizationId), eq(roles.name, template.name)));
    const roleId = existing?.id ?? newId();
    if (existing) {
      await tx
        .update(roles)
        .set({ description: template.description, isTemplate: true, updatedAt: new Date() })
        .where(eq(roles.id, roleId));
      await tx.delete(rolePermissions).where(eq(rolePermissions.roleId, roleId));
    } else {
      await tx.insert(roles).values({
        id: roleId,
        organizationId,
        name: template.name,
        description: template.description,
        isTemplate: true,
      });
    }
    if (template.permissions.length > 0) {
      await tx
        .insert(rolePermissions)
        .values(template.permissions.map((permission) => ({ roleId, permission })));
    }
  }
}

export interface ProvisionInput {
  organizationName: string;
  unitName: string;
  admin: { name: string; email: string; password: string };
}

export interface Provisioned {
  organizationId: string;
  unitId: string;
  adminUserId: string;
}

/** Cria uma organização com uma unidade, centro de custo padrão, perfis-modelo e um administrador. */
export async function provisionOrganization(
  tx: Executor,
  input: ProvisionInput,
): Promise<Provisioned> {
  const organizationId = newId();
  const unitId = newId();
  await tx.insert(organizations).values({ id: organizationId, name: input.organizationName });
  await tx.insert(units).values({ id: unitId, organizationId, name: input.unitName });
  await tx
    .insert(costCenters)
    .values({ id: newId(), organizationId, unitId, name: 'Geral', isDefault: true });
  await syncTemplateRoles(tx, organizationId);
  await seedSpecies(tx, organizationId);
  await seedSchedule(tx, organizationId, unitId);
  // Formas iniciais; cartões e convênios dependem das adquirentes de cada clínica [RN-27].
  await tx.insert(paymentMethods).values([
    { id: newId(), organizationId, name: 'Dinheiro', kind: 'cash' },
    { id: newId(), organizationId, name: 'PIX', kind: 'pix' },
    // Fiado: o que fica pendurado vai para Recebimentos, com vencimento no prazo da forma.
    { id: newId(), organizationId, name: 'Conta do cliente', kind: 'account', settlementDays: 30 },
  ]);

  const [adminRole] = await tx
    .select({ id: roles.id })
    .from(roles)
    .where(
      and(eq(roles.organizationId, organizationId), eq(roles.name, 'Administrador do sistema')),
    );
  if (!adminRole) throw new Error('Perfil de administrador não foi criado.');

  const adminUserId = newId();
  await tx.insert(users).values({
    id: adminUserId,
    organizationId,
    roleId: adminRole.id,
    name: input.admin.name,
    email: input.admin.email.toLowerCase(),
    passwordHash: await hashPassword(input.admin.password),
  });
  await tx.insert(userUnits).values({ userId: adminUserId, unitId });
  return { organizationId, unitId, adminUserId };
}

/** Espécies iniciais, cada uma com "Sem raça definida". A clínica cadastra as demais. */
async function seedSpecies(tx: Executor, organizationId: string): Promise<void> {
  for (const name of ['Canina', 'Felina']) {
    const speciesId = newId();
    await tx.insert(species).values({ id: speciesId, organizationId, name });
    await tx
      .insert(breeds)
      .values({ id: newId(), organizationId, speciesId, name: 'Sem raça definida (SRD)' });
  }
}

/**
 * Ponto de partida da agenda e do prontuário: Seg–Sáb 08:00–18:00, tipos de atendimento comuns
 * (a Consulta já com modelo de prontuário), um modelo de receita e um de documento e o Hemograma
 * com os seus campos. A clínica ajusta tudo em Configuração da agenda e em Cadastros.
 */
async function seedSchedule(tx: Executor, organizationId: string, unitId: string): Promise<void> {
  await tx
    .insert(unitOpeningHours)
    .values(
      [1, 2, 3, 4, 5, 6].map((weekday) => ({ unitId, weekday, startMinute: 480, endMinute: 1080 })),
    );
  const types: [string, number][] = [
    ['Consulta', 60],
    ['Retorno', 30],
    ['Vacinação', 30],
    ['Coleta de exames', 30],
    ['Cirurgia', 120],
    ['Banho e tosa', 90],
  ];
  await tx.insert(appointmentTypes).values(
    types.map(([name, durationMinutes]) => ({
      id: newId(),
      organizationId,
      name,
      durationMinutes,
      recordTemplate: name === 'Consulta' ? consultationRecordTemplate : '',
    })),
  );
  await tx
    .insert(clinicalTemplates)
    .values(starterClinicalTemplates.map((t) => ({ id: newId(), organizationId, ...t })));
  for (const exam of starterExams) {
    const examId = newId();
    await tx.insert(exams).values({ id: examId, organizationId, name: exam.name });
    await tx
      .insert(examAttributes)
      .values(exam.attributes.map((a, position) => ({ id: newId(), examId, position, ...a })));
  }
  await tx
    .insert(vaccines)
    .values(starterVaccines.map((v) => ({ id: newId(), organizationId, ...v })));
}
