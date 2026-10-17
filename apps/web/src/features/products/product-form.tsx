import {
  acquisitionFormLabels,
  acquisitionForms,
  markupPercent,
  priceForMarkup,
  productInputSchema,
  productOriginLabels,
  productOrigins,
  productPurposeLabels,
  productPurposes,
  saleUnitLabels,
  saleUnits,
  serviceKindLabels,
  serviceKinds,
  type Product,
  type ProductData,
  type ProductInput,
} from '@clinica/contracts';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { Controller, useFieldArray, useForm, useWatch, type Resolver } from 'react-hook-form';
import { Button } from '../../design-system/button';
import { Checkbox } from '../../design-system/checkbox';
import { Segmented, SelectField, TextField } from '../../design-system/field';
import { Section } from '../../design-system/layout';
import { applyFieldErrors, emptyToNull } from '../../lib/forms';
import { catalogQuery } from '../catalogs/queries';
import {
  formatMoney,
  formatPercent,
  moneyInput,
  parseDecimal,
  percentInput,
  quantityInput,
} from './format';
import { professionalsQuery } from './queries';

type NumberField =
  | 'salePrice'
  | 'cost'
  | 'desiredMarkup'
  | 'discountLimitPercent'
  | 'defaultCommissionPercent'
  | 'minStock'
  | 'idealStock';

/** Números ficam como texto no formulário, para aceitar vírgula; viram número só ao validar. */
export type ProductFormValues = Omit<ProductInput, NumberField | 'commissions'> &
  Record<NumberField, string> & { commissions: { userId: string; percent: string }[] };

export const emptyProduct: ProductFormValues = {
  kind: 'product',
  serviceKind: null,
  name: '',
  unit: 'un',
  barcode: '',
  brandId: null,
  groupId: null,
  ncm: '',
  origin: '0',
  acquisition: 'resale',
  cfop: '',
  taxSituation: '',
  municipalServiceCode: '',
  taxProfile: '',
  salePrice: '',
  cost: '',
  purpose: 'sale',
  desiredMarkup: '',
  allowPriceChange: false,
  showInPriceList: true,
  discountLimitPercent: '',
  defaultCommissionPercent: '0',
  commissions: [],
  tracksStock: true,
  tracksLots: false,
  minStock: '',
  idealStock: '',
};

export function productToForm(p: Product): ProductFormValues {
  return {
    kind: p.kind,
    serviceKind: p.serviceKind,
    name: p.name,
    unit: p.unit,
    barcode: p.barcode ?? '',
    brandId: p.brand?.id ?? null,
    groupId: p.group?.id ?? null,
    ncm: p.ncm ?? '',
    origin: p.origin,
    acquisition: p.acquisition,
    cfop: p.cfop ?? '',
    taxSituation: p.taxSituation ?? '',
    municipalServiceCode: p.municipalServiceCode ?? '',
    taxProfile: p.taxProfile,
    salePrice: moneyInput(p.salePrice),
    cost: moneyInput(p.cost),
    purpose: p.purpose,
    desiredMarkup: percentInput(p.desiredMarkup),
    allowPriceChange: p.allowPriceChange,
    showInPriceList: p.showInPriceList,
    discountLimitPercent: percentInput(p.discountLimitPercent),
    defaultCommissionPercent: percentInput(p.defaultCommissionPercent),
    commissions: p.commissions.map((c) => ({
      userId: c.userId,
      percent: percentInput(c.percent),
    })),
    tracksStock: p.tracksStock,
    tracksLots: p.tracksLots,
    minStock: quantityInput(p.minStock),
    idealStock: quantityInput(p.idealStock),
  };
}

/** Obrigatório vazio vira NaN, que o contrato recusa com "Informe um valor". */
const required = (text: string) => parseDecimal(text) ?? Number.NaN;

export function formToInput(v: ProductFormValues): ProductInput {
  return {
    ...v,
    salePrice: required(v.salePrice),
    cost: parseDecimal(v.cost),
    desiredMarkup: parseDecimal(v.desiredMarkup),
    discountLimitPercent: parseDecimal(v.discountLimitPercent),
    defaultCommissionPercent: parseDecimal(v.defaultCommissionPercent) ?? 0,
    commissions: v.commissions.map((c) => ({ userId: c.userId, percent: required(c.percent) })),
    minStock: parseDecimal(v.minStock),
    idealStock: parseDecimal(v.idealStock),
  };
}

const schemaResolver = zodResolver(productInputSchema);
const resolver: Resolver<ProductFormValues, unknown, ProductData> = (values, context, options) =>
  schemaResolver(formToInput(values), context, options as never);

