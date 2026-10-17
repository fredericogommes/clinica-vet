import { z } from 'zod';
import type { Permission } from './permissions.js';
import { saleUnits } from './products.js';

/** Widgets da aba Principal do painel [p.3], na ordem padrão. */
export const dashboardWidgets = [
  'patients_by_month',
  'patients_by_year',
  'consultations_by_month',
  'recent_encounters',
  'recent_patients',
  'client_lifecycle',
  'low_stock',
  'recent_logins',
] as const;
export type DashboardWidget = (typeof dashboardWidgets)[number];

/** Chave que libera cada widget para o perfil; a montagem do usuário só escolhe entre os liberados. */
export const dashboardWidgetPermissions: Record<DashboardWidget, Permission> = {
  patients_by_month: 'dashboard.patients_growth',
  patients_by_year: 'dashboard.patients_growth',
  consultations_by_month: 'dashboard.consultations',
  recent_encounters: 'dashboard.recent_encounters',
  recent_patients: 'dashboard.recent_patients',
  client_lifecycle: 'dashboard.client_lifecycle',
  low_stock: 'dashboard.low_stock',
  recent_logins: 'dashboard.recent_logins',
};

export const dashboardWidgetLabels: Record<DashboardWidget, string> = {
  patients_by_month: 'Animais por mês',
  patients_by_year: 'Animais por ano',
  consultations_by_month: 'Consultas por mês',
  recent_encounters: 'Últimos atendimentos',
  recent_patients: 'Últimos animais cadastrados',
  client_lifecycle: 'Ciclo de vida dos clientes',
  low_stock: 'Estoque abaixo do mínimo',
  recent_logins: 'Últimos acessos',
};

/** Cliente "ativo" teve venda ou atendimento até 180 dias antes; "precisa de atenção", até 365. */
export const clientActiveDays = 180;
export const clientAttentionDays = 365;

/** Montagem do painel pelo usuário: ordem e widgets ligados [p.3]. */
export const dashboardLayoutSchema = z.object({
  widgets: z
    .array(z.object({ id: z.enum(dashboardWidgets), visible: z.boolean() }))
    .max(dashboardWidgets.length)
    .refine((list) => new Set(list.map((w) => w.id)).size === list.length, {
      message: 'Widget repetido na montagem do painel',
    }),
});
export type DashboardLayout = z.infer<typeof dashboardLayoutSchema>;

const month = z.string().regex(/^\d{4}-\d{2}$/);
const monthCount = z.object({ month, count: z.number().int() });

/** Indicadores da base e da agenda, sem valores financeiros. */
export const baseIndicatorsSchema = z.object({
  /** Animais vivos e não arquivados. */
  patients: z.number().int(),
  /** Responsáveis não arquivados. */
  clients: z.number().int(),
  /** Médias do mês na agenda da unidade, em minutos; nulas sem marcos registrados. */
  averageWaitMinutes: z.number().int().nullable(),
  averageServiceMinutes: z.number().int().nullable(),
  /** Anexos da ficha clínica guardados. */
  files: z.object({ count: z.number().int(), bytes: z.number().int() }),
});

/** Indicadores de venda do mês da unidade, pela data da venda. */
export const salesIndicatorsSchema = z.object({
  net: z.number(),
  discountPercent: z.number(),
  averageTicket: z.number(),
  /** Vendas em aberto da unidade (de qualquer data) menos o que já foi recebido delas. */
  clientDebts: z.number(),
});

export const dashboardSchema = z.object({
  /** Mês corrente no fuso da unidade (AAAA-MM). */
  month,
  /** Widgets liberados ao perfil, na ordem do usuário; os desligados vêm com visible false. */
  layout: dashboardLayoutSchema.shape.widgets,
  indicators: z.object({
    base: baseIndicatorsSchema.nullable(),
    sales: salesIndicatorsSchema.nullable(),
  }),
  /** Dados só dos widgets liberados e ligados. */
  data: z.object({
    patientsByMonth: z.array(monthCount).optional(),
    patientsByYear: z
      .array(z.object({ year: z.number().int(), added: z.number().int(), total: z.number().int() }))
      .optional(),
    consultationsByMonth: z.array(monthCount).optional(),
    recentEncounters: z
      .array(
        z.object({
          eventId: z.uuid(),
          occurredAt: z.iso.datetime({ offset: true }),
          patientId: z.uuid(),
          patientName: z.string(),
          clientId: z.uuid(),
          clientName: z.string(),
          professionalName: z.string(),
          typeName: z.string().nullable(),
        }),
      )
      .optional(),
    recentPatients: z
      .array(
        z.object({
          patientId: z.uuid(),
          code: z.number().int(),
          name: z.string(),
          speciesName: z.string().nullable(),
          clientId: z.uuid(),
          clientName: z.string(),
          createdAt: z.iso.datetime({ offset: true }),
        }),
      )
      .optional(),
    clientLifecycle: z
      .array(z.object({ month, active: z.number().int(), attention: z.number().int() }))
      .optional(),
    lowStock: z
      .array(
        z.object({
          productId: z.uuid(),
          code: z.number().int(),
          name: z.string(),
          unit: z.enum(saleUnits),
          onHand: z.number(),
          minStock: z.number(),
        }),
      )
      .optional(),
    recentLogins: z
      .array(
        z.object({
          userId: z.uuid(),
          name: z.string(),
          at: z.iso.datetime({ offset: true }),
        }),
      )
      .optional(),
  }),
});
export type Dashboard = z.infer<typeof dashboardSchema>;
