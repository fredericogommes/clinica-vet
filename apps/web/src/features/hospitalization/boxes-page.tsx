import { boxKindLabels, boxKinds, boxSchema, type Box, type BoxKind } from '@clinica/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BedDouble, Plus } from 'lucide-react';
import { useState } from 'react';
import { Button } from '../../design-system/button';
import { Checkbox } from '../../design-system/checkbox';
import { Dialog } from '../../design-system/dialog';
import { SelectField, TextField } from '../../design-system/field';
import { Badge, PageHeader, Panel } from '../../design-system/layout';
import { EmptyState, ErrorState, SkeletonRows } from '../../design-system/states';
import { DataTable } from '../../design-system/table';
import { useToast } from '../../design-system/toast';
import { api, ApiRequestError, errorMessage } from '../../lib/api';
import { catalogQuery } from '../catalogs/queries';
import { boxesQuery } from './queries';

/** Boxes da unidade [p.15]: nome, sigla, tipo, capacidade e espécies aceitas. */
export function BoxesPage() {
  const boxes = useQuery(boxesQuery);
  const [editing, setEditing] = useState<Box | 'new' | null>(null);
  return (
    <>
      <PageHeader
        area="Internação"
        title="Boxes"
        description="Os boxes de internação desta unidade. Sem espécie marcada, o box aceita qualquer animal."
        actions={
          <Button
            icon={<Plus className="size-4" aria-hidden />}
            onClick={() => {
              setEditing('new');
            }}
          >
            Novo box
          </Button>
        }
      />
      <Panel>
        {boxes.isPending ? (
          <SkeletonRows rows={4} columns={4} />
        ) : boxes.isError ? (
          <ErrorState message={errorMessage(boxes.error)} onRetry={() => void boxes.refetch()} />
        ) : boxes.data.length === 0 ? (
          <EmptyState
            icon={BedDouble}
            title="Nenhum box cadastrado"
            description="Cadastre os boxes para alocar os animais internados."
          />
        ) : (
          <DataTable
            caption="Boxes da unidade"
            rows={boxes.data}
            rowKey={(b) => b.id}
            columns={[
              {
                header: 'Box',
                cell: (b) => (
                  <span className="block min-w-0">
                    <span className="block font-medium">
                      <span className="font-mono">{b.code}</span> · {b.name}
                    </span>
                    <span className="block text-xs text-ink-muted">
                      {b.species.length
                        ? b.species.map((s) => s.name).join(', ')
                        : 'Qualquer espécie'}
                    </span>
                  </span>
                ),
              },
              {
                header: 'Tipo',
                hideOnMobile: true,
                cell: (b) => boxKindLabels[b.kind],
              },
              {
                header: 'Ocupação',
                cell: (b) => (
                  <span className="font-mono text-sm whitespace-nowrap tabular-nums">
                    {b.occupied} de {b.capacity}
                  </span>
                ),
              },
              {
                header: 'Situação',
                hideOnMobile: true,
                cell: (b) =>
                  b.archived ? <Badge>Arquivado</Badge> : <Badge tone="sage">Ativo</Badge>,
              },
              {
                header: 'Ação',
                className: 'text-right',
                cell: (b) => (
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Editar box ${b.code}`}
                    onClick={() => {
                      setEditing(b);
                    }}
                  >
                    Editar
                  </Button>
                ),
              },
            ]}
          />
        )}
      </Panel>
      {editing ? (
        <BoxDialog
          box={editing === 'new' ? null : editing}
          onClose={() => {
            setEditing(null);
          }}
        />
      ) : null}
    </>
  );
}

function BoxDialog({ box, onClose }: { box: Box | null; onClose: () => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const species = useQuery(catalogQuery('species'));
  const [name, setName] = useState(box?.name ?? '');
  const [code, setCode] = useState(box?.code ?? '');
  const [kind, setKind] = useState<BoxKind>(box?.kind ?? 'general');
  const [capacity, setCapacity] = useState(String(box?.capacity ?? 1));
  const [speciesIds, setSpeciesIds] = useState(box?.species.map((s) => s.id) ?? []);
  const [archived, setArchived] = useState(box?.archived ?? false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: (body: unknown) =>
      box
        ? api('PUT', `/hospitalizations/boxes/${box.id}`, boxSchema, body)
        : api('POST', '/hospitalizations/boxes', boxSchema, body),
    onSuccess: async (saved) => {
      await queryClient.invalidateQueries({ queryKey: ['hospitalizations'] });
      toast.success(box ? `Box ${saved.code} atualizado.` : `Box ${saved.code} cadastrado.`);
      onClose();
    },
    onError: (e) => {
      setErrors(
        e instanceof ApiRequestError
          ? Object.fromEntries(e.fieldErrors.map((f) => [f.path, f.message]))
          : {},
      );
    },
  });
  const general =
    save.isError && !(save.error instanceof ApiRequestError && save.error.fieldErrors.length)
      ? errorMessage(save.error)
      : undefined;
  const activeSpecies = (species.data ?? []).filter(
    (s) => !s.archived || speciesIds.includes(s.id),
  );

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={box ? `Editar box ${box.code}` : 'Novo box'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="box-form" pending={save.isPending}>
            Salvar
          </Button>
        </>
      }
    >
      <form
        id="box-form"
        noValidate
        aria-label="Box"
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          const found: Record<string, string> = {};
          if (!name.trim()) found.name = 'Informe o nome';
          if (!code.trim()) found.code = 'Informe a sigla';
          const cap = Number(capacity);
          if (!Number.isInteger(cap) || cap < 1 || cap > 50) {
            found.capacity = 'De 1 a 50 animais';
          }
          setErrors(found);
          if (Object.keys(found).length > 0) return;
          save.mutate({ name, code, kind, capacity: cap, speciesIds, archived });
        }}
      >
        {general ? (
          <p
            role="alert"
            className="rounded-control bg-danger-50 px-3 py-2 text-sm text-danger-600"
          >
            {general}
          </p>
        ) : null}
        <div className="grid gap-4 sm:grid-cols-[8rem_minmax(0,1fr)]">
          <TextField
            label="Sigla"
            autoComplete="off"
            maxLength={12}
            value={code}
            error={errors.code}
            onChange={(e) => {
              setCode(e.target.value.toUpperCase());
            }}
          />
          <TextField
            label="Nome"
            autoComplete="off"
            maxLength={60}
            value={name}
            error={errors.name}
            onChange={(e) => {
              setName(e.target.value);
            }}
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            label="Tipo"
            value={kind}
            options={boxKinds.map((k) => ({ value: k, label: boxKindLabels[k] }))}
            onChange={(e) => {
              setKind(e.target.value as BoxKind);
            }}
          />
          <TextField
            label="Capacidade (animais)"
            type="number"
            min={1}
            max={50}
            value={capacity}
            error={errors.capacity}
            onChange={(e) => {
              setCapacity(e.target.value);
            }}
          />
        </div>
        <fieldset className="space-y-2">
          <legend className="text-[13px] font-medium text-ink">Espécies aceitas</legend>
          <p className="text-xs text-ink-muted">Nenhuma marcada aceita qualquer espécie.</p>
          {activeSpecies.map((s) => (
            <Checkbox
              key={s.id}
              label={s.name}
              checked={speciesIds.includes(s.id)}
              onCheckedChange={(checked) => {
                setSpeciesIds(
                  checked ? [...speciesIds, s.id] : speciesIds.filter((id) => id !== s.id),
                );
              }}
            />
          ))}
          {errors.speciesIds ? (
            <p role="alert" className="text-xs font-medium text-danger-600">
              {errors.speciesIds}
            </p>
          ) : null}
        </fieldset>
        {box ? (
          <Checkbox
            label="Arquivado"
            description="Box arquivado não recebe novos animais."
            checked={archived}
            onCheckedChange={setArchived}
          />
        ) : null}
      </form>
    </Dialog>
  );
}
