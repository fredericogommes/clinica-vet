import type { Permission } from '@clinica/contracts';
import { House, ScrollText, ShieldCheck, Users, type LucideIcon } from 'lucide-react';

export interface NavItem {
  label: string;
  to: string;
  icon: LucideIcon;
  permission?: Permission;
}

export interface NavSection {
  label: string;
  items: NavItem[];
}

/** Só entram aqui telas implementadas; áreas futuras aparecem quando existirem de verdade. */
export const navigation: NavSection[] = [
  { label: 'Clínica', items: [{ label: 'Início', to: '/', icon: House }] },
  {
    label: 'Consultas',
    items: [
      {
        label: 'Auditoria',
        to: '/consultas/auditoria',
        icon: ScrollText,
        permission: 'admin.audit.view',
      },
    ],
  },
  {
    label: 'Configuração',
    items: [
      {
        label: 'Usuários',
        to: '/configuracao/usuarios',
        icon: Users,
        permission: 'admin.users.view',
      },
      {
        label: 'Perfis de acesso',
        to: '/configuracao/perfis',
        icon: ShieldCheck,
        permission: 'admin.roles.view',
      },
    ],
  },
];
