import * as RadixDialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type { ReactNode } from 'react';

interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer: ReactNode;
}

export function Dialog({ open, onOpenChange, title, description, children, footer }: DialogProps) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-40 bg-ink/30 backdrop-blur-[1px]" />
        <RadixDialog.Content
          className="fixed inset-x-4 top-[8vh] z-50 mx-auto flex max-h-[84vh] max-w-lg flex-col rounded-panel bg-surface shadow-overlay focus:outline-none"
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
          <div className="flex justify-end gap-2 border-t border-line bg-canvas/60 px-5 py-3">
            {footer}
          </div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
