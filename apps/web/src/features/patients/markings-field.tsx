import { TriangleAlert, X } from 'lucide-react';
import { useState } from 'react';
import { FieldShell } from '../../design-system/field';

/** Marcações do animal: alertas curtos que acompanham a ficha no atendimento (RN-09). */
export function MarkingsField({
  value,
  onChange,
  error,
}: {
  value: string[];
  onChange: (value: string[]) => void;
  error?: string | undefined;
}) {
  const [draft, setDraft] = useState('');
  const add = () => {
    const text = draft.trim();
    if (!text) return;
    if (!value.some((v) => v.toLowerCase() === text.toLowerCase()) && value.length < 10) {
      onChange([...value, text]);
    }
    setDraft('');
  };

  return (
    <FieldShell
      label="Marcações"
      hint="Ex.: Agressivo, Alergia a dipirona. Tecle Enter para adicionar; aparecem em destaque na ficha."
      error={error}
    >
      {({ id, describedBy }) => (
        <div className="rounded-control border border-line-strong bg-surface p-2 focus-within:ring-2 focus-within:ring-sage-500/30">
          {value.length > 0 ? (
            <ul className="mb-2 flex flex-wrap gap-1.5" aria-label="Marcações adicionadas">
              {value.map((m) => (
                <li
                  key={m}
                  className="inline-flex items-center gap-1 rounded-full bg-amber-50 py-0.5 pr-1 pl-2 text-xs font-medium text-amber-700"
                >
                  <TriangleAlert className="size-3" aria-hidden />
                  {m}
                  <button
                    type="button"
                    aria-label={`Remover marcação ${m}`}
                    className="rounded-full p-0.5 hover:bg-amber-500/20"
                    onClick={() => {
                      onChange(value.filter((v) => v !== m));
                    }}
                  >
                    <X className="size-3" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <input
            id={id}
            aria-describedby={describedBy}
            value={draft}
            maxLength={60}
            placeholder={value.length >= 10 ? 'Limite de 10 marcações' : 'Nova marcação'}
            disabled={value.length >= 10}
            className="w-full bg-transparent px-1 text-sm outline-none placeholder:text-ink-faint"
            onChange={(e) => {
              setDraft(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                add();
              }
            }}
            onBlur={add}
          />
        </div>
      )}
    </FieldShell>
  );
}
