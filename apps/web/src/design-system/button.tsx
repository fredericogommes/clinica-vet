import { clsx } from 'clsx';
import { LoaderCircle } from 'lucide-react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md';

const variants: Record<Variant, string> = {
  primary: 'bg-sage-600 text-white hover:bg-sage-700 disabled:bg-sage-600/50',
  secondary:
    'bg-surface text-ink border border-line-strong hover:bg-sunken disabled:text-ink-faint',
  ghost: 'text-ink-muted hover:bg-sunken hover:text-ink disabled:text-ink-faint',
  danger: 'bg-danger-600 text-white hover:bg-danger-600/90 disabled:bg-danger-600/50',
};

const sizes: Record<Size, string> = {
  sm: 'h-8 px-3 text-[13px] gap-1.5',
  md: 'h-10 px-4 text-sm gap-2',
};

/** Classes do botão, para links de navegação com aparência de botão (ex. "Novo cliente"). */
export function buttonClasses(variant: Variant = 'primary', size: Size = 'md'): string {
  return clsx(
    'inline-flex shrink-0 items-center justify-center rounded-control font-medium whitespace-nowrap transition-colors disabled:cursor-not-allowed',
    variants[variant],
    sizes[size],
  );
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  icon?: ReactNode;
  /** Mostra indicador e bloqueia novos cliques, evitando envio duplicado. */
  pending?: boolean;
}

export function Button({
  variant = 'primary',
  size = 'md',
  icon,
  pending = false,
  disabled,
  className,
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || pending}
      aria-busy={pending || undefined}
      className={clsx(buttonClasses(variant, size), className)}
      {...rest}
    >
      {pending ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
}
