import * as RadixToast from '@radix-ui/react-toast';
import { clsx } from 'clsx';
import { CircleAlert, CircleCheck, X } from 'lucide-react';
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';

type Tone = 'success' | 'error';
interface ToastItem {
  id: number;
  tone: Tone;
  message: string;
}

const ToastContext = createContext<((tone: Tone, message: string) => void) | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const notify = useCallback((tone: Tone, message: string) => {
    setItems((current) => [...current, { id: Date.now() + Math.random(), tone, message }]);
  }, []);

  return (
    <ToastContext.Provider value={notify}>
      <RadixToast.Provider swipeDirection="right" duration={5000} label="Aviso">
        {children}
        {items.map((item) => (
          <RadixToast.Root
            key={item.id}
            type={item.tone === 'error' ? 'foreground' : 'background'}
            onOpenChange={(open) => {
              if (!open) setItems((current) => current.filter((i) => i.id !== item.id));
            }}
            className={clsx(
              'flex items-start gap-3 rounded-panel border bg-surface px-4 py-3 shadow-overlay',
              item.tone === 'error' ? 'border-danger-600/30' : 'border-line',
            )}
          >
            {item.tone === 'error' ? (
              <CircleAlert className="mt-0.5 size-4 shrink-0 text-danger-600" aria-hidden />
            ) : (
              <CircleCheck className="mt-0.5 size-4 shrink-0 text-success-600" aria-hidden />
            )}
            <RadixToast.Description className="flex-1 text-sm text-ink">
              {item.message}
            </RadixToast.Description>
            <RadixToast.Close aria-label="Fechar aviso" className="text-ink-faint hover:text-ink">
              <X className="size-4" aria-hidden />
            </RadixToast.Close>
          </RadixToast.Root>
        ))}
        <RadixToast.Viewport
          label="Avisos ({hotkey})"
          className="fixed right-4 bottom-4 z-[60] flex w-[min(380px,calc(100vw-2rem))] flex-col gap-2 outline-none"
        />
      </RadixToast.Provider>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const notify = useContext(ToastContext);
  if (!notify) throw new Error('useToast fora do ToastProvider');
  return {
    success: (message: string) => {
      notify('success', message);
    },
    error: (message: string) => {
      notify('error', message);
    },
  };
}
