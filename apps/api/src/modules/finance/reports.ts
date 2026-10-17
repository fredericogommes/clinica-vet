import {
  fromCents,
  toCents,
  type CashFlow,
  type CashFlowQuery,
  type Statement,
  type StatementQuery,
  type StatementRow,
} from '@clinica/contracts';
import { and, eq, gte, inArray, lt, lte, sql, type SQL } from 'drizzle-orm';
import { AppError } from '../../core/errors.js';
import { addDays, addMonths } from '../../core/zoned-time.js';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import type { Database } from '../../db/client.js';
import {
  costCenters,
  financialAccounts,
  financialCategories,
  financialEntries,
} from '../../db/schema.js';
import type { AuthContext } from '../auth/sessions.js';
import type { FinanceService } from './service.js';

const invalid = (path: string, message: string) =>
  new AppError('validation_failed', 'Filtros inválidos.', [{ path, message }]);

/** Meses AAAA-MM de `from` a `to`, inclusive. */
function monthsBetween(from: string, to: string): string[] {
  const months: string[] = [];
  for (let d = `${from}-01`; d.slice(0, 7) <= to; d = addMonths(d, 1)) months.push(d.slice(0, 7));
  return months;
}

const MAX_MONTHS = 24;
const MAX_DAYS = 366;

/** Valor efetivo: o pago quando houver (com juros ou desconto), senão o lançado. */
const value = sql`coalesce(${financialEntries.paidAmount}, ${financialEntries.amount})`;

/**
 * Relatórios do financeiro [p.18]: demonstrativo de resultado com alternador caixa/competência e
 * fluxo de caixa com saldo diário real e previsto. Transferências não são receita nem despesa, mas
 * movem o saldo de cada conta.
 */
export class FinanceReportsService {
  constructor(
    private readonly db: Database,
    private readonly finance: FinanceService,
  ) {}

