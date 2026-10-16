import { CircleAlert, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from './button';

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      <div className="mb-3 flex size-10 items-center justify-center rounded-full bg-sage-50">
        <Icon className="size-5 text-sage-600" aria-hidden />
      </div>
      <p className="font-medium text-ink">{title}</p>
      <p className="mt-1 max-w-sm text-sm text-ink-muted">{description}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center px-6 py-14 text-center">
      <CircleAlert className="mb-3 size-6 text-danger-600" aria-hidden />
      <p className="font-medium text-ink">Não foi possível carregar</p>
      <p className="mt-1 max-w-sm text-sm text-ink-muted">{message}</p>
      <Button variant="secondary" size="sm" className="mt-4" onClick={onRetry}>
        Tentar de novo
      </Button>
    </div>
  );
}

export function SkeletonRows({ rows = 5, columns = 4 }: { rows?: number; columns?: number }) {
  return (
    <div aria-busy="true" aria-label="Carregando" className="divide-y divide-line">
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="flex gap-6 px-4 py-3.5">
          {Array.from({ length: columns }, (_, c) => (
            <div key={c} className="h-3.5 flex-1 animate-pulse rounded bg-sunken" />
          ))}
        </div>
      ))}
    </div>
  );
}
