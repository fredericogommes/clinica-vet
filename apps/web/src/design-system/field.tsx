import { clsx } from 'clsx';
import {
  forwardRef,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';

const controlClass =
  'block w-full rounded-control border bg-surface px-3 h-10 text-sm text-ink placeholder:text-ink-faint transition-colors focus:outline-none focus:ring-2 focus:ring-sage-500/30 disabled:bg-sunken disabled:text-ink-muted';

interface FieldShellProps {
  label: string;
  hint?: string | undefined;
  error?: string | undefined;
  children: (props: { id: string; describedBy: string | undefined; invalid: boolean }) => ReactNode;
}

/** Rótulo, dica e erro ligados ao controle por id e aria-describedby. */
export function FieldShell({ label, hint, error, children }: FieldShellProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-[13px] font-medium text-ink">
        {label}
      </label>
      {children({ id, describedBy, invalid: Boolean(error) })}
      {hint && !error ? (
        <p id={hintId} className="text-xs text-ink-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} role="alert" className="text-xs font-medium text-danger-600">
          {error}
        </p>
      ) : null}
    </div>
  );
}

interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: string | undefined;
  error?: string | undefined;
}

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { label, hint, error, className, ...rest },
  ref,
) {
  return (
    <FieldShell label={label} hint={hint} error={error}>
      {({ id, describedBy, invalid }) => (
        <input
          ref={ref}
          id={id}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          className={clsx(
            controlClass,
            invalid ? 'border-danger-600' : 'border-line-strong',
            className,
          )}
          {...rest}
        />
      )}
    </FieldShell>
  );
});

interface SelectFieldProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  hint?: string | undefined;
  error?: string | undefined;
  options: { value: string; label: string }[];
  placeholder?: string;
}

export const SelectField = forwardRef<HTMLSelectElement, SelectFieldProps>(function SelectField(
  { label, hint, error, options, placeholder, className, ...rest },
  ref,
) {
  return (
    <FieldShell label={label} hint={hint} error={error}>
      {({ id, describedBy, invalid }) => (
        <select
          ref={ref}
          id={id}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          className={clsx(
            controlClass,
            'pr-8',
            invalid ? 'border-danger-600' : 'border-line-strong',
            className,
          )}
          {...rest}
        >
          {placeholder ? <option value="">{placeholder}</option> : null}
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      )}
    </FieldShell>
  );
});

interface TextareaFieldProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
  hint?: string | undefined;
  error?: string | undefined;
}

export const TextareaField = forwardRef<HTMLTextAreaElement, TextareaFieldProps>(
  function TextareaField({ label, hint, error, className, rows = 3, ...rest }, ref) {
    return (
      <FieldShell label={label} hint={hint} error={error}>
        {({ id, describedBy, invalid }) => (
          <textarea
            ref={ref}
            id={id}
            rows={rows}
            aria-describedby={describedBy}
            aria-invalid={invalid || undefined}
            className={clsx(
              controlClass,
              'h-auto py-2 leading-relaxed',
              invalid ? 'border-danger-600' : 'border-line-strong',
              className,
            )}
            {...rest}
          />
        )}
      </FieldShell>
    );
  },
);

interface SegmentedProps<T extends string> {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}

/** Escolha exclusiva entre poucas opções, com rádios nativos para teclado e leitor de tela. */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: SegmentedProps<T>) {
  const name = useId();
  return (
    <fieldset className="space-y-1.5">
      <legend className="text-[13px] font-medium text-ink">{label}</legend>
      <div className="inline-flex flex-wrap rounded-control border border-line-strong bg-sunken p-0.5">
        {options.map((o) => (
          <label
            key={o.value}
            className={clsx(
              'cursor-pointer rounded-[6px] px-3 py-1.5 text-sm whitespace-nowrap transition-colors has-focus-visible:ring-2 has-focus-visible:ring-sage-500/40',
              value === o.value ? 'bg-surface font-medium text-ink shadow-panel' : 'text-ink-muted',
            )}
          >
            <input
              type="radio"
              name={name}
              value={o.value}
              checked={value === o.value}
              onChange={() => {
                onChange(o.value);
              }}
              className="sr-only"
            />
            {o.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** Campo de busca com ícone; o valor é controlado pela página (normalmente pela URL). */
export const SearchField = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement> & { label: string; icon: ReactNode }
>(function SearchField({ label, icon, className, ...rest }, ref) {
  return (
    <div className={clsx('relative', className)}>
      <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-ink-faint">
        {icon}
      </span>
      <input
        ref={ref}
        type="search"
        aria-label={label}
        className={clsx(controlClass, 'border-line-strong pl-9')}
        {...rest}
      />
    </div>
  );
});
