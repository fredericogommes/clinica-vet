import { isPermission, permissionCatalog } from '@clinica/contracts';

const fieldLabels: Record<string, string> = {
  name: 'Nome',
  email: 'E-mail',
  description: 'Descrição',
  permissions: 'Permissões',
  role: 'Perfil',
  units: 'Unidades',
  active: 'Ativo',
  clonedFrom: 'Clonado de',
  archived: 'Arquivado',
  code: 'Código',
  personType: 'Tipo de pessoa',
  nationality: 'Nacionalidade',
  sex: 'Sexo',
  cpf: 'CPF',
  cnpj: 'CNPJ',
  rg: 'RG',
  birthDate: 'Nascimento',
  origin: 'Origem',
  profession: 'Profissão',
  municipalRegistration: 'Inscrição municipal',
  notes: 'Observações',
  contacts: 'Contatos',
  address: 'Endereço',
  status: 'Situação',
  deceasedOn: 'Óbito',
  sterilized: 'Castrado',
  species: 'Espécie',
  breed: 'Raça',
  coat: 'Pelagem',
  microchip: 'Microchip',
  hasPedigree: 'Pedigree',
  pedigreeNumber: 'Nº do pedigree',
  markings: 'Marcações',
  owner: 'Responsável',
  reason: 'Motivo',
  source: 'Origem do consentimento',
  sms: 'SMS',
  sms_campaign: 'Campanhas por SMS',
  whatsapp: 'WhatsApp',
  patientId: 'Animal',
  kind: 'Tipo',
  occurredAt: 'Data do evento',
  type: 'Tipo de atendimento',
  summary: 'Resumo',
  narrative: 'Prontuário',
  heartRate: 'FC (bpm)',
  respiratoryRate: 'FR (mpm)',
  temperature: 'Temperatura (°C)',
  capillaryRefill: 'TPC (s)',
  weightKg: 'Peso (kg)',
  bodyScore: 'Escore corporal',
  pathologies: 'Diagnósticos',
  pathology: 'Patologia',
  text: 'Texto',
  title: 'Título',
  body: 'Texto',
  template: 'Modelo',
  caption: 'Legenda',
  voidReason: 'Motivo da invalidação',
  durationMinutes: 'Duração (min)',
  recordTemplate: 'Modelo de prontuário',
  serviceKind: 'Classificação do serviço',
  unit: 'Unidade de venda',
  barcode: 'Código de barras',
  brand: 'Marca',
  group: 'Grupo',
  ncm: 'NCM',
  acquisition: 'Forma de aquisição',
  cfop: 'CFOP',
  taxSituation: 'CST/CSOSN',
  municipalServiceCode: 'Código do serviço',
  taxProfile: 'Perfil tributário',
  salePrice: 'Preço de venda (R$)',
  cost: 'Custo (R$)',
  purpose: 'Finalidade',
  desiredMarkup: 'Markup desejado (%)',
  allowPriceChange: 'Permite alterar preço',
  showInPriceList: 'Na lista de preços',
  discountLimitPercent: 'Limite de desconto (%)',
  defaultCommissionPercent: 'Comissão padrão (%)',
  commissions: 'Comissões por profissional',
  tracksStock: 'Controla estoque',
  minStock: 'Estoque mínimo',
  idealStock: 'Estoque ideal',
  saleType: 'Tipo de venda',
  client: 'Cliente',
  patient: 'Animal',
  items: 'Itens',
  discount: 'Desconto',
  grossTotal: 'Bruto (R$)',
  discountTotal: 'Desconto (R$)',
  netTotal: 'Total (R$)',
  defaultSaleType: 'Tipo de venda padrão',
};

/** Códigos gravados pela API traduzidos para o texto exibido. */
const valueLabels: Record<string, string> = {
  individual: 'Pessoa física',
  company: 'Pessoa jurídica',
  female: 'Feminino',
  male: 'Masculino',
  unknown: 'Não informado',
  alive: 'Vivo',
  deceased: 'Óbito',
  draft: 'Rascunho',
  published: 'Publicado',
  voided: 'Invalidado',
  encounter: 'Atendimento',
  weight: 'Peso',
  pathology: 'Patologia',
  observation: 'Observação',
  photo: 'Foto',
  document: 'Documento',
  prescription: 'Receita',
  product: 'Produto',
  service: 'Serviço',
  consultation: 'Consulta',
  vaccine: 'Vacina',
  surgery: 'Cirurgia',
  grooming: 'Banho e tosa',
  hospitalization: 'Internação',
  resale: 'Revenda',
  own_production: 'Produção própria',
  internal: 'Consumo interno',
};

const numberFormat = new Intl.NumberFormat('pt-BR', {
  maximumFractionDigits: 3,
  useGrouping: false,
});

const addressOrder = ['street', 'number', 'complement', 'district', 'city', 'state', 'cep'];

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function display(value: unknown): string {
  if (value === undefined || value === null || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Sim' : 'Não';
  if (Array.isArray(value)) return value.length === 0 ? 'nenhuma' : value.map(display).join(', ');
  if (typeof value === 'string') {
    if (isPermission(value)) return permissionCatalog[value].label;
    return valueLabels[value] ?? value;
  }
  if (typeof value === 'number') return numberFormat.format(value);
  const record = asRecord(value);
  if (typeof record.name === 'string') return record.name;
  // Contato: mostra o número ou e-mail; endereço e afins: junta as partes preenchidas.
  if (typeof record.value === 'string') return record.value;
  // O banco (jsonb) reordena as chaves; endereço volta à ordem de leitura.
  const ordered = 'street' in record ? addressOrder.map((k) => record[k]) : Object.values(record);
  const parts = ordered.filter(
    (v): v is string | number => (typeof v === 'string' && v !== '') || typeof v === 'number',
  );
  return parts.length > 0 ? parts.join(', ') : '—';
}

/** Lista só os campos que mudaram, no formato "campo: antes → depois". */
export function AuditChanges({ before, after }: { before: unknown; after: unknown }) {
  const a = asRecord(before);
  const b = asRecord(after);
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(
    (key) => JSON.stringify(a[key]) !== JSON.stringify(b[key]),
  );
  if (keys.length === 0) return <span className="text-ink-faint">—</span>;
  return (
    <dl className="space-y-1 text-xs">
      {keys.map((key) => (
        <div key={key} className="grid grid-cols-[88px_minmax(0,1fr)] gap-2">
          <dt className="text-ink-muted">{fieldLabels[key] ?? key}</dt>
          <dd className="break-words text-ink">
            {key in a ? (
              <span className="text-ink-muted line-through decoration-ink-faint">
                {display(a[key])}
              </span>
            ) : null}
            {key in a && key in b ? (
              <span className="px-1 text-ink-faint" aria-label="mudou para">
                →
              </span>
            ) : null}
            {key in b ? <span>{display(b[key])}</span> : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}
