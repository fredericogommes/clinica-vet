/**
 * Catálogo de ações autorizáveis. A chave é a unidade de autorização verificada no
 * servidor; o frontend usa o mesmo catálogo apenas para esconder controles.
 * Novas telas acrescentam suas ações aqui, nunca checam por perfil ou por nome de tela.
 */
export const permissionCatalog = {
  'clients.view': { group: 'Clientes e animais', label: 'Ver clientes' },
  'clients.manage': {
    group: 'Clientes e animais',
    label: 'Cadastrar e editar clientes e consentimentos',
  },
  'clients.archive': { group: 'Clientes e animais', label: 'Arquivar e restaurar clientes' },
  'patients.view': { group: 'Clientes e animais', label: 'Ver animais' },
  'patients.manage': { group: 'Clientes e animais', label: 'Cadastrar e editar animais' },
  'patients.transfer_owner': {
    group: 'Clientes e animais',
    label: 'Trocar o responsável de um animal',
  },
  'patients.archive': { group: 'Clientes e animais', label: 'Arquivar e restaurar animais' },
  'clients.delete': {
    group: 'Clientes e animais',
    label: 'Excluir definitivamente clientes sem animais nem agendamentos',
  },
  'patients.delete': {
    group: 'Clientes e animais',
    label: 'Excluir definitivamente animais sem histórico clínico nem agendamentos',
  },
  'clinical.view': {
    group: 'Atendimento clínico',
    label: 'Ver a ficha clínica e a linha do tempo',
  },
  'clinical.record': {
    group: 'Atendimento clínico',
    label: 'Registrar atendimentos e eventos clínicos e corrigir os próprios',
  },
  'clinical.edit_any': {
    group: 'Atendimento clínico',
    label: 'Corrigir e invalidar eventos clínicos de outros profissionais',
  },
  'clinical.change_datetime': {
    group: 'Atendimento clínico',
    label: 'Registrar evento clínico com data e hora retroativas',
  },
  'schedule.view': { group: 'Agenda', label: 'Ver agenda e escala' },
  'schedule.manage': {
    group: 'Agenda',
    label: 'Agendar, remarcar e mudar o status dos agendamentos',
  },
  'schedule.fit_in': { group: 'Agenda', label: 'Encaixar fora da escala do profissional' },
  'schedule.configure': {
    group: 'Agenda',
    label: 'Configurar horário de funcionamento, profissionais e escala',
  },
  'products.view': {
    group: 'Estoque e serviços',
    label: 'Ver produtos, serviços e preços de venda',
  },
  'products.manage': {
    group: 'Estoque e serviços',
    label: 'Cadastrar, editar e arquivar produtos e serviços',
  },
  'products.view_cost': {
    group: 'Estoque e serviços',
    label: 'Ver e alterar custo e markup dos produtos',
  },
  'inventory.adjust': {
    group: 'Estoque e serviços',
    label: 'Lançar entrada de estoque e ajustar o saldo pela contagem',
  },
  'sales.view': { group: 'Vendas', label: 'Ver vendas e orçamentos' },
  'sales.manage': {
    group: 'Vendas',
    label: 'Lançar e editar vendas e orçamentos em aberto',
  },
  'sales.discount': {
    group: 'Vendas',
    label: 'Conceder desconto, até o limite do item, do usuário ou da clínica',
  },
  'sales.change_price': {
    group: 'Vendas',
    label: 'Alterar o preço de itens que permitem preço livre na venda',
  },
  'sales.cancel': { group: 'Vendas', label: 'Cancelar vendas e orçamentos em aberto' },
  'sales.receive': {
    group: 'Vendas',
    label: 'Registrar recebimento e baixar vendas, com pagamento dividido',
  },
  'sales.reverse': {
    group: 'Vendas',
    label: 'Estornar vendas baixadas, devolvendo pelo caixa',
  },
  'sales.reports': {
    group: 'Vendas',
    label: 'Consultar vendas da unidade: resumo, totais por produto e serviço e lista',
  },
  'sales.view_own': {
    group: 'Vendas',
    label: 'Ver as próprias vendas (Minhas vendas)',
  },
  'cash.operate': {
    group: 'Caixa',
    label: 'Abrir e fechar o próprio caixa, lançar sangria e suprimento',
  },
  'cash.supervise': {
    group: 'Caixa',
    label: 'Ver os caixas de todos os operadores e fechar caixa de outro operador',
  },
  'sales.configure': {
    group: 'Vendas',
    label:
      'Configurar vendas: limite de desconto da clínica, tipo de venda padrão e formas de recebimento',
  },
  'catalogs.manage': {
    group: 'Cadastros',
    label:
      'Editar espécies, raças, pelagens, origens de clientes, tipos de atendimento, patologias, modelos de receita e documento, grupos e marcas de produto',
  },
  'dashboard.indicators': {
    group: 'Painel',
    label: 'Indicadores da base e da agenda: animais, responsáveis, espera, atendimento e arquivos',
  },
  'dashboard.sales_indicators': {
    group: 'Painel',
    label: 'Indicadores de venda: venda líquida, débitos de clientes, descontos e ticket médio',
  },
  'dashboard.patients_growth': { group: 'Painel', label: 'Animais por mês e por ano' },
  'dashboard.consultations': { group: 'Painel', label: 'Consultas por mês' },
  'dashboard.recent_encounters': { group: 'Painel', label: 'Últimos atendimentos (24 horas)' },
  'dashboard.recent_patients': { group: 'Painel', label: 'Últimos animais cadastrados' },
  'dashboard.client_lifecycle': { group: 'Painel', label: 'Ciclo de vida dos clientes' },
  'dashboard.recent_logins': { group: 'Painel', label: 'Últimos acessos ao sistema' },
  'dashboard.low_stock': { group: 'Painel', label: 'Estoque abaixo do mínimo' },
  'admin.users.view': { group: 'Configuração', label: 'Ver usuários' },
  'admin.users.manage': { group: 'Configuração', label: 'Cadastrar e editar usuários' },
  'admin.roles.view': { group: 'Configuração', label: 'Ver perfis de acesso' },
  'admin.roles.manage': { group: 'Configuração', label: 'Criar, clonar e editar perfis de acesso' },
  'admin.audit.view': { group: 'Consultas', label: 'Ver log de auditoria' },
  'reports.vaccination': {
    group: 'Consultas',
    label: 'Vacinação: animais com dose vencida ou a vencer e contato do responsável',
  },
  'messages.view': {
    group: 'Mensagens',
    label: 'Ver a fila e o histórico de mensagens e enviar pelo WhatsApp da clínica',
  },
  'messages.configure': {
    group: 'Mensagens',
    label: 'Ligar, desligar e editar as mensagens automáticas',
  },
} as const satisfies Record<string, { group: string; label: string }>;

export type Permission = keyof typeof permissionCatalog;

export const allPermissions = Object.keys(permissionCatalog) as Permission[];

export function isPermission(value: string): value is Permission {
  return Object.hasOwn(permissionCatalog, value);
}
