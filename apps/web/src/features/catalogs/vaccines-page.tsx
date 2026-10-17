import {
  VACCINE_MAX_DOSES,
  vaccineInputSchema,
  vaccineKindLabels,
  vaccineKinds,
  vaccinePeriodicity,
  vaccineSchema,
  type Vaccine,
  type VaccineInput,
  type VaccineKind,
} from '@clinica/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Syringe } from 'lucide-react';
import { useState } from 'react';
import { Button } from '../../design-system/button';
import { Checkbox } from '../../design-system/checkbox';
import { Dialog } from '../../design-system/dialog';
import { SelectField, TextField } from '../../design-system/field';
import { Badge, PageHeader, Section } from '../../design-system/layout';
import { EmptyState, ErrorState, SkeletonRows } from '../../design-system/states';
import { useToast } from '../../design-system/toast';
import { api, ApiRequestError, errorMessage } from '../../lib/api';
import { vaccinesQuery } from '../clinical/queries';
import { servicesQuery } from './queries';

type Errors = Record<string, string>;

/** Vacinas [p.12, RN-20]: série inicial e reforço definem a próxima dose de cada aplicação. */
export function VaccinesPage() {
  const items = useQuery(vaccinesQuery);
  const [editing, setEditing] = useState<Vaccine | null | undefined>(undefined);
  return (
    <>
      <PageHeader
        area="Cadastros"
        title="Vacinas"
        description="Vacinas, vermífugos e antiparasitários com a série inicial e o reforço. A aplicação na ficha sugere a próxima dose por aqui, e o veterinário pode ajustar."
      />
      <Section
        title="Vacinas cadastradas"
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
          <SkeletonRows rows={4} columns={3} />
        ) : items.isError ? (
          <ErrorState message={errorMessage(items.error)} onRetry={() => void items.refetch()} />
        ) : items.data.length === 0 ? (
          <EmptyState
            icon={Syringe}
            title="Nenhuma vacina cadastrada"
            description="Cadastre as vacinas e vermífugos que a clínica aplica, com o protocolo da casa."
          />
        ) : (
          <ul className="-mx-2 divide-y divide-line">
            {items.data.map((v) => (
              <li key={v.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-2 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{v.name}</p>
                  <p className="text-xs text-ink-muted">
                    {vaccineKindLabels[v.kind]} · {vaccinePeriodicity(v)}
                    {v.service ? ` · cobra ${v.service.name}` : ''}
                  </p>
                </div>
                {v.archived ? <Badge>Arquivada</Badge> : null}
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Editar ${v.name}`}
                  onClick={() => {
                    setEditing(v);
                  }}
                >
                  Editar
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Section>
      {editing !== undefined ? (
        <VaccineDialog
          item={editing}
          onClose={() => {
            setEditing(undefined);
          }}
        />
      ) : null}
    </>
  );
}

const digits = (text: string) => text.replace(/\D/g, '').slice(0, 4);
const intOrNull = (text: string) => (text === '' ? null : Number(text));

function VaccineDialog({ item, onClose }: { item: Vaccine | null; onClose: () => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const services = useQuery(servicesQuery);
  const [name, setName] = useState(item?.name ?? '');
  const [kind, setKind] = useState<VaccineKind>(item?.kind ?? 'vaccine');
  const [doses, setDoses] = useState(String(item?.primaryDoses ?? 1));
  const [interval, setInterval] = useState(
    item?.primaryIntervalDays ? String(item.primaryIntervalDays) : '',
  );
  const [booster, setBooster] = useState(
    item ? (item.boosterIntervalDays === null ? '' : String(item.boosterIntervalDays)) : '365',
  );
  const [serviceId, setServiceId] = useState(item?.service?.id ?? '');
  const [archived, setArchived] = useState(item?.archived ?? false);
  const [errors, setErrors] = useState<Errors>({});

  const input: VaccineInput = {
    name,
    kind,
    primaryDoses: Number(doses),
    primaryIntervalDays: Number(doses) > 1 ? intOrNull(interval) : null,
    boosterIntervalDays: intOrNull(booster),
    serviceId: serviceId || null,
    archived,
  };
  const save = useMutation({
    mutationFn: () =>
      item
        ? api('PUT', `/vaccines/${item.id}`, vaccineSchema, input)
        : api('POST', '/vaccines', vaccineSchema, input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: vaccinesQuery.queryKey });
      toast.success(item ? 'Alterações salvas.' : 'Vacina incluída.');
      onClose();
    },
    onError: (error) => {
      if (error instanceof ApiRequestError) {
        setErrors(Object.fromEntries(error.fieldErrors.map((f) => [f.path, f.message])));
      }
    },
  });
  const submit = () => {
    const parsed = vaccineInputSchema.safeParse(input);
    const local: Errors = parsed.success
      ? {}
      : Object.fromEntries(parsed.error.issues.map((i) => [i.path.join('.'), i.message]));
    setErrors(local);
    if (parsed.success) save.mutate();
  };
  const serviceOptions = (services.data ?? []).map((s) => ({ value: s.id, label: s.name }));
  if (item?.service && !serviceOptions.some((o) => o.value === item.service?.id)) {
    serviceOptions.push({ value: item.service.id, label: item.service.name });
  }
  // A prévia só depende da série e do reforço; o nome ainda pode estar em branco.
  const preview = vaccineInputSchema.safeParse({ ...input, name: 'prévia' }).success
    ? vaccinePeriodicity({
        primaryDoses: input.primaryDoses,
        primaryIntervalDays: input.primaryIntervalDays ?? null,
        boosterIntervalDays: input.boosterIntervalDays ?? null,
      })
    : null;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={item ? `Editar ${item.name}` : 'Nova vacina'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="vaccine-form" pending={save.isPending}>
            Salvar
          </Button>
        </>
      }
    >
      <form
        id="vaccine-form"
        noValidate
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {save.isError &&
        !(save.error instanceof ApiRequestError && save.error.fieldErrors.length) ? (
          <p
            role="alert"
            className="rounded-control bg-danger-50 px-3 py-2 text-sm text-danger-600"
          >
            {errorMessage(save.error)}
          </p>
        ) : null}
        <div className="grid gap-4 sm:grid-cols-[1fr_11rem]">
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
            label="Tipo"
            value={kind}
            options={vaccineKinds.map((k) => ({ value: k, label: vaccineKindLabels[k] }))}
            onChange={(e) => {
              setKind(e.target.value as VaccineKind);
            }}
          />
        </div>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <SelectField
            label="Doses da série"
            value={doses}
            options={Array.from({ length: VACCINE_MAX_DOSES }, (_, i) => ({
              value: String(i + 1),
              label: i === 0 ? 'Dose única' : `${String(i + 1)} doses`,
            }))}
            error={errors.primaryDoses}
            onChange={(e) => {
              setDoses(e.target.value);
            }}
          />
          {Number(doses) > 1 ? (
            <TextField
              label="Intervalo (dias)"
              inputMode="numeric"
              autoComplete="off"
              placeholder="Ex. 21"
              value={interval}
              error={errors.primaryIntervalDays}
              onChange={(e) => {
                setInterval(digits(e.target.value));
              }}
            />
          ) : null}
          <TextField
            label="Reforço (dias)"
            inputMode="numeric"
            autoComplete="off"
            placeholder="Sem reforço"
            hint="365 = anual"
            value={booster}
            error={errors.boosterIntervalDays}
            onChange={(e) => {
              setBooster(digits(e.target.value));
            }}
          />
        </div>
        {preview ? (
          <p className="rounded-control bg-sage-50 px-3 py-2 text-sm text-sage-700">
            Protocolo: {preview}.
          </p>
        ) : null}
        <SelectField
          label="Serviço cobrado"
          value={serviceId}
          placeholder={services.isError ? 'Sem acesso aos serviços' : 'Não cobra'}
          options={serviceOptions}
          hint="Lançado na venda aberta do animal a cada aplicação."
          error={errors.serviceId}
          onChange={(e) => {
            setServiceId(e.target.value);
          }}
        />
        {item ? (
          <Checkbox
            label="Arquivada"
            description="Some da aplicação na ficha; protocolos e aplicações antigas continuam."
            checked={archived}
            onCheckedChange={setArchived}
          />
        ) : null}
      </form>
    </Dialog>
  );
}
