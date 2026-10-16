import { clsx } from 'clsx';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from './button';

export interface Column<T> {
  header: string;
  cell: (row: T) => ReactNode;
  className?: string;
  /** Esconde a coluna em telas estreitas; a informação essencial deve ficar nas demais. */
  hideOnMobile?: boolean;
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  caption,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  caption: string;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-line">
            {columns.map((c) => (
              <th
                key={c.header}
                scope="col"
                className={clsx(
                  'px-4 py-2.5 text-xs font-medium text-ink-muted',
                  c.hideOnMobile && 'hidden md:table-cell',
                  c.className,
                )}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((row) => (
            <tr key={rowKey(row)} className="hover:bg-canvas/70">
              {columns.map((c) => (
                <td
                  key={c.header}
                  className={clsx(
                    'px-4 py-3 align-middle',
                    c.hideOnMobile && 'hidden md:table-cell',
                    c.className,
                  )}
                >
                  {c.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(total, page * pageSize);
  return (
    <nav
      aria-label="Paginação"
      className="flex items-center justify-between border-t border-line px-4 py-2.5"
    >
      <p className="text-xs text-ink-muted">
        <span className="font-mono">
          {first}–{last}
        </span>{' '}
        de <span className="font-mono">{total}</span>
      </p>
      <div className="flex gap-1">
        <Button
          variant="ghost"
          size="sm"
          aria-label="Página anterior"
          disabled={page <= 1}
          onClick={() => {
            onPageChange(page - 1);
          }}
          icon={<ChevronLeft className="size-4" aria-hidden />}
        />
        <Button
          variant="ghost"
          size="sm"
          aria-label="Próxima página"
          disabled={page >= pages}
          onClick={() => {
            onPageChange(page + 1);
          }}
          icon={<ChevronRight className="size-4" aria-hidden />}
        />
      </div>
    </nav>
  );
}
