import {
  clinicalTemplateInputSchema,
  clinicalTemplateSchema,
  pathologyInputSchema,
  pathologySchema,
  templatePlaceholders,
  type ClinicalTemplate,
  type ClinicalTemplateInput,
  type ClinicalTemplateKind,
  type Pathology,
  type PathologyInput,
} from '@clinica/contracts';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, FileText, Plus } from 'lucide-react';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { Button } from '../../design-system/button';
import { Checkbox } from '../../design-system/checkbox';
import { Dialog } from '../../design-system/dialog';
import { SearchField, TextField, TextareaField } from '../../design-system/field';
import { Badge, PageHeader, Section } from '../../design-system/layout';
import { EmptyState, ErrorState, SkeletonRows } from '../../design-system/states';
import { useToast } from '../../design-system/toast';
import { api, errorMessage } from '../../lib/api';
import { applyFieldErrors } from '../../lib/forms';
import { clinicalTemplatesQuery, pathologiesQuery } from '../clinical/queries';

function FormAlert({ error }: { error: unknown }) {
  return error ? (
    <p role="alert" className="rounded-control bg-danger-50 px-3 py-2 text-sm text-danger-600">
      {errorMessage(error)}
    </p>
  ) : null;
}

/** Patologias [p.12, L8]: diagnóstico codificado usado no atendimento e no evento Patologia. */
export function PathologiesPage() {
  const items = useQuery(pathologiesQuery);
  const [editing, setEditing] = useState<Pathology | null | undefined>(undefined);
  const [term, setTerm] = useState('');
  const needle = term.trim().toLowerCase();
  const visible = (items.data ?? []).filter(
    (p) =>
      !needle || p.name.toLowerCase().includes(needle) || p.code?.toLowerCase().includes(needle),
  );

  return (
    <>
      <PageHeader
        area="Cadastros"
        title="Patologias"
        description="Diagnósticos codificados: o código interno é opcional e único. Arquive o que não é mais usado; fichas antigas continuam exibindo."
      />
      <Section
        title="Patologias cadastradas"
        actions={
          <Button
            variant="ghost"
            size="sm"
            icon={<Plus className="size-4" aria-hidden />}
            onClick={() => {
              setEditing(null);
            }}
          >
            Adicionar
          </Button>
        }
      >
        {items.isPending ? (
          <SkeletonRows rows={4} columns={2} />
        ) : items.isError ? (
          <ErrorState message={errorMessage(items.error)} onRetry={() => void items.refetch()} />
        ) : items.data.length === 0 ? (
          <EmptyState
            icon={Activity}
            title="Nenhuma patologia cadastrada"
            description="Cadastre os diagnósticos mais usados na clínica, com ou sem código."
          />
        ) : (
          <>
            <SearchField
              label="Filtrar patologias"
              placeholder="Filtrar por nome ou código"
              icon={<Activity className="size-4" aria-hidden />}
              value={term}
              onChange={(e) => {
                setTerm(e.target.value);
              }}
              className="mb-3"
            />
            <ul className="-mx-2 divide-y divide-line">
              {visible.map((p) => (
                <li key={p.id} className="flex items-center gap-3 px-2 py-2">
                  <span className="w-20 shrink-0 font-mono text-xs text-ink-muted">
                    {p.code ?? '—'}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{p.name}</span>
                  {p.archived ? <Badge>Arquivada</Badge> : null}
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Editar ${p.name}`}
                    onClick={() => {
                      setEditing(p);
                    }}
                  >
                    Editar
                  </Button>
                </li>
              ))}
            </ul>
          </>
        )}
      </Section>
      {editing !== undefined ? (
        <PathologyDialog
          item={editing}
          onClose={() => {
            setEditing(undefined);
          }}
        />
      ) : null}
    </>
  );
}

function PathologyDialog({ item, onClose }: { item: Pathology | null; onClose: () => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const form = useForm<PathologyInput>({
    resolver: zodResolver(pathologyInputSchema),
    defaultValues: { code: item?.code ?? '', name: item?.name ?? '', archived: item?.archived },
  });
  const save = useMutation({
    mutationFn: (input: PathologyInput) =>
      item
        ? api('PUT', `/catalogs/pathologies/${item.id}`, pathologySchema, input)
        : api('POST', '/catalogs/pathologies', pathologySchema, input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: pathologiesQuery.queryKey });
      toast.success(item ? 'Alterações salvas.' : 'Patologia incluída.');
      onClose();
    },
    onError: (error) => {
      applyFieldErrors(form.setError, error);
    },
  });
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={item ? `Editar ${item.name}` : 'Nova patologia'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="pathology-form" pending={save.isPending}>
            Salvar
          </Button>
        </>
      }
    >
      <form
        id="pathology-form"
        noValidate
        className="space-y-4"
        onSubmit={form.handleSubmit((values) => {
          save.mutate(values);
        })}
      >
        <FormAlert error={save.error} />
        <div className="grid gap-4 sm:grid-cols-[8rem_1fr]">
          <TextField
            label="Código"
            hint="Opcional"
            autoComplete="off"
            className="font-mono uppercase"
            error={form.formState.errors.code?.message}
            {...form.register('code')}
          />
          <TextField
            label="Nome"
            autoComplete="off"
            error={form.formState.errors.name?.message}
            {...form.register('name')}
          />
        </div>
        {item ? (
          <Controller
            control={form.control}
            name="archived"
            render={({ field }) => (
              <Checkbox
                label="Arquivada"
                description="Some das opções de novos diagnósticos; os registros antigos continuam exibindo."
                checked={field.value ?? false}
                onCheckedChange={field.onChange}
              />
            )}
          />
        ) : null}
      </form>
    </Dialog>
  );
}

const kindTitles: Record<ClinicalTemplateKind, { list: string; noun: string }> = {
  prescription: { list: 'Modelos de receita', noun: 'modelo de receita' },
  document: { list: 'Modelos de documento', noun: 'modelo de documento' },
};

/** Modelos de receita e de documento [p.13], com campos preenchidos a partir da ficha. */
export function ClinicalTemplatesPage() {
  const templates = useQuery(clinicalTemplatesQuery);
  const [editing, setEditing] = useState<
    { kind: ClinicalTemplateKind; item: ClinicalTemplate | null } | undefined
  >(undefined);

  return (
    <>
      <PageHeader
        area="Cadastros"
        title="Modelos de receita e documento"
        description="Textos que abrem preenchidos na ficha clínica. Use os campos entre chaves duplas, como {{animal}}, para trazer os dados do animal e do responsável."
      />
      <div className="grid gap-5 lg:grid-cols-2">
        {(['prescription', 'document'] as const).map((kind) => {
          const items = (templates.data ?? []).filter((t) => t.kind === kind);
          return (
            <Section
              key={kind}
              title={kindTitles[kind].list}
              actions={
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<Plus className="size-4" aria-hidden />}
                  aria-label={`Adicionar ${kindTitles[kind].noun}`}
                  onClick={() => {
                    setEditing({ kind, item: null });
                  }}
                >
                  Adicionar
                </Button>
              }
            >
              {templates.isPending ? (
                <SkeletonRows rows={2} columns={1} />
              ) : templates.isError ? (
                <ErrorState
                  message={errorMessage(templates.error)}
                  onRetry={() => void templates.refetch()}
                />
              ) : items.length === 0 ? (
                <EmptyState
                  icon={FileText}
                  title="Nenhum modelo"
                  description={`Crie o primeiro ${kindTitles[kind].noun}.`}
                />
              ) : (
                <ul className="-mx-2 divide-y divide-line">
                  {items.map((t) => (
                    <li key={t.id} className="flex items-center gap-3 px-2 py-2">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{t.name}</span>
                        <span className="block truncate text-xs text-ink-muted">
                          {t.body.split('\n')[0]}
                        </span>
                      </span>
                      {t.archived ? <Badge>Arquivado</Badge> : null}
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`Editar ${t.name}`}
                        onClick={() => {
                          setEditing({ kind, item: t });
                        }}
                      >
                        Editar
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          );
        })}
      </div>
      {editing ? (
        <TemplateDialog
          kind={editing.kind}
          item={editing.item}
          onClose={() => {
            setEditing(undefined);
          }}
        />
      ) : null}
    </>
  );
}

function TemplateDialog({
  kind,
  item,
  onClose,
}: {
  kind: ClinicalTemplateKind;
  item: ClinicalTemplate | null;
  onClose: () => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const form = useForm<ClinicalTemplateInput>({
    resolver: zodResolver(clinicalTemplateInputSchema),
    defaultValues: {
      kind,
      name: item?.name ?? '',
      body: item?.body ?? '',
      archived: item?.archived ?? false,
    },
  });
  const save = useMutation({
    mutationFn: (input: ClinicalTemplateInput) =>
      item
        ? api('PUT', `/catalogs/clinical-templates/${item.id}`, clinicalTemplateSchema, input)
        : api('POST', '/catalogs/clinical-templates', clinicalTemplateSchema, input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: clinicalTemplatesQuery.queryKey });
      toast.success(item ? 'Modelo salvo.' : 'Modelo incluído.');
      onClose();
    },
    onError: (error) => {
      applyFieldErrors(form.setError, error);
    },
  });
  return (
    <Dialog
      open
      size="lg"
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={item ? `Editar ${item.name}` : `Novo ${kindTitles[kind].noun}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="template-form" pending={save.isPending}>
            Salvar
          </Button>
        </>
      }
    >
      <form
        id="template-form"
        noValidate
        className="space-y-4"
        onSubmit={form.handleSubmit((values) => {
          save.mutate(values);
        })}
      >
        <FormAlert error={save.error} />
        <TextField
          label="Nome"
          autoComplete="off"
          error={form.formState.errors.name?.message}
          {...form.register('name')}
        />
        <TextareaField
          label="Texto"
          rows={12}
          error={form.formState.errors.body?.message}
          {...form.register('body')}
        />
        <PlaceholderHelp />
        {item ? (
          <Controller
            control={form.control}
            name="archived"
            render={({ field }) => (
              <Checkbox
                label="Arquivado"
                description="Some da lista de modelos na ficha; receitas e documentos já emitidos não mudam."
                checked={field.value ?? false}
                onCheckedChange={field.onChange}
              />
            )}
          />
        ) : null}
      </form>
    </Dialog>
  );
}

/** Campos aceitos nos modelos, para quem escreve o texto. */
export function PlaceholderHelp() {
  return (
    <details className="rounded-control bg-canvas px-3 py-2 text-sm">
      <summary className="cursor-pointer text-xs font-medium text-sage-700">
        Campos que o sistema preenche
      </summary>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
        {Object.entries(templatePlaceholders).map(([key, label]) => (
          <div key={key} className="contents">
            <dt className="font-mono">{`{{${key}}}`}</dt>
            <dd className="text-ink-muted">{label}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
