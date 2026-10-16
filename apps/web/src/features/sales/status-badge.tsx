import { saleStatusLabels, type SaleStatus } from '@clinica/contracts';
import { Badge } from '../../design-system/layout';

const statusTone: Record<SaleStatus, 'neutral' | 'sage' | 'amber' | 'danger'> = {
  quote: 'neutral',
  open: 'amber',
  closed: 'sage',
  cancelled: 'danger',
};

export function StatusBadge({ status }: { status: SaleStatus }) {
  return <Badge tone={statusTone[status]}>{saleStatusLabels[status]}</Badge>;
}