  async statement(auth: AuthContext, query: StatementQuery): Promise<Statement> {
    const today = await this.finance.today(this.db, auth);
    const from = query.de ?? `${today.slice(0, 4)}-01`;
    const to = query.ate ?? `${today.slice(0, 4)}-12`;
    if (from > to) throw invalid('ate', 'O último mês vem depois do primeiro');
    const months = monthsBetween(from, to);
    if (months.length > MAX_MONTHS) throw invalid('ate', `Escolha até ${String(MAX_MONTHS)} meses`);
    if (query.centro) await this.checkCostCenter(auth, query.centro);

    const caixa = query.regime === 'caixa';
    const date = caixa ? financialEntries.paidOn : financialEntries.competenceDate;
    const start = `${from}-01`;
    const end = addMonths(`${to}-01`, 1);
    const filters: SQL[] = [
      eq(financialEntries.organizationId, auth.organizationId),
      inArray(financialEntries.kind, ['income', 'expense']),
      caixa
        ? eq(financialEntries.status, 'paid')
        : inArray(financialEntries.status, ['open', 'paid']),
      gte(date, start),
      lt(date, end),
    ];
    if (query.centro) filters.push(eq(financialEntries.costCenterId, query.centro));
    const sums = await this.db
      .select({
        categoryId: financialEntries.categoryId,
        kind: financialEntries.kind,
        month: sql<string>`to_char(${date}, 'YYYY-MM')`,
        total: sql<string>`sum(${value})`,
        open: sql<string>`coalesce(sum(${financialEntries.amount}) filter (where ${financialEntries.status} = 'open'), 0)`,
      })
      .from(financialEntries)
      .where(and(...filters))
      .groupBy(financialEntries.categoryId, financialEntries.kind, sql`3`);

    const categories = await this.db
      .select({
        id: financialCategories.id,
        name: financialCategories.name,
        kind: financialCategories.kind,
        parentId: financialCategories.parentId,
      })
      .from(financialCategories)
      .where(eq(financialCategories.organizationId, auth.organizationId))
      .orderBy(financialCategories.name);

    // Centavos por categoria e mês; a categoria-mãe soma as próprias e as das subcategorias.
    const index = new Map(months.map((m, i) => [m, i]));
    const own = new Map<string, number[]>();
    const openIncome = months.map(() => 0);
    const openExpense = months.map(() => 0);
    for (const s of sums) {
      const i = index.get(s.month);
      if (i === undefined) continue;
      const key = s.categoryId ?? `none:${s.kind}`;
      const values = own.get(key) ?? months.map(() => 0);
      values[i] = (values[i] ?? 0) + toCents(Number(s.total));
      own.set(key, values);
      const open = s.kind === 'income' ? openIncome : openExpense;
      open[i] = (open[i] ?? 0) + toCents(Number(s.open));
    }

    const add = (a: number[], b: number[]) => a.map((v, i) => v + (b[i] ?? 0));
    const section = (kind: 'income' | 'expense') => {
      const rows: StatementRow[] = [];
      let totals = months.map(() => 0);
      const toRow = (categoryId: string | null, name: string, depth: number, cents: number[]) => ({
        categoryId,
        name,
        depth,
        values: cents.map(fromCents),
        total: fromCents(cents.reduce((a, b) => a + b, 0)),
      });
      const parents = categories.filter((c) => c.kind === kind && c.parentId === null);
      for (const parent of parents) {
        const children = categories
          .filter((c) => c.parentId === parent.id)
          .map((c) => ({ c, cents: own.get(c.id) }))
          .filter((x): x is { c: typeof x.c; cents: number[] } => x.cents !== undefined);
        const parentOwn = own.get(parent.id);
        if (!parentOwn && children.length === 0) continue;
        const cents = children.reduce(
          (acc, x) => add(acc, x.cents),
          parentOwn ?? months.map(() => 0),
        );
        rows.push(toRow(parent.id, parent.name, 0, cents));
        // A própria categoria-mãe só vira linha à parte quando também tem subcategorias.
        if (parentOwn && children.length > 0) {
          rows.push(toRow(parent.id, `${parent.name} (sem subcategoria)`, 1, parentOwn));
        }
        for (const x of children) rows.push(toRow(x.c.id, x.c.name, 1, x.cents));
        totals = add(totals, cents);
      }
      const orphan = own.get(`none:${kind}`);
      if (orphan) {
        rows.push(toRow(null, 'Sem categoria', 0, orphan));
        totals = add(totals, orphan);
      }
      return { cents: totals, rows };
    };

    const income = section('income');
    const expense = section('expense');
    const line = (cents: number[]) => ({
      values: cents.map(fromCents),
      total: fromCents(cents.reduce((a, b) => a + b, 0)),
    });
    const result = income.cents.map((v, i) => v - (expense.cents[i] ?? 0));
    const open = openIncome.map((v, i) => v - (openExpense[i] ?? 0));
    return {
      regime: query.regime,
      months,
      income: { ...line(income.cents), rows: income.rows },
      expense: { ...line(expense.cents), rows: expense.rows },
      result: line(result),
      open: line(open),
      today,
    };
  }

