import { clsx } from 'clsx';
import type { ReactNode } from 'react';

export function PageHeader({
  area,
  title,
  description,
  actions,
}: {
  area: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <p className="font-mono text-[11px] font-medium tracking-[0.08em] text-sage-600 uppercase">
          {area}
        </p>
        <h1 className="mt-1 font-display text-[26px] leading-tight font-semibold tracking-[-0.01em] text-ink">
          {title}
        </h1>
        {description ? (
          <p className="mt-1 max-w-2xl text-sm text-ink-muted">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </header>
  );
}

export function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <section
      className={clsx('rounded-panel border border-line bg-surface shadow-panel', className)}
    >
      {children}
    </section>
  );
}

type BadgeTone = 'neutral' | 'sage' | 'amber' | 'danger';
const badgeTones: Record<BadgeTone, string> = {
  neutral: 'bg-sunken text-ink-muted',
  sage: 'bg-sage-50 text-sage-700',
  amber: 'bg-amber-50 text-amber-700',
  danger: 'bg-danger-50 text-danger-600',
};

export function Badge({ tone = 'neutral', children }: { tone?: BadgeTone; children: ReactNode }) {
  return (
    <span
      className={clsx(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap',
        badgeTones[tone],
      )}
    >
      {children}
    </span>
  );
}
