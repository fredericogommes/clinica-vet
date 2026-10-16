import {
  catalogItemInputSchema,
  type CatalogItem,
  type CatalogItemInput,
} from '@clinica/contracts';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { Plus, Tags } from 'lucide-react';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { Button } from '../../design-system/button';
import { Checkbox } from '../../design-system/checkbox';
import { Dialog } from '../../design-system/dialog';
import { TextField } from '../../design-system/field';
import { Badge, Section } from '../../design-system/layout';
import { EmptyState, ErrorState, SkeletonRows } from '../../design-system/states';
import { useToast } from '../../design-system/toast';
import { errorMessage } from '../../lib/api';
import { applyFieldErrors } from '../../lib/forms';

interface CatalogListProps {
  title: string;
  description?: string;
  /** Nome do item no singular, usado nos botões e diálogos (ex. "pelagem"). */
  noun: string;
  /** Gênero do substantivo, para "Novo grupo" e "Nova marca". */
  masculine?: boolean;
  items: CatalogItem[] | undefined;
  isPending: boolean;
  error: unknown;
  onRetry: () => void;
  save: (id: string | null, input: CatalogItemInput) => Promise<unknown>;
  selectedId?: string | null;
  onSelect?: (item: CatalogItem) => void;
}

/** Lista editável de um cadastro de apoio, com inclusão, renomeação e arquivamento. */
export function CatalogList(props: CatalogListProps) {
  const {
    title,
    description,
    noun,
    masculine = false,
    items,
    isPending,
    error,
    onRetry,
    selectedId,
    onSelect,
  } = props;
  const [editing, setEditing] = useState<CatalogItem | null | undefined>(undefined);

  return (
    <Section
      title={title}
      {...(description ? { description } : {})}
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
      {isPending ? (
        <SkeletonRows rows={3} columns={1} />
      ) : error ? (
        <ErrorState message={errorMessage(error)} onRetry={onRetry} />
      ) : !items || items.length === 0 ? (
        <EmptyState
          icon={Tags}
          title="Nada cadastrado"
          description={`Adicione ${masculine ? 'o primeiro' : 'a primeira'} ${noun}.`}
        />
      ) : (
        <ul className="-mx-2 divide-y divide-line">
          {items.map((item) => (
            <li
              key={item.id}
              className={clsx(
                'flex items-center justify-between gap-2 rounded-control px-2 py-1.5',
                selectedId === item.id && 'bg-sage-50',
              )}
            >
              {onSelect ? (
                <button
                  type="button"
                  aria-current={selectedId === item.id || undefined}
                  className="min-w-0 flex-1 truncate py-1 text-left text-sm font-medium hover:text-sage-700"
                  onClick={() => {
                    onSelect(item);
                  }}
                >
                  {item.name}
                </button>
              ) : (
                <span className="min-w-0 flex-1 truncate py-1 text-sm">{item.name}</span>
              )}
              {item.archived ? <Badge>Arquivado</Badge> : null}
              <Button
                variant="ghost"
                size="sm"
                aria-label={`Editar ${item.name}`}
                onClick={() => {
                  setEditing(item);
                }}
              >
                Editar
              </Button>
            </li>
          ))}
        </ul>
      )}
      {editing !== undefined ? (
        <CatalogDialog
          item={editing}
          noun={noun}
          masculine={masculine}
          save={props.save}
          onClose={() => {
            setEditing(undefined);
          }}
        />
      ) : null}
    </Section>
  );
}

function CatalogDialog({
  item,
  noun,
  masculine,
  save,
  onClose,
}: {
  item: CatalogItem | null;
  noun: string;
  masculine: boolean;
  save: CatalogListProps['save'];
  onClose: () => void;
}) {
  const toast = useToast();
  const form = useForm<CatalogItemInput>({
    resolver: zodResolver(catalogItemInputSchema),
    defaultValues: { name: item?.name ?? '', archived: item?.archived ?? false },
  });
  const mutation = useMutation({
    mutationFn: (input: CatalogItemInput) => save(item?.id ?? null, input),
    onSuccess: () => {
      toast.success(item ? 'Alterações salvas.' : 'Cadastro incluído.');
      onClose();
    },
    onError: (error) => {
      applyFieldErrors(form.setError, error);
    },
  });
  const formId = 'catalog-form';

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={item ? `Editar ${noun}` : `${masculine ? 'Novo' : 'Nova'} ${noun}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form={formId} pending={mutation.isPending}>
            Salvar
          </Button>
        </>
      }
    >
      <form
        id={formId}
        noValidate
        className="space-y-4"
        onSubmit={form.handleSubmit((values) => {
          mutation.mutate(values);
        })}
      >
        {mutation.isError ? (
          <p
            role="alert"
            className="rounded-control bg-danger-50 px-3 py-2 text-sm text-danger-600"
          >
            {errorMessage(mutation.error)}
          </p>
        ) : null}
        <TextField
          label="Nome"
          autoComplete="off"
          error={form.formState.errors.name?.message}
          {...form.register('name')}
        />
        {item ? (
          <Controller
            control={form.control}
            name="archived"
            render={({ field }) => (
              <Checkbox
                label="Arquivado"
                description="Some das opções de novos cadastros; fichas que já usam continuam exibindo."
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
