import type { StockIndicators, StockSituation } from '@clinica/contracts';
import { and, eq, isNull, sql, type SQL } from 'drizzle-orm';
import type { Executor } from '../../db/client.js';
import { productGroups, products, stockBalances, stockMovements } from '../../db/schema.js';

const DAY = 24 * 60 * 60 * 1000;
/** Janela de consumo: os últimos 90 dias, divididos em três meses. */
export const WINDOW_DAYS = 90;
/** Sem histórico até 60 dias depois da primeira movimentação (ou do cadastro). */
export const NEW_DAYS = 60;
/** Sem mínimo cadastrado, repor quando o saldo dura menos que isso. */
export const REORDER_DAYS = 30;
/** Sem ideal cadastrado, excesso é o que passa de 180 dias de consumo. */
export const EXCESS_DAYS = 180;

export interface AnalysisRow {
  id: string;
  name: string;
  unit: string;
  groupId: string | null;
  group: string | null;
  cost: number | null;
  minStock: number | null;
  idealStock: number | null;
  /** Saldo menos pendência: negativo quando falta. */
  net: number;
  consumed: number;
  lastOutAt: Date | null;
  /** Primeira movimentação na unidade; sem nenhuma, a data do cadastro. */
  since: Date;
}

/** Produtos que controlam estoque, ativos, com saldo e consumo na unidade. */
export async function analysisRows(
  executor: Executor,
  organizationId: string,
  unitId: string,
  now: Date,
  extra: SQL[] = [],
): Promise<AnalysisRow[]> {
  const from = new Date(now.getTime() - WINDOW_DAYS * DAY);
  // Venda e outra saída são negativas, devolução e cancelamento positivos: o consumo é o oposto.
  const flows = executor
    .select({
      productId: stockMovements.productId,
      consumed: sql<
        string | null
      >`-sum(case when ${stockMovements.kind} in ('sale', 'sale_return', 'exit', 'exit_cancel') and ${stockMovements.createdAt} >= ${from} then ${stockMovements.quantity} else 0 end)`.as(
        'consumed',
      ),
      lastOutAt:
        sql<Date | null>`max(case when ${stockMovements.kind} in ('sale', 'exit') then ${stockMovements.createdAt} end)`.as(
          'last_out_at',
        ),
      firstAt: sql<Date | null>`min(${stockMovements.createdAt})`.as('first_at'),
    })
    .from(stockMovements)
    .where(eq(stockMovements.unitId, unitId))
    .groupBy(stockMovements.productId)
    .as('flows');
  const rows = await executor
    .select({
      id: products.id,
      name: products.name,
      unit: products.unit,
      groupId: products.groupId,
      group: productGroups.name,
      cost: products.cost,
      minStock: products.minStock,
      idealStock: products.idealStock,
      onHand: stockBalances.onHand,
      shortfall: stockBalances.shortfall,
      consumed: flows.consumed,
      lastOutAt: flows.lastOutAt,
      firstAt: flows.firstAt,
      createdAt: products.createdAt,
    })
    .from(products)
    .leftJoin(productGroups, eq(productGroups.id, products.groupId))
    .leftJoin(
      stockBalances,
      and(eq(stockBalances.productId, products.id), eq(stockBalances.unitId, unitId)),
    )
    .leftJoin(flows, eq(flows.productId, products.id))
    .where(
      and(
        eq(products.organizationId, organizationId),
        eq(products.kind, 'product'),
        eq(products.tracksStock, true),
        isNull(products.archivedAt),
        ...extra,
      ),
    )
    .orderBy(products.name);
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    unit: r.unit,
    groupId: r.groupId,
    group: r.group,
    cost: r.cost,
    minStock: r.minStock,
    idealStock: r.idealStock,
    net: round3((r.onHand ?? 0) - (r.shortfall ?? 0)),
    // A devolução de uma venda anterior à janela não deixa o consumo negativo.
    consumed: Math.max(0, round3(Number(r.consumed ?? 0))),
    lastOutAt: r.lastOutAt ? new Date(r.lastOutAt) : null,
    since: r.firstAt ? new Date(r.firstAt) : r.createdAt,
  }));
}

const round3 = (v: number) => Math.round(v * 1000) / 1000;
const cents = (v: number) => Math.round(v * 100) / 100;

function situationOf(row: AnalysisRow, monthly: number, duration: number | null, now: Date) {
  const { net, minStock, idealStock } = row;
  if (net < 0) return 'repor';
  if (minStock !== null && net <= minStock) return 'repor';
  if (monthly > 0 && duration !== null && duration < REORDER_DAYS) return 'repor';
  if (now.getTime() - row.since.getTime() < NEW_DAYS * DAY) return 'novos';
  if (net <= 0) return null;
  if (monthly === 0) return 'parado';
  if (idealStock !== null ? net > idealStock : duration !== null && duration > EXCESS_DAYS) {
    return 'excesso';
  }
  return 'adequado';
}

/** Situação e indicadores de um produto; os valores em R$ só para quem vê custo. */
export function indicatorsOf(row: AnalysisRow, now: Date, seeCost: boolean): StockIndicators {
  const monthly = round3(row.consumed / (WINDOW_DAYS / 30));
  const duration = monthly > 0 ? Math.max(0, Math.floor(row.net / (monthly / 30))) : null;
  const situation: StockSituation | null = situationOf(row, monthly, duration, now);
  const cost = row.cost ?? 0;
  const excess =
    situation === 'excesso'
      ? round3(row.net - (row.idealStock ?? (monthly * EXCESS_DAYS) / 30))
      : null;
  return {
    situation,
    monthlyConsumption: monthly,
    durationDays: duration,
    excess,
    totalCost: seeCost ? cents(Math.max(0, row.net) * cost) : null,
    excessCost: seeCost && excess !== null ? cents(excess * cost) : null,
    lastOutAt: row.lastOutAt?.toISOString() ?? null,
  };
}

/** Indicadores de um produto só, para a ficha. */
export async function productIndicators(
  executor: Executor,
  organizationId: string,
  unitId: string,
  productId: string,
  now: Date,
  seeCost: boolean,
): Promise<StockIndicators> {
  const [row] = await analysisRows(executor, organizationId, unitId, now, [
    eq(products.id, productId),
  ]);
  if (!row) {
    return {
      situation: null,
      monthlyConsumption: 0,
      durationDays: null,
      excess: null,
      totalCost: seeCost ? 0 : null,
      excessCost: null,
      lastOutAt: null,
    };
  }
  return indicatorsOf(row, now, seeCost);
}
