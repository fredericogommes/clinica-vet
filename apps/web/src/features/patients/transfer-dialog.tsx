import { patientSchema, type Patient } from '@clinica/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { useState } from 'react';
import { clsx } from 'clsx';
import { Button } from '../../design-system/button';
import { Dialog } from '../../design-system/dialog';
import { SearchField, TextField } from '../../design-system/field';
import { useToast } from '../../design-system/toast';
import { api, errorMessage } from '../../lib/api';
import { useDebounced } from '../../lib/use-debounced';
import { formatPhone } from '../clients/format';
import { clientsQuery } from '../clients/queries';
import { patientQuery } from './queries';

/** Troca de responsável (RN-05): o vínculo atual é encerrado e fica no histórico do animal. */
export function TransferDialog({
  patient,
  onOpenChange,
}: {
  patient: Patient;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [term, setTerm] = useState('');
  const q = useDebounced(term.trim());
  const [selected, setSelected] = useState<{ id: string; name: string } | null>(null);
  const [reason, setReason] = useState('');
  const candidates = useQuery({
    ...clientsQuery({ q, page: 1, archived: false }, 8),
    enabled: q.length >= 2,
  });

  const transfer = useMutation({
    mutationFn: (clientId: string) =>
      api('POST', `/patients/${patient.id}/transfer`, patientSchema, { clientId, reason }),
    onSuccess: async (saved) => {
      queryClient.setQueryData(patientQuery(patient.id).queryKey, saved);
      await queryClient.invalidateQueries({ queryKey: ['clients'] });
      await queryClient.invalidateQueries({ queryKey: ['patients', 'list'] });
      toast.success(`${saved.name} agora está com ${saved.owner.name}.`);
      onOpenChange(false);
    },
  });
  const options = (candidates.data?.items ?? []).filter((c) => c.id !== patient.owner.id);

  return (
    <Dialog
      open
      onOpenChange={onOpenChange}
      title={`Trocar responsável de ${patient.name}`}
      description={`Responsável atual: ${patient.owner.name}. O histórico clínico e de vendas continua com o animal.`}
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
          <Button
            disabled={!selected}
            pending={transfer.isPending}
            onClick={() => {
              if (selected) transfer.mutate(selected.id);
            }}
          >
            Confirmar troca
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {transfer.isError ? (
          <p
            role="alert"
            className="rounded-control bg-danger-50 px-3 py-2 text-sm text-danger-600"
          >
            {errorMessage(transfer.error)}
          </p>
        ) : null}
        <SearchField
          label="Buscar novo responsável"
          placeholder="Nome, CPF ou telefone do novo responsável"
          icon={<Search className="size-4" aria-hidden />}
          value={term}
          autoFocus
          onChange={(e) => {
            setTerm(e.target.value);
          }}
        />
        {q.length >= 2 ? (
          <div
            role="radiogroup"
            aria-label="Novo responsável"
            className="max-h-60 space-y-1 overflow-y-auto"
          >
            {candidates.isPending ? (
              <p className="px-1 text-sm text-ink-muted">Buscando…</p>
            ) : options.length === 0 ? (
              <p className="px-1 text-sm text-ink-muted">
                Nenhum cliente ativo encontrado. Cadastre o novo responsável antes da troca.
              </p>
            ) : (
              options.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  role="radio"
                  aria-checked={selected?.id === c.id}
                  onClick={() => {
                    setSelected({ id: c.id, name: c.name });
                  }}
                  className={clsx(
                    'flex w-full items-center justify-between rounded-control border px-3 py-2 text-left text-sm',
                    selected?.id === c.id
                      ? 'border-sage-600 bg-sage-50'
                      : 'border-line hover:bg-sunken',
                  )}
                >
                  <span className="font-medium">{c.name}</span>
                  <span className="font-mono text-xs text-ink-muted">
                    {c.primaryPhone ? formatPhone(c.primaryPhone) : `#${c.code}`}
                  </span>
                </button>
              ))
            )}
          </div>
        ) : null}
        <TextField
          label="Motivo (opcional)"
          placeholder="Ex.: Doação, venda, mudança de tutor"
          maxLength={200}
          value={reason}
          onChange={(e) => {
            setReason(e.target.value);
          }}
        />
      </div>
    </Dialog>
  );
}
