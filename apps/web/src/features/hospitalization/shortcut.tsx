import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { clsx } from 'clsx';
import { BedDouble } from 'lucide-react';
import { useState } from 'react';
import { Button, buttonClasses } from '../../design-system/button';
import { useCan } from '../../lib/session';
import { AdmitDialog } from './dialogs';
import { openHospitalizationQuery } from './queries';

/**
 * Internação a partir da ficha clínica [p.4]: leva à internação aberta do animal ou abre o
 * formulário de internação já com o animal escolhido.
 */
export function HospitalizationShortcut({
  patient,
  className,
}: {
  patient: { id: string; name: string; detail: string; alive: boolean; archived: boolean };
  className?: string;
}) {
  const can = useCan();
  const allowed = can('hospitalization.view');
  const open = useQuery({ ...openHospitalizationQuery(patient.id), enabled: allowed });
  const [admitting, setAdmitting] = useState(false);
  if (!allowed || !open.isSuccess) return null;
  if (open.data) {
    return (
      <Link
        to="/internacao/$hospitalizationId"
        params={{ hospitalizationId: open.data.id }}
        className={clsx(buttonClasses('secondary', 'sm'), className)}
      >
        <BedDouble className="size-4" aria-hidden />
        Internado: ver internação
      </Link>
    );
  }
  if (!can('hospitalization.manage') || !patient.alive || patient.archived) return null;
  return (
    <>
      <Button
        size="sm"
        variant="secondary"
        className={className}
        icon={<BedDouble className="size-4" aria-hidden />}
        onClick={() => {
          setAdmitting(true);
        }}
      >
        Internar
      </Button>
      {admitting ? (
        <AdmitDialog
          patient={{ id: patient.id, name: patient.name, detail: patient.detail }}
          onClose={() => {
            setAdmitting(false);
          }}
        />
      ) : null}
    </>
  );
}
