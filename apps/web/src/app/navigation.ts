import type { Permission } from '@clinica/contracts';
import {
  Dna,
  House,
  Palette,
  PawPrint,
  ScrollText,
  ShieldCheck,
  Signpost,
  Users,
  UsersRound,
  type LucideIcon,
} from 'lucide-react';

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
  {
    label: 'Clínica',
    items: [
      { label: 'Início', to: '/', icon: House },
      { label: 'Clientes', to: '/clientes', icon: UsersRound, permission: 'clients.view' },
      { label: 'Animais', to: '/animais', icon: PawPrint, permission: 'patients.view' },
    ],
  },
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
    label: 'Cadastros',
    items: [
      {
        label: 'Espécies e raças',
        to: '/cadastros/especies',
        icon: Dna,
        permission: 'catalogs.manage',
      },
      {
        label: 'Pelagens',
        to: '/cadastros/pelagens',
        icon: Palette,
        permission: 'catalogs.manage',
      },
      {
        label: 'Origens de clientes',
        to: '/cadastros/origens',
        icon: Signpost,
        permission: 'catalogs.manage',
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
