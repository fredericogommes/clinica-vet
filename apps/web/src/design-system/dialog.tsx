import * as RadixDialog from '@radix-ui/react-dialog';
import { clsx } from 'clsx';
import { X } from 'lucide-react';
import type { ReactNode } from 'react';

interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer: ReactNode;
  /** "lg" para formulários longos, como o atendimento. */
  size?: 'md' | 'lg';
}

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  size = 'md',
}: DialogProps) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-40 bg-ink/30 backdrop-blur-[1px]" />
        <RadixDialog.Content
          className={clsx(
            'fixed inset-x-4 z-50 mx-auto flex flex-col rounded-panel bg-surface shadow-overlay focus:outline-none',
            size === 'lg' ? 'top-[4vh] max-h-[92vh] max-w-3xl' : 'top-[8vh] max-h-[84vh] max-w-lg',
          )}
          {...(description ? {} : { 'aria-describedby': undefined })}
        >
          <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
            <div>
              <RadixDialog.Title className="font-display text-lg font-semibold text-ink">
                {title}
              </RadixDialog.Title>
              {description ? (
                <RadixDialog.Description className="mt-0.5 text-sm text-ink-muted">
                  {description}
                </RadixDialog.Description>
              ) : null}
            </div>
            <RadixDialog.Close
              className="rounded-control p-1 text-ink-muted hover:bg-sunken hover:text-ink"
              aria-label="Fechar"
            >
              <X className="size-4" aria-hidden />
            </RadixDialog.Close>
          </div>
          <div className="overflow-y-auto px-5 py-4">{children}</div>
          <div className="flex flex-wrap justify-end gap-2 border-t border-line bg-canvas/60 px-5 py-3">
            {footer}
          </div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
