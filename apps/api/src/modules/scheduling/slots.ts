/**
 * Motor de horários livres [RN-12]. Funções puras sobre minutos do dia local, para que a regra
 * seja testada sem banco: disponibilidade = escala ∩ funcionamento; horário livre = início no
 * passo da grade cuja duração inteira cabe numa faixa disponível sem tocar em ocupação.
 */

export interface Range {
  start: number;
  end: number;
}

/** Ordena e funde faixas que se tocam ou se sobrepõem. */
export function normalize(ranges: readonly Range[]): Range[] {
  const sorted = ranges.filter((r) => r.end > r.start).toSorted((a, b) => a.start - b.start);
  const out: Range[] = [];
  for (const r of sorted) {
    const last = out.at(-1);
    if (last && r.start <= last.end) last.end = Math.max(last.end, r.end);
    else out.push({ ...r });
  }
  return out;
}

export function intersect(a: readonly Range[], b: readonly Range[]): Range[] {
  const out: Range[] = [];
  for (const x of normalize(a)) {
    for (const y of normalize(b)) {
      const start = Math.max(x.start, y.start);
      const end = Math.min(x.end, y.end);
      if (end > start) out.push({ start, end });
    }
  }
  return normalize(out);
}

export interface FreeSlotsInput {
  /** Faixas em que o profissional atende no dia (já cruzadas com o funcionamento). */
  available: readonly Range[];
  /** Agendamentos ativos do profissional no dia. */
  busy: readonly Range[];
  duration: number;
  step: number;
  /** Primeiro minuto aceitável (agora, quando o dia é hoje). */
  notBefore?: number;
}

export function freeSlots({ available, busy, duration, step, notBefore = 0 }: FreeSlotsInput) {
  const occupied = normalize(busy);
  const starts: number[] = [];
  for (const range of normalize(available)) {
    // Alinha à grade absoluta (00:00, 00:15…), não ao início da faixa.
    let start = Math.ceil(Math.max(range.start, notBefore) / step) * step;
    for (; start + duration <= range.end; start += step) {
      const end = start + duration;
      if (!occupied.some((b) => b.start < end && start < b.end)) starts.push(start);
    }
  }
  return starts;
}

/** A faixa [start, start + duration) cabe inteira numa das faixas disponíveis? */
export function fitsIn(available: readonly Range[], start: number, duration: number): boolean {
  return normalize(available).some((r) => r.start <= start && start + duration <= r.end);
}
