/**
 * Catálogo de ações autorizáveis. A chave é a unidade de autorização verificada no
 * servidor; o frontend usa o mesmo catálogo apenas para esconder controles.
 * Novas telas acrescentam suas ações aqui, nunca checam por perfil ou por nome de tela.
 */
export const permissionCatalog = {
  'clients.view': { group: 'Clientes e animais', label: 'Ver clientes' },
  'clients.manage': {
    group: 'Clientes e animais',
    label: 'Cadastrar e editar clientes e consentimentos',
  },
  'clients.archive': { group: 'Clientes e animais', label: 'Arquivar e restaurar clientes' },
  'patients.view': { group: 'Clientes e animais', label: 'Ver animais' },
  'patients.manage': { group: 'Clientes e animais', label: 'Cadastrar e editar animais' },
  'patients.transfer_owner': {
    group: 'Clientes e animais',
    label: 'Trocar o responsável de um animal',
  },
  'patients.archive': { group: 'Clientes e animais', label: 'Arquivar e restaurar animais' },
  'catalogs.manage': {
    group: 'Cadastros',
    label: 'Editar espécies, raças, pelagens e origem dos clientes',
  },
  'admin.users.view': { group: 'Configuração', label: 'Ver usuários' },
  'admin.users.manage': { group: 'Configuração', label: 'Cadastrar e editar usuários' },
  'admin.roles.view': { group: 'Configuração', label: 'Ver perfis de acesso' },
  'admin.roles.manage': { group: 'Configuração', label: 'Criar, clonar e editar perfis de acesso' },
  'admin.audit.view': { group: 'Consultas', label: 'Ver log de auditoria' },
} as const satisfies Record<string, { group: string; label: string }>;

export type Permission = keyof typeof permissionCatalog;

export const allPermissions = Object.keys(permissionCatalog) as Permission[];

export function isPermission(value: string): value is Permission {
  return Object.hasOwn(permissionCatalog, value);
}