  async cashFlow(auth: AuthContext, query: CashFlowQuery): Promise<CashFlow> {
    const today = await this.finance.today(this.db, auth);
    const monthStart = `${today.slice(0, 7)}-01`;
    const from = query.de ?? addMonths(monthStart, -2);
    const to = query.ate ?? addDays(addMonths(monthStart, 4), -1);
    if (from > to) throw invalid('ate', 'A data final vem depois da inicial');
    const span = (Date.parse(to) - Date.parse(from)) / 86_400_000 + 1;
    if (span > MAX_DAYS) throw invalid('ate', `Escolha um período de até ${String(MAX_DAYS)} dias`);

    const accountFilter: SQL[] = [eq(financialAccounts.organizationId, auth.organizationId)];
    if (query.conta) accountFilter.push(eq(financialAccounts.id, query.conta));
    const accounts = await this.db
      .select({ id: financialAccounts.id, openingBalance: financialAccounts.openingBalance })
      .from(financialAccounts)
      .where(and(...accountFilter));
    if (query.conta && accounts.length === 0) throw invalid('conta', 'Conta indisponível');

    const base: SQL[] = [eq(financialEntries.organizationId, auth.organizationId)];
    if (query.conta) base.push(eq(financialEntries.accountId, query.conta));
    const signed = (amount: SQL | AnyPgColumn) =>
      sql`case when ${financialEntries.direction} = 'in' then ${amount} else -${amount} end`;

    // Saldo antes do período: real (pago antes) e previsto (também o aberto vencido antes).
    const [before] = await this.db
      .select({
        paid: sql<string>`coalesce(sum(${signed(financialEntries.paidAmount)}) filter (
          where ${financialEntries.status} = 'paid' and ${financialEntries.paidOn} < ${from}), 0)`,
        open: sql<string>`coalesce(sum(${signed(financialEntries.amount)}) filter (
          where ${financialEntries.status} = 'open' and ${financialEntries.dueDate} < ${from}), 0)`,
      })
      .from(financialEntries)
      .where(and(...base));

    const paidRows = await this.db
      .select({
        date: financialEntries.paidOn,
        kind: financialEntries.kind,
        amount: sql<string>`sum(${signed(financialEntries.paidAmount)})`,
      })
      .from(financialEntries)
      .where(
        and(
          ...base,
          eq(financialEntries.status, 'paid'),
          gte(financialEntries.paidOn, from),
          lte(financialEntries.paidOn, to),
        ),
      )
      .groupBy(financialEntries.paidOn, financialEntries.kind);
    const openRows = await this.db
      .select({
        date: financialEntries.dueDate,
        kind: financialEntries.kind,
        amount: sql<string>`sum(${signed(financialEntries.amount)})`,
      })
      .from(financialEntries)
      .where(
        and(
          ...base,
          eq(financialEntries.status, 'open'),
          gte(financialEntries.dueDate, from),
          lte(financialEntries.dueDate, to),
        ),
      )
      .groupBy(financialEntries.dueDate, financialEntries.kind);

    const months = monthsBetween(from.slice(0, 7), to.slice(0, 7)).map((month) => ({
      month,
      income: { paid: 0, open: 0 },
      expense: { paid: 0, open: 0 },
    }));
    const monthIndex = new Map(months.map((m, i) => [m.month, i]));
    const paidByDay = new Map<string, number>();
    const openByDay = new Map<string, number>();
    const bucket = (
      rows: { date: string | null; kind: string; amount: string }[],
      byDay: Map<string, number>,
      field: 'paid' | 'open',
    ) => {
      for (const r of rows) {
        if (!r.date) continue;
        const cents = toCents(Number(r.amount));
        byDay.set(r.date, (byDay.get(r.date) ?? 0) + cents);
        const m = months[monthIndex.get(r.date.slice(0, 7)) ?? -1];
        if (!m || r.kind === 'transfer') continue;
        // Despesa vem com sinal negativo; no gráfico mensal ela é mostrada positiva.
        if (r.kind === 'income') m.income[field] += cents;
        else m.expense[field] -= cents;
      }
    };
    bucket(paidRows, paidByDay, 'paid');
    bucket(openRows, openByDay, 'open');

    const opening =
      accounts.reduce((sum, a) => sum + toCents(a.openingBalance), 0) +
      toCents(Number(before?.paid ?? 0));
    let real = opening;
    let forecast = opening + toCents(Number(before?.open ?? 0));
    const days: CashFlow['days'] = [];
    let realBalance = opening;
    for (let d = from; d <= to; d = addDays(d, 1)) {
      real += paidByDay.get(d) ?? 0;
      forecast += (paidByDay.get(d) ?? 0) + (openByDay.get(d) ?? 0);
      if (d <= today) realBalance = real;
      days.push({
        date: d,
        real: d <= today ? fromCents(real) : null,
        forecast: fromCents(forecast),
      });
    }

    const sum = (pick: (m: (typeof months)[number]) => number) =>
      fromCents(months.reduce((acc, m) => acc + pick(m), 0));
    return {
      from,
      to,
      today,
      months: months.map((m) => ({
        month: m.month,
        income: { paid: fromCents(m.income.paid), open: fromCents(m.income.open) },
        expense: { paid: fromCents(m.expense.paid), open: fromCents(m.expense.open) },
      })),
      days,
      summary: {
        openingBalance: fromCents(opening),
        realBalance: fromCents(realBalance),
        forecastBalance: fromCents(forecast),
        income: { paid: sum((m) => m.income.paid), open: sum((m) => m.income.open) },
        expense: { paid: sum((m) => m.expense.paid), open: sum((m) => m.expense.open) },
      },
    };
  }

  private async checkCostCenter(auth: AuthContext, id: string) {
    const [center] = await this.db
      .select({ id: costCenters.id })
      .from(costCenters)
      .where(and(eq(costCenters.id, id), eq(costCenters.organizationId, auth.organizationId)));
    if (!center) throw invalid('centro', 'Centro de custo indisponível');
  }
}
