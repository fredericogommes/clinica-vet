import { formatAge } from '@clinica/contracts';
import { useQuery } from '@tanstack/react-query';
import { Printer } from 'lucide-react';
import { Button } from '../../design-system/button';
import { ErrorState, SkeletonRows } from '../../design-system/states';
import { errorMessage } from '../../lib/api';
import { useSession } from '../../lib/session';
import { formatPhone } from '../clients/format';
import { formatKg, zoned } from './labels';
import { clinicalEventQuery, clinicalRecordQuery } from './queries';

/** Receita ou documento em folha A4, fora do layout do sistema, para imprimir ou salvar em PDF. */
export function PrintEventPage({ eventId }: { eventId: string }) {
  const session = useSession();
  const event = useQuery(clinicalEventQuery(eventId));
  const record = useQuery({
    ...clinicalRecordQuery(event.data?.patientId ?? ''),
    enabled: Boolean(event.data),
  });

  if (event.isError || record.isError) {
    return (
      <ErrorState
        message={errorMessage(event.error ?? record.error)}
        onRetry={() => {
          void event.refetch();
          void record.refetch();
        }}
      />
    );
  }
  if (!event.data || !record.data) return <SkeletonRows rows={6} columns={1} />;
  const e = event.data;
  const r = record.data;
  if (e.data.kind !== 'document' && e.data.kind !== 'prescription') {
    return <ErrorState message="Só receitas e documentos são impressos." onRetry={() => {}} />;
  }
  const z = zoned(r.timeZone);
  const p = r.patient;
  const patientLine = [
    p.speciesName,
    p.breedName,
    p.birthDate ? formatAge(p.birthDate) : null,
    r.currentWeight ? formatKg(r.currentWeight.weightKg) : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="min-h-dvh bg-sunken py-8 print:bg-surface print:py-0">
      <div className="mx-auto mb-4 flex max-w-[210mm] justify-end gap-2 px-4 print:hidden">
        <Button
          icon={<Printer className="size-4" aria-hidden />}
          onClick={() => {
            window.print();
          }}
        >
          Imprimir
        </Button>
        <Button
          variant="secondary"
          onClick={() => {
            window.close();
          }}
        >
          Fechar
        </Button>
      </div>
      <article className="mx-auto flex min-h-[297mm] max-w-[210mm] flex-col bg-surface px-[18mm] py-[16mm] text-[13px] leading-relaxed shadow-panel print:min-h-0 print:shadow-none">
        <header className="border-b border-line-strong pb-3">
          <p className="font-display text-lg font-semibold">{session.organization.name}</p>
          <p className="text-ink-muted">{session.currentUnit.name}</p>
        </header>
        <h1 className="mt-6 text-center font-display text-xl font-semibold uppercase">
          {e.data.title}
        </h1>
        <dl className="mt-5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
          <dt className="text-ink-muted">Paciente</dt>
          <dd>
            <strong>{p.name}</strong> (#{p.code}){patientLine ? ` · ${patientLine}` : ''}
          </dd>
          <dt className="text-ink-muted">Responsável</dt>
          <dd>
            {r.owner.name}
            {r.owner.phone ? ` · ${formatPhone(r.owner.phone)}` : ''}
          </dd>
        </dl>
        <div className="mt-6 flex-1 whitespace-pre-wrap">{e.data.body}</div>
        <footer className="mt-16 flex flex-col items-center">
          <span className="w-72 border-t border-ink pt-1 text-center">{e.professional.name}</span>
          <span className="text-ink-muted">{z.dateTime(e.occurredAt).slice(0, 10)}</span>
        </footer>
      </article>
    </div>
  );
}
