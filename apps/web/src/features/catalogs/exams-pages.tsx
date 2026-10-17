import {
  EXAM_MAX_DECIMALS,
  EXAM_MAX_MONTHS,
  examDataTypeLabels,
  examDataTypes,
  examInputSchema,
  examReferencesInputSchema,
  examSchema,
  type Exam,
  type ExamDataType,
  type ExamInput,
  type ExamReferencesInput,
} from '@clinica/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { clsx } from 'clsx';
import { ArrowDown, ArrowUp, FlaskConical, Plus, Trash2 } from 'lucide-react';
import { useId, useState } from 'react';
import { Button, buttonClasses } from '../../design-system/button';
import { Checkbox } from '../../design-system/checkbox';
import { SearchField, SelectField, TextField } from '../../design-system/field';
import { Badge, FormActions, PageHeader, Section } from '../../design-system/layout';
import { EmptyState, ErrorState, SkeletonRows } from '../../design-system/states';
import { Tabs, tabPanelProps } from '../../design-system/tabs';
import { useToast } from '../../design-system/toast';
import { api, ApiRequestError, errorMessage } from '../../lib/api';
import { examsQuery } from '../clinical/queries';
import { catalogQuery, servicesQuery } from './queries';

type Errors = Record<string, string>;

const examQuery = (id: string) => ({
  queryKey: ['catalogs', 'exams', id],
  queryFn: () => api('GET', `/exams/${id}`, examSchema),
});

function errorsOf(error: unknown): Errors {
  if (!(error instanceof ApiRequestError)) return {};
  return Object.fromEntries(error.fieldErrors.map((f) => [f.path, f.message]));
}

function FormAlert({ error, errors }: { error: unknown; errors: Errors }) {
  if (!error && Object.keys(errors).length === 0) return null;
  const message =
    error && !(error instanceof ApiRequestError && error.fieldErrors.length > 0)
      ? errorMessage(error)
      : 'Confira os campos destacados.';
  return (
    <p role="alert" className="rounded-control bg-danger-50 px-3 py-2 text-sm text-danger-600">
      {message}
    </p>
  );
}

/** "12,5" → 12.5; vazio → null; texto que não é número → NaN (o formulário avisa). */
const toNumber = (text: string): number | null => {
  const normalized = text.trim().replace(/\s/g, '').replace(',', '.');
  if (normalized === '') return null;
  return /^-?\d+(\.\d+)?$/.test(normalized) ? Number(normalized) : Number.NaN;
};
const fromNumber = (value: number | null) =>
  value === null ? '' : String(value).replace('.', ',');

// Lista ---------------------------------------------------------------------------------------

