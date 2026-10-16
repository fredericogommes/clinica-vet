import { useMutation } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Button } from '../../design-system/button';
import { Dialog } from '../../design-system/dialog';
import { apiVoid, errorMessage } from '../../lib/api';

/**
 * Exclusão definitiva de ficha [RN-21]. A API só aceita ficha sem histórico; quando recusa,
 * o motivo aparece no diálogo e o caminho indicado é arquivar.
 */
export function DeleteRecordButton({
  name,
  path,
  description,
  onDeleted,
}: {
  name: string;
  path: string;
  description: string;
  onDeleted: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const remove = useMutation({
    mutationFn: () => apiVoid('DELETE', path),
    onSuccess: onDeleted,
  });
  return (
    <>
      <Button
        variant="ghost"
        icon={<Trash2 className="size-4" aria-hidden />}
        onClick={() => {
          remove.reset();
          setOpen(true);
        }}
      >
        Excluir
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={`Excluir ${name} definitivamente?`}
        description={description}
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setOpen(false);
              }}
            >
              Cancelar
            </Button>
            <Button
              variant="danger"
              pending={remove.isPending}
              disabled={remove.isError}
              onClick={() => {
                remove.mutate();
              }}
            >
              Excluir definitivamente
            </Button>
          </>
        }
      >
        {remove.isError ? (
          <p
            role="alert"
            className="rounded-control bg-danger-50 px-3 py-2 text-sm text-danger-600"
          >
            {errorMessage(remove.error)}
          </p>
        ) : (
          <p className="text-sm text-ink-muted">
            Só fichas sem histórico podem ser excluídas. A exclusão fica registrada na auditoria.
          </p>
        )}
      </Dialog>
    </>
  );
}
