import { clsx } from 'clsx';
import { useRef, type KeyboardEvent } from 'react';

/**
 * Abas de uma página. As setas trocam de aba, como pede o padrão de abas da WAI-ARIA; o painel
 * fica com a página, que o rotula com `tabPanelProps`.
 */
export function Tabs<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  const refs = useRef(new Map<T, HTMLButtonElement>());
  const move = (event: KeyboardEvent, step: number) => {
    event.preventDefault();
    const index = options.findIndex((o) => o.value === value);
    const next = options[(index + step + options.length) % options.length];
    if (!next) return;
    onChange(next.value);
    refs.current.get(next.value)?.focus();
  };
  return (
    <div
      role="tablist"
      aria-label={label}
      className="flex gap-5 overflow-x-auto border-b border-line"
      onKeyDown={(event) => {
        if (event.key === 'ArrowRight') move(event, 1);
        if (event.key === 'ArrowLeft') move(event, -1);
      }}
    >
      {options.map((o) => (
        <button
          key={o.value}
          ref={(el) => {
            if (el) refs.current.set(o.value, el);
          }}
          type="button"
          role="tab"
          id={`tab-${o.value}`}
          aria-selected={value === o.value}
          aria-controls={`panel-${o.value}`}
          tabIndex={value === o.value ? 0 : -1}
          onClick={() => {
            onChange(o.value);
          }}
          className={clsx(
            '-mb-px shrink-0 border-b-2 pb-2.5 text-sm font-medium whitespace-nowrap',
            value === o.value
              ? 'border-sage-600 text-ink'
              : 'border-transparent text-ink-muted hover:text-ink',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export const tabPanelProps = (value: string) => ({
  role: 'tabpanel' as const,
  id: `panel-${value}`,
  'aria-labelledby': `tab-${value}`,
});
