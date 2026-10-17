import type { ProductKind, SaleStatus } from '@clinica/contracts';
import { addDays, localToday, startOfMonth } from '../schedule/dates';

export const reportTabs = ['resumo', 'itens', 'lista'] as const;
export type ReportTab = (typeof reportTabs)[number];

/** Filtros da Consulta vendas, lidos da URL pelo roteador. */
export interface ReportSearch {
  tab: ReportTab;
  from: string;
  to: string;
  kind: ProductKind | undefined;
  status: SaleStatus | undefined;
  q: string;
  page: number;
}

/** Período padrão: o mês corrente até hoje. */
export const defaultPeriod = () => {
  const today = localToday();
  return { from: startOfMonth(today), to: today };
};

/** Últimos 365 dias até hoje (12 meses): padrão do ranking de clientes, dentro do limite de um ano. */
export const lastTwelveMonths = () => {
  const today = localToday();
  return { from: addDays(today, -364), to: today };
};
