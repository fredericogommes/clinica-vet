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
    permissions: [
      'admin.users.view',
      'admin.roles.view',
      'admin.audit.view',
      'clients.view',
      'clients.manage',
      'clients.archive',
      'clients.delete',
      'patients.view',
      'patients.manage',
      'patients.transfer_owner',
      'patients.archive',
      'patients.delete',
      'schedule.view',
      'schedule.manage',
      'schedule.fit_in',
      'schedule.configure',
      'clinical.view',
      'clinical.record',
      'clinical.edit_any',
      'clinical.change_datetime',
      'products.view',
      'products.manage',
      'products.view_cost',
      'catalogs.manage',
      'sales.view',
      'sales.manage',
      'sales.discount',
      'sales.change_price',
      'sales.cancel',
      'sales.configure',
    ],
  },
  {
    name: 'Veterinário',
    description: 'Atendimento clínico.',
    permissions: [
      'clients.view',
      'patients.view',
      'patients.manage',
      'schedule.view',
      'schedule.manage',
      'clinical.view',
      'clinical.record',
      'clinical.change_datetime',
      'products.view',
      'sales.view',
      'sales.manage',
    ],
  },
  {
    name: 'Recepcionista',
    description: 'Cadastro, agenda e balcão.',
    permissions: [
      'clients.view',
      'clients.manage',
      'patients.view',
      'patients.manage',
      'schedule.view',
      'schedule.manage',
      'schedule.fit_in',
      'clinical.view',
      'products.view',
      'sales.view',
      'sales.manage',
    ],
  },
  {
    name: 'Esteticista',
    description: 'Banho, tosa e estética.',
    permissions: [
      'clients.view',
      'patients.view',
      'schedule.view',
      'schedule.manage',
      'clinical.view',
      'clinical.record',
      'products.view',
      'sales.view',
      'sales.manage',
    ],
  },
];
