import type { Permission } from '@clinica/contracts';
import {
  Activity,
  ArrowLeftRight,
  HandCoins,
  Landmark,
  ListTree,
  PiggyBank,
  Truck,
  BellRing,
  BarChart3,
  ChartColumn,
  CalendarClock,
  CalendarDays,
  ClipboardList,
  CreditCard,
  Scale,
  TrendingUp,
  Dna,
  FileText,
  FlaskConical,
  FolderTree,
  House,
  Package,
  PackageMinus,
  PackagePlus,
  ClipboardCheck,
  MessageCircle,
  Palette,
  PawPrint,
  Receipt,
  ScrollText,
  Settings2,
  ShieldCheck,
  ShoppingCart,
  SlidersHorizontal,
  Signpost,
  Syringe,
  Stethoscope,
  Tag,
  Users,
  UsersRound,
  type LucideIcon,
  Wallet,
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
    label: 'Vendas',
    items: [
      {
        label: 'Ponto de venda',
        to: '/vendas/pdv',
        icon: ShoppingCart,
        permission: 'sales.manage',
      },
      {
        label: 'Consulta vendas',
        to: '/vendas/consulta',
        icon: BarChart3,
        permission: 'sales.reports',
      },
      {
        label: 'Minhas vendas',
        to: '/vendas/minhas',
        icon: Receipt,
        permission: 'sales.view_own',
      },
      {
        label: 'Movimentos de caixa',
        to: '/vendas/caixas',
        icon: Wallet,
        permission: 'cash.operate',
      },
      {
        label: 'Formas de recebimento',
        to: '/vendas/formas-de-recebimento',
        icon: CreditCard,
        permission: 'sales.configure',
      },
      {
        label: 'Configuração de vendas',
        to: '/vendas/configuracao',
        icon: SlidersHorizontal,
        permission: 'sales.configure',
      },
    ],
  },
  {
    label: 'Financeiro',
    items: [
      { label: 'Lançamentos', to: '/financeiro', icon: ArrowLeftRight, permission: 'finance.view' },
      {
        label: 'Contas a pagar',
        to: '/financeiro/contas-a-pagar',
        icon: HandCoins,
        permission: 'finance.view',
      },
      {
        label: 'Contas a receber',
        to: '/financeiro/contas-a-receber',
        icon: PiggyBank,
        permission: 'finance.view',
      },
      {
        label: 'Conciliação de cartões',
        to: '/financeiro/conciliacao',
        icon: CreditCard,
        permission: 'finance.view',
      },
      {
        label: 'Demonstrativo',
        to: '/financeiro/demonstrativo',
        icon: Scale,
        permission: 'finance.reports',
      },
      {
        label: 'Fluxo de caixa',
        to: '/financeiro/fluxo-de-caixa',
        icon: TrendingUp,
        permission: 'finance.reports',
      },
      {
        label: 'Contas financeiras',
        to: '/financeiro/contas',
        icon: Landmark,
        permission: 'finance.view',
      },
      {
        label: 'Plano de contas',
        to: '/financeiro/plano-de-contas',
        icon: ListTree,
        permission: 'finance.view',
      },
      {
        label: 'Fornecedores',
        to: '/financeiro/fornecedores',
        icon: Truck,
        permission: 'finance.view',
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
        label: 'Compras',
        to: '/estoque/compras',
        icon: PackagePlus,
        permission: 'purchases.view',
      },
      {
        label: 'Outras saídas',
        to: '/estoque/saidas',
        icon: PackageMinus,
        permission: 'inventory.exits',
      },
      {
        label: 'Inventário',
        to: '/estoque/inventario',
        icon: ClipboardCheck,
        permission: 'inventory.counts',
      },
      {
        label: 'Análise de estoque',
        to: '/estoque/analise',
        icon: ChartColumn,
        permission: 'inventory.analysis',
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
      {
        label: 'Vacinação',
        to: '/consultas/vacinacao',
        icon: Syringe,
        permission: 'reports.vaccination',
      },
    ],
  },
  {
    label: 'Mensagens',
    items: [
      {
        label: 'Fila de mensagens',
        to: '/mensagens',
        icon: MessageCircle,
        permission: 'messages.view',
      },
      {
        label: 'Mensagens automáticas',
        to: '/mensagens/automaticas',
        icon: BellRing,
        permission: 'messages.configure',
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
        label: 'Exames',
        to: '/cadastros/exames',
        icon: FlaskConical,
        permission: 'catalogs.manage',
      },
      {
        label: 'Vacinas',
        to: '/cadastros/vacinas',
        icon: Syringe,
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
