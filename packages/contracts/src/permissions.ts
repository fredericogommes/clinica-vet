/**
 * Catálogo de ações autorizáveis. A chave é a unidade de autorização verificada no
 * servidor; o frontend usa o mesmo catálogo apenas para esconder controles.
 * Novas telas acrescentam suas ações aqui, nunca checam por perfil ou por nome de tela.
 */
export const permissionCatalog = {
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
