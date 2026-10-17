import { useQuery } from '@tanstack/react-query';
import { ScrollText } from 'lucide-react';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { buttonClasses } from '../../design-system/button';
import { Badge, PageHeader, Panel } from '../../design-system/layout';
import { EmptyState, ErrorState, SkeletonRows } from '../../design-system/states';
import { DataTable, Pagination } from '../../design-system/table';
import { errorMessage } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import { AuditChanges } from './audit-changes';
import { auditQuery } from './queries';

const entityLabels: Record<string, string> = {
  role: 'Perfil',
  user: 'Usuário',
  session: 'Sessão',
  client: 'Cliente',
  patient: 'Animal',
  species: 'Espécie',
  breed: 'Raça',
  coat: 'Pelagem',
  client_origin: 'Origem de cliente',
  appointment: 'Agendamento',
  appointment_type: 'Tipo de atendimento',
  clinical_event: 'Evento clínico',
  pathology: 'Patologia',
  clinical_template: 'Modelo de texto',
  product: 'Produto ou serviço',
  product_group: 'Grupo de produtos',
  product_brand: 'Marca',
  sale: 'Venda',
  client_package: 'Pacote do cliente',
  hospitalization: 'Internação',
  box: 'Box de internação',
  prescription: 'Prescrição da internação',
  sales_settings: 'Configuração de vendas',
  payment_method: 'Forma de recebimento',
  cash_session: 'Caixa',
  financial_account: 'Conta financeira',
  financial_category: 'Categoria financeira',
  financial_entry: 'Lançamento financeiro',
  supplier: 'Fornecedor',
  card_settlement: 'Conciliação de cartão',
};
const actionLabels: Record<string, string> = {
  create: 'Criou',
  update: 'Alterou',
  delete: 'Excluiu',
  clone: 'Clonou',
  login: 'Entrou',
  archive: 'Arquivou',
  restore: 'Restaurou',
  consent: 'Registrou consentimento',
  transfer_owner: 'Trocou responsável',
  publish: 'Publicou',
  void: 'Invalidou',
  discard: 'Descartou rascunho',
  convert: 'Converteu orçamento em venda',
  cancel: 'Cancelou',
  add_item: 'Lançou item pela ficha',
  receive: 'Registrou recebimento',
  reverse: 'Estornou venda',
  settle: 'Recebeu da conta do cliente',
  use_session: 'Registrou sessão do pacote',
  undo_session: 'Desfez sessão do pacote',
  open: 'Abriu',
  close: 'Fechou',
  supply: 'Suprimento',
  withdrawal: 'Sangria',
  stock_entry: 'Lançou entrada de estoque',
  stock_count: 'Registrou contagem de estoque',
  pay: 'Registrou pagamento',
  reopen: 'Desfez a baixa',
  transfer: 'Transferiu entre contas',
  reconcile: 'Conciliou depósito',
  undo: 'Desfez',
  admit: 'Internou',
  move_box: 'Trocou de box',
  discharge: 'Deu alta',
  death: 'Registrou óbito',
  entry_occurrence: 'Registrou ocorrência',
  entry_weight: 'Registrou peso',
  entry_parameters: 'Registrou parâmetros clínicos',
  entry_report: 'Registrou relatório médico',
  stop: 'Suspendeu',
  execute: 'Registrou execução',
};

export interface AuditFilter {
  entity: string;
  entityId: string;
  /** Nome do registro, só para o cabeçalho; a filtragem usa o id. */
  label: string;
}

export function AuditPage({ filter }: { filter?: AuditFilter | undefined }) {
  const [page, setPage] = useState(1);
  const pageSize = 25;
  const audit = useQuery(auditQuery(page, pageSize, filter));

  return (
    <>
      <PageHeader
        area="Consultas"
        title={filter ? `Histórico de alterações · ${filter.label}` : 'Auditoria'}
        description="Quem alterou o quê e quando, com o valor anterior e o novo."
        {...(filter
          ? {
              actions: (
                <Link to="/consultas/auditoria" className={buttonClasses('secondary')}>
                  Ver toda a auditoria
                </Link>
              ),
            }
          : {})}
      />
      <Panel>
        {audit.isPending ? (
          <SkeletonRows />
        ) : audit.isError ? (
          <ErrorState message={errorMessage(audit.error)} onRetry={() => void audit.refetch()} />
        ) : audit.data.total === 0 ? (
          <EmptyState
            icon={ScrollText}
            title="Nenhum registro"
            description="As alterações aparecem aqui."
          />
        ) : (
          <>
            <DataTable
              caption="Registros de auditoria"
              rows={audit.data.items}
              rowKey={(a) => a.id}
              columns={[
                {
                  header: 'Quando',
                  cell: (a) => (
                    <span className="font-mono text-xs">{formatDateTime(a.occurredAt)}</span>
                  ),
                },
                { header: 'Quem', cell: (a) => a.actorName ?? 'Sistema' },
                {
                  header: 'O quê',
                  cell: (a) => (
                    <span className="flex items-center gap-2">
                      {actionLabels[a.action] ?? a.action}
                      <Badge>{entityLabels[a.entity] ?? a.entity}</Badge>
                    </span>
                  ),
                },
                {
                  header: 'Alterações',
                  className: 'min-w-64',
                  cell: (a) => <AuditChanges before={a.before} after={a.after} />,
                },
              ]}
            />
            <Pagination
              page={page}
              pageSize={pageSize}
              total={audit.data.total}
              onPageChange={setPage}
            />
          </>
        )}
      </Panel>
    </>
  );
}
