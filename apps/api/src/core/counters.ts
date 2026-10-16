import { sql } from 'drizzle-orm';
import type { Executor } from '../db/client.js';

/**
 * Próximo número de um contador da organização (ex. código da ficha). O upsert trava a linha
 * do contador até o fim da transação, então dois cadastros simultâneos nunca recebem o mesmo código.
 */
export async function nextCounter(
  tx: Executor,
  organizationId: string,
  name: string,
): Promise<number> {
  const result = await tx.execute<{ value: number }>(sql`
    insert into organization_counters (organization_id, name, value)
    values (${organizationId}, ${name}, 1)
    on conflict (organization_id, name) do update set value = organization_counters.value + 1
    returning value`);
  const value = result.rows[0]?.value;
  if (value === undefined) throw new Error(`Contador ${name} não retornou valor.`);
  return value;
}
