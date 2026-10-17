import {
  formatAge,
  hospitalizationEntryKindLabels,
  hospitalizationPriorityLabels,
  hospitalizationStatusLabels,
} from '@clinica/contracts';
import { useQuery } from '@tanstack/react-query';
import { Printer } from 'lucide-react';
import { Button } from '../../design-system/button';
import { ErrorState, SkeletonRows } from '../../design-system/states';
import { errorMessage } from '../../lib/api';
import { formatCalendarDate } from '../../lib/format';
import { useSession } from '../../lib/session';
import { formatPhone } from '../clients/format';
import { formatKg, zoned } from '../clinical/labels';
import { patientSexLabels } from '../patients/labels';
import { formatLongDay, localToday } from '../schedule/dates';
import { doseState, doseStateLabels, doseText, posology } from './dose';
import { hospitalizationQuery, prescriptionDayQuery } from './queries';
import { formatDuration, parameterItems } from './labels';

const marks = { done: '✓', skipped: '✗', overdue: '!', pending: '' } as const;

/**
 * Ficha de internação impressa [p.14]: dados do animal e da internação, a prescrição do dia com
 * os horários e o que foi registrado, e o histórico completo, em folha A4.
 */
export function PrintHospitalizationPage({ id }: { id: string }) {
  const session = useSession();
  const detail = useQuery(hospitalizationQuery(id));
  const day = useQuery(prescriptionDayQuery(id, localToday()));

  if (detail.isError || day.isError) {
    return (
      <ErrorState
        message={errorMessage(detail.error ?? day.error)}
        onRetry={() => {
          void detail.refetch();
          void day.refetch();
        }}
      />
    );
  }
  if (!detail.data || !day.data) return <SkeletonRows rows={6} columns={1} />;
  const h = detail.data;
  const d = day.data;
  const z = zoned(d.timeZone);
  const p = h.patient;
  const animal = [
    p.species,
    p.breed,
    patientSexLabels[p.sex],
    p.birthDate ? formatAge(p.birthDate) : null,
    p.weightKg === null ? null : formatKg(p.weightKg),
  ]
    .filter(Boolean)
    .join(' · ');
  const facts: [string, string][] = [
    ['Paciente', `${p.name} (#${String(p.code)})${animal ? ` · ${animal}` : ''}`],
    ['Responsável', `${h.client.name}${h.client.phone ? ` · ${formatPhone(h.client.phone)}` : ''}`],
    ['Veterinário', h.veterinarian.name],
    [
      'Situação',
      h.status === 'admitted'
        ? `${hospitalizationStatusLabels[h.status]} · ${hospitalizationPriorityLabels[h.priority]}`
        : hospitalizationStatusLabels[h.status],
    ],
    ['Internado em', `${z.dateTime(h.admittedAt)} (${formatDuration(h.admittedAt, h.endedAt)})`],
    h.endedAt
      ? ['Encerrada em', z.dateTime(h.endedAt)]
      : [
          'Previsão de alta',
          h.expectedDischargeOn ? formatCalendarDate(h.expectedDischargeOn) : 'Sem previsão',
        ],
    ['Box', h.box ? `${h.box.code} · ${h.box.name}` : 'Sem box'],
    ['Motivo', h.reason],
  ];
  if (h.outcome) facts.push(['Desfecho', h.outcome]);

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
      <article className="mx-auto max-w-[210mm] bg-surface px-[14mm] py-[12mm] text-[12px] leading-relaxed shadow-panel print:shadow-none">
        <header className="flex items-end justify-between border-b border-line-strong pb-3">
          <div>
            <p className="font-display text-lg font-semibold">{session.organization.name}</p>
            <p className="text-ink-muted">{h.unit.name}</p>
          </div>
          <p className="text-ink-muted">Impresso em {z.dateTime(new Date().toISOString())}</p>
        </header>
        <h1 className="mt-5 font-display text-xl font-semibold">Ficha de internação nº {h.code}</h1>
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5">
          {facts.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-ink-muted">{label}</dt>
              <dd className="break-words whitespace-pre-line">{value}</dd>
            </div>
          ))}
        </dl>

        <h2 className="mt-6 border-b border-line pb-1 font-display text-[15px] font-semibold">
          Prescrição de {formatLongDay(d.date)}
        </h2>
        {d.prescriptions.length === 0 ? (
          <p className="mt-2 text-ink-muted">Nenhuma prescrição neste dia.</p>
        ) : (
          <table className="mt-2 w-full border-collapse">
            <thead>
              <tr className="text-left text-ink-muted">
                <th className="py-1 pr-2 font-medium">Medicamento</th>
                <th className="py-1 pr-2 font-medium">Dose por horário</th>
                <th className="py-1 font-medium">Horários (✓ executado, ✗ não executado)</th>
              </tr>
            </thead>
            <tbody>
              {d.prescriptions.map((rx) => (
                <tr key={rx.id} className="border-t border-line align-top">
                  <td className="py-1.5 pr-2">
                    <strong>{rx.name}</strong>
                    {rx.stopped ? ' (suspensa)' : ''}
                    <span className="block text-ink-muted">{posology(rx)}</span>
                    {rx.notes ? <span className="block text-ink-muted">{rx.notes}</span> : null}
                  </td>
                  <td className="py-1.5 pr-2">{doseText(rx, d.weightKg)}</td>
                  <td className="py-1.5">
                    {rx.doses.length === 0
                      ? 'Sem horário no dia'
                      : rx.doses.map((dose) => {
                          const state = doseState(dose);
                          return (
                            <span
                              key={dose.scheduledAt}
                              className="mr-1.5 mb-1 inline-block rounded border border-line-strong px-1 font-mono"
                              title={doseStateLabels[state]}
                            >
                              {z.time(dose.scheduledAt)} {marks[state]}
                              {dose.execution ? ` ${dose.execution.by.split(' ')[0] ?? ''}` : ''}
                            </span>
                          );
                        })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <h2 className="mt-6 border-b border-line pb-1 font-display text-[15px] font-semibold">
          Histórico
        </h2>
        <ol className="mt-1">
          {h.entries.map((e) => (
            <li key={e.id} className="break-inside-avoid border-b border-line py-1.5">
              <p>
                <strong>{hospitalizationEntryKindLabels[e.kind]}</strong>
                <span className="text-ink-muted">
                  {' '}
                  · {z.dateTime(e.occurredAt)} · {e.author}
                </span>
              </p>
              {e.weightKg !== null ? <p>{formatKg(e.weightKg)}</p> : null}
              {e.parameters ? <p>{parameterItems(e.parameters).join(' · ')}</p> : null}
              {e.text ? <p className="break-words whitespace-pre-line">{e.text}</p> : null}
            </li>
          ))}
        </ol>

        <footer className="mt-14 flex flex-col items-center">
          <span className="w-72 border-t border-ink pt-1 text-center">{h.veterinarian.name}</span>
          <span className="text-ink-muted">Veterinário responsável</span>
        </footer>
      </article>
    </div>
  );
}
