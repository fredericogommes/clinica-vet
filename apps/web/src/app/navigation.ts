import type { Permission } from '@clinica/contracts';
import {
  Activity,
  CalendarClock,
  CalendarDays,
  ClipboardList,
  Dna,
  FileText,
  FolderTree,
  House,
  Package,
  Palette,
  PawPrint,
  ScrollText,
  Settings2,
  ShieldCheck,
  Signpost,
  Stethoscope,
  Tag,
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
      {
        label: 'Atendimento',
        to: '/atendimento',
        icon: Stethoscope,
        permission: 'clinical.view',
      },
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
    label: 'Estoque e serviços',
    items: [
      {
        label: 'Produtos e serviços',
        to: '/estoque/produtos',
        icon: Package,
        permission: 'products.view',
      },
      {
        label: 'Grupos de produtos',
        to: '/estoque/grupos',
        icon: FolderTree,
        permission: 'catalogs.manage',
      },
      { label: 'Marcas', to: '/estoque/marcas', icon: Tag, permission: 'catalogs.manage' },
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
        icon: ClipboardList,
        permission: 'catalogs.manage',
      },
      {
        label: 'Patologias',
        to: '/cadastros/patologias',
        icon: Activity,
        permission: 'catalogs.manage',
      },
      {
        label: 'Modelos de receita e documento',
        to: '/cadastros/modelos',
        icon: FileText,
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
