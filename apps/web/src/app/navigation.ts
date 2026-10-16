import type { Permission } from '@clinica/contracts';
import {
  CalendarClock,
  CalendarDays,
  Dna,
  House,
  Palette,
  PawPrint,
  ScrollText,
  Settings2,
  ShieldCheck,
  Signpost,
  Stethoscope,
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
    label: 'Agenda',
    items: [
      { label: 'Agenda', to: '/agenda', icon: CalendarDays, permission: 'schedule.view' },
      { label: 'Escala', to: '/agenda/escala', icon: CalendarClock, permission: 'schedule.view' },
      {
        label: 'Configuração da agenda',
        to: '/agenda/configuracao',
        icon: Settings2,
        permission: 'schedule.configure',
      },
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
        label: 'Tipos de atendimento',
        to: '/cadastros/tipos-de-atendimento',
        icon: Stethoscope,
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
