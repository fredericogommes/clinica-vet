import {
  clientSchema,
  consentChannelLabels,
  consentChannels,
  updateConsentsRequestSchema,
  type Client,
  type ConsentChannel,
  type UpdateConsentsRequest,
} from '@clinica/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from '../../design-system/button';
import { Checkbox } from '../../design-system/checkbox';
import { Dialog } from '../../design-system/dialog';
import { TextField } from '../../design-system/field';
import { useToast } from '../../design-system/toast';
import { api, errorMessage } from '../../lib/api';
import { clientQuery } from './queries';

/** Estado vigente por canal: a linha mais recente do histórico (que vem ordenado do mais novo). */
export function currentConsents(client: Client): Record<ConsentChannel, boolean | null> {
  const current = Object.fromEntries(consentChannels.map((c) => [c, null])) as Record<
    ConsentChannel,
    boolean | null
  >;
  for (const c of [...client.consents].reverse()) current[c.channel] = c.granted;
  return current;
}

export function ConsentsDialog({
  client,
  open,
  onOpenChange,
}: {
  client: Client;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const current = currentConsents(client);
  const [granted, setGranted] = useState(() =>
    Object.fromEntries(consentChannels.map((c) => [c, current[c] === true])),
  );
  const [source, setSource] = useState('');
  const [sourceError, setSourceError] = useState<string>();

  const save = useMutation({
    mutationFn: (body: UpdateConsentsRequest) =>
      api('PUT', `/clients/${client.id}/consents`, clientSchema, body),
    onSuccess: (saved) => {
      queryClient.setQueryData(clientQuery(client.id).queryKey, saved);
      toast.success('Consentimento registrado.');
      onOpenChange(false);
    },
  });
  const formId = 'consents-form';

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Privacidade e comunicação"
      description="Registre em quais canais o cliente aceita receber mensagens. Cada mudança fica no histórico com data, origem e autor."
      footer={
        <>
          <Button
            variant="secondary"
            onClick={() => {
              onOpenChange(false);
            }}
          >
            Cancelar
          </Button>
          <Button type="submit" form={formId} pending={save.isPending}>
            Registrar
          </Button>
        </>
      }
    >
      <form
        id={formId}
        noValidate
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          const body = updateConsentsRequestSchema.safeParse({
            source,
            channels: consentChannels.map((channel) => ({
              channel,
              granted: granted[channel] ?? false,
            })),
          });
          setSourceError(body.success ? undefined : body.error.issues[0]?.message);
          if (body.success) save.mutate(body.data);
        }}
      >
        {save.isError ? (
          <p
            role="alert"
            className="rounded-control bg-danger-50 px-3 py-2 text-sm text-danger-600"
          >
            {errorMessage(save.error)}
          </p>
        ) : null}
        <fieldset className="space-y-2.5 rounded-control border border-line p-3">
          <legend className="px-1 text-[13px] font-medium text-ink">Aceita receber por</legend>
          {consentChannels.map((channel) => (
            <Checkbox
              key={channel}
              label={consentChannelLabels[channel]}
              checked={granted[channel] ?? false}
              onCheckedChange={(checked) => {
                setGranted((g) => ({ ...g, [channel]: checked }));
              }}
            />
          ))}
        </fieldset>
        <TextField
          label="Como o consentimento foi obtido"
          placeholder="Ex.: Termo assinado no balcão"
          value={source}
          error={sourceError}
          onChange={(e) => {
            setSource(e.target.value);
          }}
        />
      </form>
    </Dialog>
  );
}
