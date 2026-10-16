import { isPermission, permissionCatalog } from '@clinica/contracts';

const fieldLabels: Record<string, string> = {
  name: 'Nome',
  email: 'E-mail',
  description: 'Descrição',
  permissions: 'Permissões',
  role: 'Perfil',
  units: 'Unidades',
  active: 'Ativo',
  clonedFrom: 'Clonado de',
};

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function display(value: unknown): string {
  if (value === undefined || value === null || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Sim' : 'Não';
  if (Array.isArray(value)) return value.length === 0 ? 'nenhuma' : value.map(display).join(', ');
  if (typeof value === 'string')
    return isPermission(value) ? permissionCatalog[value].label : value;
  if (typeof value === 'number') return String(value);
  const named = asRecord(value).name;
  if (typeof named === 'string') return named;
  return JSON.stringify(value);
}

/** Lista só os campos que mudaram, no formato "campo: antes → depois". */
export function AuditChanges({ before, after }: { before: unknown; after: unknown }) {
  const a = asRecord(before);
  const b = asRecord(after);
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(
    (key) => JSON.stringify(a[key]) !== JSON.stringify(b[key]),
  );
  if (keys.length === 0) return <span className="text-ink-faint">—</span>;
  return (
    <dl className="space-y-1 text-xs">
      {keys.map((key) => (
        <div key={key} className="grid grid-cols-[88px_minmax(0,1fr)] gap-2">
          <dt className="text-ink-muted">{fieldLabels[key] ?? key}</dt>
          <dd className="break-words text-ink">
            {key in a ? (
              <span className="text-ink-muted line-through decoration-ink-faint">
                {display(a[key])}
              </span>
            ) : null}
            {key in a && key in b ? (
              <span className="px-1 text-ink-faint" aria-label="mudou para">
                →
              </span>
            ) : null}
            {key in b ? <span>{display(b[key])}</span> : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}
