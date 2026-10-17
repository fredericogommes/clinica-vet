import {
  entryListSchema,
  financeOptionsSchema,
  financialAccountSchema,
  financialCategorySchema,
  supplierSchema,
  type FinancialCategory,
} from '@clinica/contracts';
import { keepPreviousData, queryOptions } from '@tanstack/react-query';
import { z } from 'zod';
import { api } from '../../lib/api';

export const entrySituations = ['todos', 'abertos', 'pagos', 'vencidos', 'cancelados'] as const;
export type EntrySituation = (typeof entrySituations)[number];
export const entryTypes = ['todos', 'receitas', 'despesas', 'transferencias'] as const;
export type EntryType = (typeof entryTypes)[number];

/** Filtros do extrato, como ficam na URL. */
export interface EntrySearch {
  de: string | undefined;
  ate: string | undefined;
  conta: string | undefined;
  categoria: string | undefined;
  situacao: EntrySituation;
  tipo: EntryType;
  q: string;
  page: number;
}

export const ENTRY_PAGE_SIZE = 50;

export const financeOptionsQuery = queryOptions({
  queryKey: ['finance', 'options'],
  queryFn: () => api('GET', '/finance/options', financeOptionsSchema),
});

export const entriesQuery = (s: EntrySearch) =>
  queryOptions({
    queryKey: ['finance', 'entries', s],
    queryFn: () => {
      const params = new URLSearchParams({
        situacao: s.situacao,
        tipo: s.tipo,
        page: String(s.page),
        pageSize: String(ENTRY_PAGE_SIZE),
      });
      for (const [key, value] of [
        ['de', s.de],
        ['ate', s.ate],
        ['conta', s.conta],
        ['categoria', s.categoria],
        ['q', s.q],
      ] as const) {
        if (value) params.set(key, value);
      }
      return api('GET', `/finance/entries?${params.toString()}`, entryListSchema);
    },
    placeholderData: keepPreviousData,
  });

export const accountsQuery = queryOptions({
  queryKey: ['finance', 'accounts'],
  queryFn: () => api('GET', '/finance/accounts', z.array(financialAccountSchema)),
});

export const categoriesQuery = queryOptions({
  queryKey: ['finance', 'categories'],
  queryFn: () => api('GET', '/finance/categories', z.array(financialCategorySchema)),
});

export const suppliersQuery = queryOptions({
  queryKey: ['finance', 'suppliers'],
  queryFn: () => api('GET', '/finance/suppliers', z.array(supplierSchema)),
});

/** Nome com a categoria-mãe, para os selects: "Gastos gerais › Aluguel". */
export function categoryLabel(c: FinancialCategory, all: FinancialCategory[]): string {
  const parent = c.parentId ? all.find((p) => p.id === c.parentId) : undefined;
  return parent ? `${parent.name} › ${c.name}` : c.name;
}

/** Categorias em ordem de árvore: cada mãe seguida das suas filhas. */
export function categoryTree(all: FinancialCategory[]): FinancialCategory[] {
  const roots = all.filter((c) => !c.parentId);
  return roots.flatMap((r) => [r, ...all.filter((c) => c.parentId === r.id)]);
}
