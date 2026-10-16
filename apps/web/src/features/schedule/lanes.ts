import { toMinutes } from '@clinica/contracts';

export interface Placed<T> {
  item: T;
  lane: number;
  lanes: number;
}

/**
 * Distribui blocos sobrepostos em colunas lado a lado. Cada grupo de blocos que se tocam divide
 * a largura pelo número de colunas que precisou.
 */
export function placeInLanes<T extends { start: string; end: string }>(items: T[]): Placed<T>[] {
  const sorted = items.toSorted(
    (a, b) => toMinutes(a.start) - toMinutes(b.start) || toMinutes(b.end) - toMinutes(a.end),
  );
  const out: Placed<T>[] = [];
  let group: Placed<T>[] = [];
  let laneEnds: number[] = [];
  let groupEnd = -1;
  const flush = () => {
    for (const p of group) p.lanes = laneEnds.length;
    out.push(...group);
    group = [];
    laneEnds = [];
  };
  for (const item of sorted) {
    const start = toMinutes(item.start);
    const end = toMinutes(item.end);
    if (start >= groupEnd) flush();
    let lane = laneEnds.findIndex((e) => e <= start);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(end);
    } else {
      laneEnds[lane] = end;
    }
    group.push({ item, lane, lanes: 1 });
    groupEnd = Math.max(groupEnd, end);
  }
  flush();
  return out;
}
