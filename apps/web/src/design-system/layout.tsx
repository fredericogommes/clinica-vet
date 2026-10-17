import { clsx } from 'clsx';
import { useId, type ReactNode } from 'react';

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

export function Panel({
  children,
  className,
  labelledBy,
}: {
  children: ReactNode;
  className?: string | undefined;
  /** Id do título que nomeia a região para leitores de tela. */
  labelledBy?: string;
}) {
  return (
    <section
      aria-labelledby={labelledBy}
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

/** Bloco de formulário ou de ficha com título e conteúdo. */
export function Section({
  title,
  description,
  actions,
  children,
  className,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const titleId = useId();
  return (
    <Panel className={className} labelledBy={titleId}>
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2 border-b border-line px-5 py-3.5">
        {/* Ações que não cabem ao lado do título descem para a linha de baixo, no celular. */}
        <div className="min-w-48 flex-1">
          <h2 id={titleId} className="font-display text-[15px] font-semibold text-ink">
            {title}
          </h2>
          {description ? <p className="mt-0.5 text-xs text-ink-muted">{description}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 gap-1">{actions}</div> : null}
      </div>
      <div className="px-5 py-4">{children}</div>
    </Panel>
  );
}

/** Pares rótulo/valor da ficha. Valor ausente aparece como travessão discreto. */
export function Facts({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
      {items.map((item) => (
        <div key={item.label} className="min-w-0">
          <dt className="text-xs text-ink-muted">{item.label}</dt>
          <dd className="mt-0.5 text-sm break-words text-ink">
            {item.value === null || item.value === undefined || item.value === '' ? (
              <span className="text-ink-faint">Não informado</span>
            ) : (
              item.value
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Barra de ações de formulário longo; fica visível no rodapé enquanto se rola a página. */
export function FormActions({ children }: { children: ReactNode }) {
  return (
    <div className="sticky bottom-0 z-10 -mx-4 mt-6 flex flex-wrap justify-end gap-2 border-t border-line bg-canvas/95 px-4 py-3 backdrop-blur sm:-mx-8 sm:px-8">
      {children}
    </div>
  );
}

/** Indicadores em cartões: rótulo, valor em destaque e um detalhe opcional. */
export function Stats({
  items,
  label,
}: {
  items: { label: string; value: ReactNode; detail?: ReactNode }[];
  label: string;
}) {
  return (
    <dl aria-label={label} className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
      {items.map((item) => (
        <div
          key={item.label}
          className="min-w-0 rounded-panel border border-line bg-surface px-4 py-3 shadow-panel"
        >
          <dt className="text-xs text-ink-muted">{item.label}</dt>
          <dd className="mt-1 font-mono text-lg font-medium break-words text-ink tabular-nums">
            {item.value}
          </dd>
          {item.detail ? <dd className="mt-0.5 text-xs text-ink-muted">{item.detail}</dd> : null}
        </div>
      ))}
    </dl>
  );
}
