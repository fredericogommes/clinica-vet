import {
  fromMilli,
  legacyLotCode,
  lotExpiringDays,
  toMilli,
  type LotExpiryState,
} from '@clinica/contracts';
import { and, asc, eq, gt, inArray, sql } from 'drizzle-orm';
import { conflict } from '../../core/errors.js';
import { newId } from '../../core/ids.js';
import { addDays, instantToZoned } from '../../core/zoned-time.js';
import type { Executor } from '../../db/client.js';
import { stockBalances, stockLots } from '../../db/schema.js';
import { unitTimeZone } from '../scheduling/availability.js';

/** Data de hoje no fuso da unidade: a validade vence ao fim do dia impresso na embalagem. */
export async function unitToday(executor: Executor, unitId: string, now: Date): Promise<string> {
  return instantToZoned(now, await unitTimeZone(executor, unitId)).date;
}

export function expiryState(expiresOn: string | null, today: string): LotExpiryState {
  if (expiresOn === null) return 'ok';
  if (expiresOn < today) return 'expired';
  return expiresOn <= addDays(today, lotExpiringDays) ? 'expiring' : 'ok';
}

/** Ordem de saída: vence antes, sai antes; o lote sem validade fica por último [RN-32]. */
export const fefo = [
  sql`${stockLots.expiresOn} asc nulls last`,
  asc(stockLots.createdAt),
  asc(stockLots.id),
];

/**
 * Por produto, a validade mais antiga entre os lotes com saldo e quanto do saldo está vencido.
 * Produtos sem lote com saldo ficam de fora do mapa.
 */
export async function lotExpiry(
  executor: Executor,
  unitId: string,
  productIds: string[],
  today: string,
): Promise<Map<string, { oldestExpiry: string | null; expired: number }>> {
  if (productIds.length === 0) return new Map();
  const rows = await executor
    .select({
      productId: stockLots.productId,
      oldest: sql<string | null>`min(${stockLots.expiresOn})`,
      expired: sql<string>`coalesce(sum(${stockLots.onHand}) filter (where ${stockLots.expiresOn} < ${today}), 0)`,
    })
    .from(stockLots)
    .where(
      and(
        eq(stockLots.unitId, unitId),
        inArray(stockLots.productId, productIds),
        gt(stockLots.onHand, 0),
      ),
    )
    .groupBy(stockLots.productId);
  return new Map(
    rows.map((r) => [
      r.productId,
      { oldestExpiry: r.oldest, expired: fromMilli(toMilli(Number(r.expired))) },
    ]),
  );
}

/** Lote "SEM LOTE" do produto na unidade, criado na primeira vez. */
export async function legacyLot(
  tx: Executor,
  scope: { organizationId: string; unitId: string },
  productId: string,
): Promise<string> {
  await tx
    .insert(stockLots)
    .values({ id: newId(), ...scope, productId, code: legacyLotCode, expiresOn: null })
    .onConflictDoNothing();
  const [lot] = await tx
    .select({ id: stockLots.id })
    .from(stockLots)
    .where(
      and(
        eq(stockLots.unitId, scope.unitId),
        eq(stockLots.productId, productId),
        eq(stockLots.code, legacyLotCode),
      ),
    );
  if (!lot) throw new Error('Lote SEM LOTE não encontrado');
  return lot.id;
}

/**
 * Liga ou desliga o controle de lote do produto, já com o saldo travado. Ao ligar, o saldo de
 * cada unidade vira o lote "SEM LOTE", sem validade, que sai por último. Desligar com saldo em
 * lote perderia o rastreio, então só vale depois de zerar os lotes pela contagem.
 */
export async function changeLotTracking(
  tx: Executor,
  organizationId: string,
  productId: string,
  enable: boolean,
): Promise<void> {
  const balances = await tx
    .select()
    .from(stockBalances)
    .where(eq(stockBalances.productId, productId))
    .orderBy(asc(stockBalances.unitId))
    .for('update');
  if (!enable) {
    const [left] = await tx
      .select({ id: stockLots.id })
      .from(stockLots)
      .where(and(eq(stockLots.productId, productId), gt(stockLots.onHand, 0)))
      .limit(1);
    if (left) {
      throw conflict(
        'Ainda há saldo em lotes deste produto. Registre a contagem zerada de cada lote antes de desligar o controle de lote ou de estoque.',
      );
    }
    return;
  }
  for (const b of balances) {
    if (toMilli(b.onHand) === 0) continue;
    const id = await legacyLot(tx, { organizationId, unitId: b.unitId }, productId);
    await tx.update(stockLots).set({ onHand: b.onHand }).where(eq(stockLots.id, id));
  }
}
