import * as RadixCheckbox from '@radix-ui/react-checkbox';
import { Check } from 'lucide-react';
import { useId } from 'react';

interface CheckboxProps {
  label: string;
  description?: string | undefined;
  checked: boolean;
  disabled?: boolean | undefined;
  onCheckedChange: (checked: boolean) => void;
}

export function Checkbox({
  label,
  description,
  checked,
  disabled,
  onCheckedChange,
}: CheckboxProps) {
  const id = useId();
  return (
    <div className="flex items-start gap-2.5">
      <RadixCheckbox.Root
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={(value) => {
          onCheckedChange(value === true);
        }}
        className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-[4px] border border-line-strong bg-surface data-[state=checked]:border-sage-600 data-[state=checked]:bg-sage-600 disabled:opacity-50"
      >
        <RadixCheckbox.Indicator>
          <Check className="size-3 text-white" strokeWidth={3} aria-hidden />
        </RadixCheckbox.Indicator>
      </RadixCheckbox.Root>
      <label htmlFor={id} className="text-sm leading-5 text-ink">
        {label}
        {description ? <span className="block text-xs text-ink-muted">{description}</span> : null}
      </label>
    </div>
  );
}
