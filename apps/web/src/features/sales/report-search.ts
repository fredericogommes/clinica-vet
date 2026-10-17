import type { ProductKind, SaleStatus } from '@clinica/contracts';
import { localToday, startOfMonth } from '../schedule/dates';

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