const options = <T extends string>(values: readonly T[], labels: Record<T, string>) =>
  values.map((value) => ({ value, label: labels[value] }));

const visible = <T extends { id: string; archived: boolean }>(
  items: T[] | undefined,
  keep: string | null,
) => (items ?? []).filter((i) => !i.archived || i.id === keep);

export function ProductForm({
  formId,
  defaultValues,
  costVisible,
  readOnly,
  onSubmit,
}: {
  formId: string;
  defaultValues: ProductFormValues;
  /** Sem `products.view_cost`, custo e markup nem aparecem; o servidor também os ignora. */
  costVisible: boolean;
  readOnly: boolean;
  onSubmit: (data: ProductData, setServerErrors: (error: unknown) => void) => void;
}) {
  const form = useForm<ProductFormValues, unknown, ProductData>({ resolver, defaultValues });
  const { errors } = form.formState;
  const commissions = useFieldArray({ control: form.control, name: 'commissions' });
  const [kind, tracksStock, salePrice, cost, desiredMarkup, picked] = useWatch({
    control: form.control,
    name: ['kind', 'tracksStock', 'salePrice', 'cost', 'desiredMarkup', 'commissions'],
  });
  const groups = useQuery(catalogQuery('product-groups'));
  const brands = useQuery(catalogQuery('product-brands'));
  const professionals = useQuery({ ...professionalsQuery(), enabled: !readOnly });
  const service = kind === 'service';

  // Prévia na tela; o servidor recalcula ao salvar.
  const price = parseDecimal(salePrice);
  const costValue = parseDecimal(cost);
  const real =
    price !== null && !Number.isNaN(price) && costValue !== null && !Number.isNaN(costValue)
      ? markupPercent(price, costValue)
      : null;
  const markupValue = parseDecimal(desiredMarkup);
  const suggested =
    costValue !== null &&
    !Number.isNaN(costValue) &&
    markupValue !== null &&
    !Number.isNaN(markupValue)
      ? priceForMarkup(costValue, markupValue)
      : null;

  const knownProfessionals = new Map(
    (professionals.data ?? []).map((p) => [p.id, p.name] as const),
  );
  for (const c of defaultValues.commissions) {
    if (!knownProfessionals.has(c.userId)) knownProfessionals.set(c.userId, 'Usuário inativo');
  }
  const available = [...knownProfessionals].filter(([id]) => !picked.some((c) => c.userId === id));

  return (
    <form
      id={formId}
      noValidate
      onSubmit={form.handleSubmit((data) => {
        onSubmit(data, (error) => {
          applyFieldErrors(form.setError, error);
        });
      })}
    >
      <fieldset disabled={readOnly} className="min-w-0 space-y-5">
        <Section title="Informações gerais">
          <div className="grid gap-4 sm:grid-cols-2">
            <Controller
              control={form.control}
              name="kind"
              render={({ field }) => (
                <Segmented
                  label="Tipo"
                  value={field.value}
                  onChange={(v) => {
                    field.onChange(v);
                    if (v === 'service') {
                      form.setValue('tracksStock', false);
                      if (!form.getValues('serviceKind'))
                        form.setValue('serviceKind', 'consultation');
                    } else {
                      form.setValue('serviceKind', null);
                      form.setValue('tracksStock', true);
                    }
                  }}
                  options={[
                    { value: 'product', label: 'Produto' },
                    { value: 'service', label: 'Serviço' },
                  ]}
                />
              )}
            />
            {service ? (
              <SelectField
                label="Classificação do serviço"
                hint="Os indicadores contam consultas, vacinas e exames por este campo."
                options={options(serviceKinds, serviceKindLabels)}
                error={errors.serviceKind?.message}
                {...form.register('serviceKind', { setValueAs: emptyToNull })}
              />
            ) : (
              <div className="hidden sm:block" />
            )}
            <div className="sm:col-span-2">
              <TextField
                label="Nome"
                autoComplete="off"
                error={errors.name?.message}
                {...form.register('name')}
              />
            </div>
            <SelectField
              label="Unidade de venda"
              options={options(saleUnits, saleUnitLabels)}
              error={errors.unit?.message}
              {...form.register('unit')}
            />
            {service ? null : (
              <TextField
                label="Código de barras"
                inputMode="numeric"
                autoComplete="off"
                hint="EAN ou GTIN, com o dígito verificador."
                error={errors.barcode?.message}
                {...form.register('barcode')}
              />
            )}
            <Controller
              control={form.control}
              name="groupId"
              render={({ field }) => (
                <SelectField
                  label="Grupo"
                  placeholder="Sem grupo"
                  options={visible(groups.data, defaultValues.groupId).map((g) => ({
                    value: g.id,
                    label: g.name,
                  }))}
                  error={errors.groupId?.message}
                  name={field.name}
                  ref={field.ref}
                  value={field.value ?? ''}
                  onBlur={field.onBlur}
                  onChange={(e) => {
                    field.onChange(e.target.value || null);
                  }}
                />
              )}
            />
            <Controller
              control={form.control}
              name="brandId"
              render={({ field }) => (
                <SelectField
                  label="Marca"
                  placeholder="Sem marca"
                  options={visible(brands.data, defaultValues.brandId).map((b) => ({
                    value: b.id,
                    label: b.name,
                  }))}
                  error={errors.brandId?.message}
                  name={field.name}
                  ref={field.ref}
                  value={field.value ?? ''}
                  onBlur={field.onBlur}
                  onChange={(e) => {
                    field.onChange(e.target.value || null);
                  }}
                />
              )}
            />
          </div>
        </Section>

        <Section
          title="Custo e preço"
          description={
            costVisible
              ? 'Markup é o ganho sobre o custo: (preço − custo) ÷ custo.'
              : 'Preço de venda e regras de desconto.'
          }
        >
          <div className="grid gap-4 sm:grid-cols-3">
            <TextField
              label="Preço de venda (R$)"
              inputMode="decimal"
              autoComplete="off"
              error={errors.salePrice?.message}
              {...form.register('salePrice')}
            />
            {costVisible ? (
              <>
                <TextField
                  label="Custo de aquisição (R$)"
                  inputMode="decimal"
                  autoComplete="off"
                  error={errors.cost?.message}
                  {...form.register('cost')}
                />
                <TextField
                  label="Markup desejado (%)"
                  inputMode="decimal"
                  autoComplete="off"
                  error={errors.desiredMarkup?.message}
                  {...form.register('desiredMarkup')}
                />
                <div className="rounded-control bg-sunken px-3 py-2.5 sm:col-span-3">
                  <dl className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
                    <div>
                      <dt className="text-xs text-ink-muted">Markup real</dt>
                      <dd
                        className={
                          real !== null && real < 0
                            ? 'font-medium text-danger-600'
                            : 'font-medium text-ink'
                        }
                      >
                        {real === null ? 'Informe preço e custo' : formatPercent(real)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-ink-muted">Preço pelo markup desejado</dt>
                      <dd className="font-medium text-ink">
                        {suggested === null ? 'Informe custo e markup' : formatMoney(suggested)}
                      </dd>
                    </div>
                    {suggested !== null && !readOnly ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          form.setValue('salePrice', moneyInput(suggested), {
                            shouldDirty: true,
                            shouldValidate: true,
                          });
                        }}
                      >
                        Usar este preço
                      </Button>
                    ) : null}
                  </dl>
                </div>
              </>
            ) : null}
            <SelectField
              label="Finalidade"
              options={options(productPurposes, productPurposeLabels)}
              error={errors.purpose?.message}
              {...form.register('purpose')}
            />
            <TextField
              label="Limite de desconto (%)"
              inputMode="decimal"
              autoComplete="off"
              hint="Vazio: vale o limite do usuário ou da clínica."
              error={errors.discountLimitPercent?.message}
              {...form.register('discountLimitPercent')}
            />
            <div className="space-y-3 sm:col-span-3">
              <Controller
                control={form.control}
                name="allowPriceChange"
                render={({ field }) => (
                  <Checkbox
                    label="Permite alterar o preço na venda"
                    description="Mesmo assim, só quem tem permissão para isso altera."
                    checked={field.value}
                    disabled={readOnly}
                    onCheckedChange={field.onChange}
                  />
                )}
              />
              <Controller
                control={form.control}
                name="showInPriceList"
                render={({ field }) => (
                  <Checkbox
                    label="Aparece na lista de preços"
                    checked={field.value}
                    disabled={readOnly}
                    onCheckedChange={field.onChange}
                  />
                )}
              />
            </div>
          </div>
        </Section>

        <Section
          title="Comissão"
          description="Sai do item vendido, para o profissional responsável pelo item."
        >
          <div className="space-y-4">
            <div className="max-w-56">
              <TextField
                label="Comissão padrão (%)"
                inputMode="decimal"
                autoComplete="off"
                error={errors.defaultCommissionPercent?.message}
                {...form.register('defaultCommissionPercent')}
              />
            </div>
            {commissions.fields.length > 0 ? (
              <ul className="max-w-md space-y-3" aria-label="Comissões por profissional">
                {commissions.fields.map((f, i) => {
                  const name = knownProfessionals.get(f.userId) ?? 'Profissional';
                  return (
                    <li key={f.id} className="flex items-end gap-2">
                      <div className="min-w-0 flex-1">
                        <TextField
                          label={`${name} (%)`}
                          inputMode="decimal"
                          autoComplete="off"
                          error={
                            errors.commissions?.[i]?.percent?.message ??
                            errors.commissions?.[i]?.userId?.message
                          }
                          {...form.register(`commissions.${i}.percent`)}
                        />
                      </div>
                      {readOnly ? null : (
                        <Button
                          variant="ghost"
                          aria-label={`Remover ${name}`}
                          icon={<Trash2 className="size-4" aria-hidden />}
                          onClick={() => {
                            commissions.remove(i);
                          }}
                        />
                      )}
                    </li>
                  );
                })}
              </ul>
            ) : null}
            {readOnly ? null : (
              <div className="max-w-md">
                <SelectField
                  label="Comissão diferente para um profissional"
                  placeholder={available.length ? 'Escolha o profissional' : 'Todos já incluídos'}
                  options={available.map(([id, name]) => ({ value: id, label: name }))}
                  value=""
                  onChange={(e) => {
                    if (!e.target.value) return;
                    commissions.append({
                      userId: e.target.value,
                      percent: form.getValues('defaultCommissionPercent'),
                    });
                  }}
                />
              </div>
            )}
          </div>
        </Section>

        {service ? null : (
          <Section title="Estoque">
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="sm:col-span-3">
                <Controller
                  control={form.control}
                  name="tracksStock"
                  render={({ field }) => (
                    <Checkbox
                      label="Controla estoque"
                      description="Desmarque para itens que não são contados, como material de consumo a granel."
                      checked={field.value}
                      disabled={readOnly}
                      onCheckedChange={field.onChange}
                    />
                  )}
                />
              </div>
              {tracksStock ? (
                <>
                  <div className="sm:col-span-3">
                    <Controller
                      control={form.control}
                      name="tracksLots"
                      render={({ field }) => (
                        <Checkbox
                          label="Controla lote e validade"
                          description="Para vacina e medicamento: cada entrada informa lote e validade, a venda sai do lote que vence antes e o lote é rastreável até o animal."
                          checked={field.value ?? false}
                          disabled={readOnly}
                          onCheckedChange={field.onChange}
                        />
                      )}
                    />
                  </div>
                  <TextField
                    label="Estoque mínimo"
                    inputMode="decimal"
                    autoComplete="off"
                    error={errors.minStock?.message}
                    {...form.register('minStock')}
                  />
                  <TextField
                    label="Estoque ideal"
                    inputMode="decimal"
                    autoComplete="off"
                    error={errors.idealStock?.message}
                    {...form.register('idealStock')}
                  />
                </>
              ) : null}
            </div>
          </Section>
        )}

        <Section
          title="Fiscal"
          description="Usado na emissão de notas. Na dúvida, confirme com a contabilidade."
        >
          <div className="grid gap-4 sm:grid-cols-2">
            {service ? (
              <TextField
                label="Código do serviço (lista municipal)"
                autoComplete="off"
                placeholder="05.01"
                error={errors.municipalServiceCode?.message}
                {...form.register('municipalServiceCode')}
              />
            ) : (
              <>
                <TextField
                  label="NCM"
                  inputMode="numeric"
                  autoComplete="off"
                  error={errors.ncm?.message}
                  {...form.register('ncm')}
                />
                <SelectField
                  label="Origem"
                  options={options(productOrigins, productOriginLabels)}
                  error={errors.origin?.message}
                  {...form.register('origin')}
                />
                <SelectField
                  label="Forma de aquisição"
                  options={options(acquisitionForms, acquisitionFormLabels)}
                  error={errors.acquisition?.message}
                  {...form.register('acquisition')}
                />
                <TextField
                  label="CFOP"
                  inputMode="numeric"
                  autoComplete="off"
                  error={errors.cfop?.message}
                  {...form.register('cfop')}
                />
                <TextField
                  label="CST ou CSOSN"
                  inputMode="numeric"
                  autoComplete="off"
                  error={errors.taxSituation?.message}
                  {...form.register('taxSituation')}
                />
              </>
            )}
            <TextField
              label="Perfil tributário"
              autoComplete="off"
              placeholder="Ex.: Produtos sem substituição tributária"
              error={errors.taxProfile?.message}
              {...form.register('taxProfile')}
            />
          </div>
        </Section>
      </fieldset>
    </form>
  );
}
