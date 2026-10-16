import { allPermissions, type Permission } from '@clinica/contracts';

export interface RoleTemplate {
  name: string;
  description: string;
  permissions: readonly Permission[];
}

/**
 * Perfis-modelo. São somente leitura para os usuários: para personalizar, clona-se o modelo.
 * As listas crescem junto com o catálogo de ações, módulo a módulo.
 */
export const roleTemplates: readonly RoleTemplate[] = [
  {
    name: 'Administrador do sistema',
    description: 'Acesso completo, incluindo usuários e perfis de acesso.',
    permissions: allPermissions,
  },
  {
    name: 'Gestor da Clínica',
    description: 'Gestão operacional e financeira da clínica.',
    permissions: ['admin.users.view', 'admin.roles.view', 'admin.audit.view'],
  },
  { name: 'Veterinário', description: 'Atendimento clínico.', permissions: [] },
  { name: 'Recepcionista', description: 'Cadastro, agenda e balcão.', permissions: [] },
  { name: 'Esteticista', description: 'Banho, tosa e estética.', permissions: [] },
];