/** Exames [p.12–14]: campos tipados por seção e valores de referência por espécie e idade. */
export function ExamsPage() {
  const items = useQuery(examsQuery);
  const [term, setTerm] = useState('');
  const needle = term.trim().toLocaleLowerCase('pt-BR');
  const visible = (items.data ?? []).filter(
    (e) => !needle || e.name.toLocaleLowerCase('pt-BR').includes(needle),
  );
  return (
    <>
      <PageHeader
        area="Cadastros"
        title="Exames"
        description="Cada exame tem seus campos, organizados em seções, e as faixas de referência por espécie e idade usadas para marcar resultados fora do normal."
        actions={
          <Link to="/cadastros/exames/novo" className={buttonClasses('primary')}>
            <Plus className="size-4" aria-hidden />
            Novo exame
          </Link>
        }
      />
      <Section title="Exames cadastrados">
        {items.isPending ? (
          <SkeletonRows rows={4} columns={3} />
        ) : items.isError ? (
          <ErrorState message={errorMessage(items.error)} onRetry={() => void items.refetch()} />
        ) : items.data.length === 0 ? (
          <EmptyState
            icon={FlaskConical}
            title="Nenhum exame cadastrado"
            description="Cadastre os exames que a clínica registra na ficha, com os campos do laudo."
          />
        ) : (
          <>
            <SearchField
              label="Filtrar exames"
              placeholder="Filtrar por nome"
              icon={<FlaskConical className="size-4" aria-hidden />}
              value={term}
              onChange={(e) => {
                setTerm(e.target.value);
              }}
              className="mb-3"
            />
            <ul className="-mx-2 divide-y divide-line">
              {visible.map((e) => (
                <li key={e.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-2 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{e.name}</p>
                    <p className="text-xs text-ink-muted">
                      {e.fieldCount} {e.fieldCount === 1 ? 'campo' : 'campos'} ·{' '}
                      {e.referenceCount === 0
                        ? 'sem faixa de referência'
                        : `${String(e.referenceCount)} ${e.referenceCount === 1 ? 'faixa' : 'faixas'} de referência`}
                      {e.service ? ` · cobra ${e.service.name}` : ''}
                    </p>
                  </div>
                  {e.archived ? <Badge>Arquivado</Badge> : null}
                  <Link
                    to="/cadastros/exames/$examId"
                    params={{ examId: e.id }}
                    aria-label={`Editar ${e.name}`}
                    className={buttonClasses('ghost', 'sm')}
                  >
                    Editar
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </Section>
    </>
  );
}

// Edição --------------------------------------------------------------------------------------

type Tab = 'campos' | 'referencias';

export function ExamEditPage({ examId }: { examId: string | null }) {
  const exam = useQuery({ ...examQuery(examId ?? ''), enabled: examId !== null });
  const [tab, setTab] = useState<Tab>('campos');

  if (examId && exam.isPending) {
    return <SkeletonRows rows={6} columns={3} />;
  }
  if (examId && exam.isError) {
    return <ErrorState message={errorMessage(exam.error)} onRetry={() => void exam.refetch()} />;
  }
  const data = exam.data ?? null;
  return (
    <>
      <PageHeader
        area="Cadastros › Exames"
        title={data ? data.name : 'Novo exame'}
        description="O resultado registrado na ficha guarda os valores e a faixa usada; mudar o cadastro depois não altera resultados antigos."
        actions={
          <Link to="/cadastros/exames" className={buttonClasses('secondary')}>
            Voltar para exames
          </Link>
        }
      />
      <Tabs
        label="Partes do exame"
        value={tab}
        options={[
          { value: 'campos', label: 'Campos' },
          { value: 'referencias', label: 'Valores de referência' },
        ]}
        onChange={setTab}
      />
      <div {...tabPanelProps('campos')} hidden={tab !== 'campos'} className="pt-5">
        <FieldsForm key={data?.id ?? 'novo'} exam={data} />
      </div>
      <div {...tabPanelProps('referencias')} hidden={tab !== 'referencias'} className="pt-5">
        {data ? (
          <ReferencesForm key={data.id} exam={data} />
        ) : (
          <EmptyState
            icon={FlaskConical}
            title="Salve os campos primeiro"
            description="As faixas de referência são definidas para cada campo numérico do exame."
          />
        )}
      </div>
    </>
  );
}

interface AttributeRow {
  key: string;
  id: string | null;
  kind: 'section' | 'field';
  name: string;
  unit: string;
  dataType: ExamDataType | '';
  decimals: string;
  maxLength: string;
}

let rowSeq = 0;
const newRow = (kind: 'section' | 'field'): AttributeRow => ({
  key: `novo-${String(++rowSeq)}`,
  id: null,
  kind,
  name: '',
  unit: '',
  dataType: kind === 'field' ? 'decimal' : '',
  decimals: kind === 'field' ? '1' : '',
  maxLength: '',
});

const intOrNull = (text: string) => (text.trim() === '' ? null : Number(text));

function FieldsForm({ exam }: { exam: Exam | null }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const services = useQuery(servicesQuery);
  const [name, setName] = useState(exam?.name ?? '');
  const [serviceId, setServiceId] = useState(exam?.service?.id ?? '');
  const [archived, setArchived] = useState(exam?.archived ?? false);
  const [rows, setRows] = useState<AttributeRow[]>(() =>
    exam
      ? exam.attributes.map((a) => ({
          key: a.id,
          id: a.id,
          kind: a.kind,
          name: a.name,
          unit: a.unit,
          dataType: a.dataType ?? '',
          decimals: a.decimals === null ? '' : String(a.decimals),
          maxLength: a.maxLength === null ? '' : String(a.maxLength),
        }))
      : [newRow('field')],
  );
  const [errors, setErrors] = useState<Errors>({});

  const input: ExamInput = {
    name,
    serviceId: serviceId || null,
    archived,
    attributes: rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      name: r.name,
      unit: r.kind === 'field' ? r.unit : '',
      dataType: r.kind === 'field' && r.dataType ? r.dataType : null,
      decimals: r.kind === 'field' && r.dataType === 'decimal' ? intOrNull(r.decimals) : null,
      maxLength: r.kind === 'field' && r.dataType === 'text' ? intOrNull(r.maxLength) : null,
    })),
  };
  const save = useMutation({
    mutationFn: () =>
      exam
        ? api('PUT', `/exams/${exam.id}`, examSchema, input)
        : api('POST', '/exams', examSchema, input),
    onSuccess: async (saved) => {
      await queryClient.invalidateQueries({ queryKey: ['catalogs', 'exams'] });
      if (exam) {
        toast.success('Campos salvos.');
      } else {
        toast.success('Exame incluído. Agora cadastre os valores de referência.');
        await navigate({ to: '/cadastros/exames/$examId', params: { examId: saved.id } });
      }
    },
    onError: (error) => {
      setErrors(errorsOf(error));
    },
  });
  const submit = () => {
    const parsed = examInputSchema.safeParse(input);
    const local: Errors = parsed.success
      ? {}
      : Object.fromEntries(parsed.error.issues.map((i) => [i.path.join('.'), i.message]));
    setErrors(local);
    if (Object.keys(local).length === 0) save.mutate();
  };
  const update = (index: number, patch: Partial<AttributeRow>) => {
    setRows((all) => all.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  };
  const move = (index: number, step: number) => {
    setRows((all) => {
      const next = [...all];
      const [row] = next.splice(index, 1);
      if (row) next.splice(index + step, 0, row);
      return next;
    });
  };
  const serviceOptions = (services.data ?? []).map((s) => ({ value: s.id, label: s.name }));
  if (exam?.service && !serviceOptions.some((o) => o.value === exam.service?.id)) {
    serviceOptions.push({ value: exam.service.id, label: exam.service.name });
  }

  return (
    <form
      noValidate
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <FormAlert error={save.error} errors={errors} />
      <Section title="Exame">
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="Nome"
            autoComplete="off"
            maxLength={80}
            value={name}
            error={errors.name}
            onChange={(e) => {
              setName(e.target.value);
            }}
          />
          <SelectField
            label="Serviço cobrado"
            value={serviceId}
            placeholder={services.isError ? 'Sem acesso aos serviços' : 'Não cobra'}
            options={serviceOptions}
            hint="Lançado na venda aberta do animal quando o resultado é finalizado."
            error={errors.serviceId}
            onChange={(e) => {
              setServiceId(e.target.value);
            }}
          />
        </div>
        {exam ? (
          <div className="mt-4">
            <Checkbox
              label="Arquivado"
              description="Some da lista de exames da ficha; resultados antigos continuam exibindo."
              checked={archived}
              onCheckedChange={setArchived}
            />
          </div>
        ) : null}
      </Section>

      <Section
        title="Campos do laudo"
        description="Na ordem em que aparecem no resultado. Seções agrupam os campos seguintes, como Eritrograma e Leucograma."
      >
        {errors.attributes ? (
          <p role="alert" className="mb-3 text-sm text-danger-600">
            {errors.attributes}
          </p>
        ) : null}
        <ol className="space-y-2">
          {rows.map((r, i) => (
            <AttributeEditor
              key={r.key}
              row={r}
              index={i}
              last={i === rows.length - 1}
              errors={errors}
              onChange={(patch) => {
                update(i, patch);
              }}
              onMove={(step) => {
                move(i, step);
              }}
              onRemove={() => {
                setRows((all) => all.filter((_, j) => j !== i));
              }}
            />
          ))}
        </ol>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            variant="secondary"
            size="sm"
            icon={<Plus className="size-4" aria-hidden />}
            onClick={() => {
              setRows((all) => [...all, newRow('field')]);
            }}
          >
            Adicionar campo
          </Button>
          <Button
            variant="ghost"
            size="sm"
            icon={<Plus className="size-4" aria-hidden />}
            onClick={() => {
              setRows((all) => [...all, newRow('section')]);
            }}
          >
            Adicionar seção
          </Button>
        </div>
        {exam ? (
          <p className="mt-3 text-xs text-ink-muted">
            Um campo já usado em resultados, ao ser removido, sai do formulário mas continua nos
            resultados antigos.
          </p>
        ) : null}
      </Section>

      <FormActions>
        <Button type="submit" pending={save.isPending}>
          {exam ? 'Salvar campos' : 'Incluir exame'}
        </Button>
      </FormActions>
    </form>
  );
}

function AttributeEditor({
  row: r,
  index: i,
  last,
  errors,
  onChange,
  onMove,
  onRemove,
}: {
  row: AttributeRow;
  index: number;
  last: boolean;
  errors: Errors;
  onChange: (patch: Partial<AttributeRow>) => void;
  onMove: (step: number) => void;
  onRemove: () => void;
}) {
  const err = (field: string) => errors[`attributes.${String(i)}.${field}`];
  const label = r.name.trim() || (r.kind === 'section' ? 'seção sem nome' : 'campo sem nome');
  return (
    <li
      aria-label={`${r.kind === 'section' ? 'Seção' : 'Campo'} ${String(i + 1)}: ${label}`}
      className={clsx(
        'rounded-control border p-3',
        r.kind === 'section' ? 'border-line bg-sunken' : 'border-line bg-surface',
      )}
    >
      <div className="flex flex-wrap items-start gap-3">
        <div
          className={clsx(
            'grid min-w-0 flex-1 gap-3',
            r.kind === 'field' && 'sm:grid-cols-[minmax(10rem,2fr)_6rem_8rem_7rem]',
          )}
        >
          <TextField
            label={r.kind === 'section' ? 'Seção' : 'Campo'}
            autoComplete="off"
            maxLength={80}
            value={r.name}
            error={err('name')}
            onChange={(e) => {
              onChange({ name: e.target.value });
            }}
          />
          {r.kind === 'field' ? (
            <>
              <TextField
                label="Unidade"
                autoComplete="off"
                maxLength={20}
                placeholder="Ex. g/dL"
                value={r.unit}
                error={err('unit')}
                onChange={(e) => {
                  onChange({ unit: e.target.value });
                }}
              />
              <SelectField
                label="Tipo"
                value={r.dataType}
                options={examDataTypes.map((t) => ({ value: t, label: examDataTypeLabels[t] }))}
                error={err('dataType')}
                onChange={(e) => {
                  const dataType = e.target.value as ExamDataType;
                  onChange({
                    dataType,
                    decimals: dataType === 'decimal' ? r.decimals || '1' : '',
                    maxLength: dataType === 'text' ? r.maxLength || '40' : '',
                  });
                }}
              />
              {r.dataType === 'decimal' ? (
                <SelectField
                  label="Casas"
                  value={r.decimals}
                  options={Array.from({ length: EXAM_MAX_DECIMALS + 1 }, (_, n) => ({
                    value: String(n),
                    label: String(n),
                  }))}
                  error={err('decimals')}
                  onChange={(e) => {
                    onChange({ decimals: e.target.value });
                  }}
                />
              ) : r.dataType === 'text' ? (
                <TextField
                  label="Tamanho"
                  inputMode="numeric"
                  autoComplete="off"
                  value={r.maxLength}
                  error={err('maxLength')}
                  onChange={(e) => {
                    onChange({ maxLength: e.target.value.replace(/\D/g, '') });
                  }}
                />
              ) : (
                <span aria-hidden />
              )}
            </>
          ) : null}
        </div>
        <div className="flex gap-1 pt-6">
          <Button
            variant="ghost"
            size="sm"
            aria-label={`Subir ${label}`}
            disabled={i === 0}
            onClick={() => {
              onMove(-1);
            }}
          >
            <ArrowUp className="size-4" aria-hidden />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            aria-label={`Descer ${label}`}
            disabled={last}
            onClick={() => {
              onMove(1);
            }}
          >
            <ArrowDown className="size-4" aria-hidden />
          </Button>
          <Button variant="ghost" size="sm" aria-label={`Remover ${label}`} onClick={onRemove}>
            <Trash2 className="size-4" aria-hidden />
          </Button>
        </div>
      </div>
    </li>
  );
}

// Referências ---------------------------------------------------------------------------------

interface ReferenceRow {
  key: string;
  speciesId: string;
  label: string;
  minMonths: string;
  maxMonths: string;
  ranges: Record<string, { low: string; high: string }>;
}

function ReferencesForm({ exam }: { exam: Exam }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const species = useQuery(catalogQuery('species'));
  const numeric = exam.attributes.filter((a) => a.kind === 'field' && a.dataType !== 'text');
  const [rows, setRows] = useState<ReferenceRow[]>(() =>
    exam.references.map((r) => ({
      key: r.id,
      speciesId: r.species.id,
      label: r.label,
      minMonths: String(r.minMonths),
      maxMonths: String(r.maxMonths),
      ranges: Object.fromEntries(
        r.ranges.map((x) => [x.attributeId, { low: fromNumber(x.low), high: fromNumber(x.high) }]),
      ),
    })),
  );
  const [errors, setErrors] = useState<Errors>({});

  // Faixas vazias ficam de fora; o índice enviado aponta de volta para o campo, para o erro.
  const build = () => {
    const rangeKeys: string[][] = [];
    const input: ExamReferencesInput = {
      references: rows.map((r, i) => {
        const keys: string[] = [];
        const ranges = numeric.flatMap((a) => {
          const x = r.ranges[a.id];
          if (!x || (x.low.trim() === '' && x.high.trim() === '')) return [];
          keys.push(a.id);
          return [{ attributeId: a.id, low: toNumber(x.low), high: toNumber(x.high) }];
        });
        rangeKeys[i] = keys;
        return {
          speciesId: r.speciesId,
          label: r.label,
          minMonths: Number(r.minMonths || 'NaN'),
          maxMonths: Number(r.maxMonths || 'NaN'),
          ranges,
        };
      }),
    };
    return { input, rangeKeys };
  };
  // "references.0.ranges.2.low" → "references.0.<id do campo>.low".
  const remap = (raw: Errors, rangeKeys: string[][]): Errors =>
    Object.fromEntries(
      Object.entries(raw).map(([path, message]) => {
        const m = /^references\.(\d+)\.ranges\.(\d+)\.(low|high)$/.exec(path);
        const attributeId = m ? rangeKeys[Number(m[1])]?.[Number(m[2])] : undefined;
        return [m && attributeId ? `references.${m[1]}.${attributeId}.${m[3]}` : path, message];
      }),
    );
  const save = useMutation({
    mutationFn: (input: ExamReferencesInput) =>
      api('PUT', `/exams/${exam.id}/references`, examSchema, input),
    onSuccess: async (saved) => {
      queryClient.setQueryData(examQuery(exam.id).queryKey, saved);
      await queryClient.invalidateQueries({ queryKey: ['catalogs', 'exams'] });
      toast.success('Valores de referência salvos.');
    },
  });
  const submit = () => {
    const { input, rangeKeys } = build();
    const local: Errors = {};
    input.references.forEach((r, i) => {
      for (const field of ['minMonths', 'maxMonths'] as const) {
        if (!Number.isInteger(r[field]))
          local[`references.${String(i)}.${field}`] = 'Informe os meses';
      }
      r.ranges.forEach((x, j) => {
        for (const side of ['low', 'high'] as const) {
          if (Number.isNaN(x[side])) {
            local[`references.${String(i)}.ranges.${String(j)}.${side}`] = 'Informe um número';
          }
        }
      });
    });
    if (Object.keys(local).length === 0) {
      const parsed = examReferencesInputSchema.safeParse(input);
      if (!parsed.success) {
        for (const issue of parsed.error.issues) local[issue.path.join('.')] ??= issue.message;
      }
    }
    setErrors(remap(local, rangeKeys));
    if (Object.keys(local).length === 0) {
      save.mutate(input, {
        onError: (error) => {
          setErrors(remap(errorsOf(error), rangeKeys));
        },
      });
    }
  };
  const update = (index: number, patch: Partial<ReferenceRow>) => {
    setRows((all) => all.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  };
  const speciesOptions = (species.data ?? [])
    .filter((s) => !s.archived || rows.some((r) => r.speciesId === s.id))
    .map((s) => ({ value: s.id, label: s.name }));

  if (numeric.length === 0) {
    return (
      <EmptyState
        icon={FlaskConical}
        title="Nenhum campo numérico"
        description="Referência só vale para campos decimais ou inteiros. Inclua um na aba Campos."
      />
    );
  }

  return (
    <form
      noValidate
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <FormAlert error={save.error} errors={errors} />
      <p className="max-w-3xl text-sm text-ink-muted">
        Cada faixa vale para uma espécie e uma idade em meses completos, contando as duas pontas
        (ex. Filhote de 0 a 11, Adulto de 12 a {EXAM_MAX_MONTHS}). Use os valores do laboratório que
        faz o exame; deixe em branco o que ele não informa.
      </p>
      {rows.length === 0 ? (
        <EmptyState
          icon={FlaskConical}
          title="Sem valores de referência"
          description="Sem faixa, os resultados são registrados sem marcação de fora do normal."
        />
      ) : null}
      {rows.map((r, i) => (
        <ReferenceEditor
          key={r.key}
          row={r}
          index={i}
          numeric={numeric}
          speciesOptions={speciesOptions}
          errors={errors}
          onChange={(patch) => {
            update(i, patch);
          }}
          onRemove={() => {
            setRows((all) => all.filter((_, j) => j !== i));
          }}
        />
      ))}
      <Button
        variant="secondary"
        size="sm"
        icon={<Plus className="size-4" aria-hidden />}
        onClick={() => {
          setRows((all) => [
            ...all,
            {
              key: `nova-${String(++rowSeq)}`,
              speciesId: all.at(-1)?.speciesId ?? '',
              label: '',
              minMonths: '',
              maxMonths: '',
              ranges: {},
            },
          ]);
        }}
      >
        Adicionar faixa
      </Button>
      <FormActions>
        <Button type="submit" pending={save.isPending}>
          Salvar referências
        </Button>
      </FormActions>
    </form>
  );
}

function ReferenceEditor({
  row: r,
  index: i,
  numeric,
  speciesOptions,
  errors,
  onChange,
  onRemove,
}: {
  row: ReferenceRow;
  index: number;
  numeric: Exam['attributes'];
  speciesOptions: { value: string; label: string }[];
  errors: Errors;
  onChange: (patch: Partial<ReferenceRow>) => void;
  onRemove: () => void;
}) {
  const titleId = useId();
  const prefix = `references.${String(i)}`;
  const species = speciesOptions.find((s) => s.value === r.speciesId)?.label;
  const title = [species, r.label.trim()].filter(Boolean).join(', ') || `Faixa ${String(i + 1)}`;
  const setRange = (attributeId: string, side: 'low' | 'high', value: string) => {
    const current = r.ranges[attributeId] ?? { low: '', high: '' };
    onChange({ ranges: { ...r.ranges, [attributeId]: { ...current, [side]: value } } });
  };
  return (
    <section
      aria-labelledby={titleId}
      className="rounded-panel border border-line bg-surface shadow-panel"
    >
      <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5">
        <h2 id={titleId} className="font-display text-[15px] font-semibold">
          {title}
        </h2>
        <Button
          variant="ghost"
          size="sm"
          icon={<Trash2 className="size-4" aria-hidden />}
          onClick={onRemove}
        >
          Remover faixa
        </Button>
      </header>
      <div className="space-y-4 px-4 py-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-[1.4fr_1.4fr_7rem_7rem]">
          <SelectField
            label="Espécie"
            value={r.speciesId}
            placeholder="Selecione"
            options={speciesOptions}
            error={errors[`${prefix}.speciesId`]}
            onChange={(e) => {
              onChange({ speciesId: e.target.value });
            }}
          />
          <TextField
            label="Nome da faixa"
            placeholder="Ex. Adulto"
            autoComplete="off"
            maxLength={40}
            value={r.label}
            error={errors[`${prefix}.label`]}
            onChange={(e) => {
              onChange({ label: e.target.value });
            }}
          />
          <TextField
            label="De (meses)"
            inputMode="numeric"
            autoComplete="off"
            value={r.minMonths}
            error={errors[`${prefix}.minMonths`]}
            onChange={(e) => {
              onChange({ minMonths: e.target.value.replace(/\D/g, '') });
            }}
          />
          <TextField
            label="Até (meses)"
            inputMode="numeric"
            autoComplete="off"
            value={r.maxMonths}
            error={errors[`${prefix}.maxMonths`]}
            onChange={(e) => {
              onChange({ maxMonths: e.target.value.replace(/\D/g, '') });
            }}
          />
        </div>
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Valores normais de {title}</caption>
          <thead>
            <tr className="border-b border-line text-xs text-ink-muted">
              <th scope="col" className="py-1.5 pr-2 font-medium">
                Campo
              </th>
              <th scope="col" className="w-24 py-1.5 pr-2 font-medium sm:w-32">
                Mínimo
              </th>
              <th scope="col" className="w-24 py-1.5 font-medium sm:w-32">
                Máximo
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {numeric.map((a) => {
              const x = r.ranges[a.id] ?? { low: '', high: '' };
              const lowError = errors[`${prefix}.${a.id}.low`];
              const highError = errors[`${prefix}.${a.id}.high`];
              return (
                <tr key={a.id}>
                  <th scope="row" className="py-1.5 pr-2 font-normal">
                    {a.name}
                    {a.unit ? (
                      <span className="ml-1 text-xs text-ink-muted">({a.unit})</span>
                    ) : null}
                    {lowError || highError ? (
                      <span role="alert" className="block text-xs text-danger-600">
                        {lowError ?? highError}
                      </span>
                    ) : null}
                  </th>
                  {(['low', 'high'] as const).map((side) => (
                    <td key={side} className={clsx('py-1.5', side === 'low' && 'pr-2')}>
                      <input
                        aria-label={`${side === 'low' ? 'Mínimo' : 'Máximo'} de ${a.name}`}
                        inputMode="decimal"
                        autoComplete="off"
                        maxLength={16}
                        value={x[side]}
                        aria-invalid={(side === 'low' ? lowError : highError) ? true : undefined}
                        onChange={(e) => {
                          setRange(a.id, side, e.target.value);
                        }}
                        className={clsx(
                          'h-9 w-full rounded-control border bg-surface px-2.5 text-right font-mono text-sm outline-none focus:border-sage-500',
                          (side === 'low' ? lowError : highError)
                            ? 'border-danger-600'
                            : 'border-line-strong',
                        )}
                      />
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
