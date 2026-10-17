import {
  MESSAGE_TEMPLATE_MAX,
  messageSettingInputSchema,
  messageTriggerDescriptions,
  messageTriggerLabels,
  messageVariables,
  messagingSettingsSchema,
  renderTemplate,
  sampleMessageValues,
  triggerOffsets,
  triggerVariables,
  type MessageSetting,
  type MessageSettingInput,
  type MessageTrigger,
} from '@clinica/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useRef, useState } from 'react';
import { Button } from '../../design-system/button';
import { Checkbox } from '../../design-system/checkbox';
import { TextareaField, TextField } from '../../design-system/field';
import { Badge, PageHeader, Section } from '../../design-system/layout';
import { ErrorState, SkeletonRows } from '../../design-system/states';
import { useToast } from '../../design-system/toast';
import { api, ApiRequestError, errorMessage } from '../../lib/api';

type Errors = Record<string, string>;

/** Sugestão de nome para o modelo cadastrado na Meta, só como exemplo no campo. */
const metaExamples: Record<MessageTrigger, string> = {
  vaccine_reminder: 'lembrete_vacina',
  appointment_reminder: 'lembrete_agendamento',
  exam_result: 'resultado_exame',
  welcome_client: 'boas_vindas_cliente',
  welcome_patient: 'boas_vindas_animal',
  patient_birthday: 'aniversario_animal',
  client_birthday: 'aniversario_cliente',
};

const settingsQuery = {
  queryKey: ['messages', 'settings'],
  queryFn: () => api('GET', '/messages/settings', messagingSettingsSchema),
};

/** Mensagens automáticas [p.20–21, RN-34]: todas começam ligadas e cada uma tem o seu texto. */
export function AutomaticMessagesPage() {
  const settings = useQuery(settingsQuery);
  return (
    <>
      <PageHeader
        area="Mensagens"
        title="Mensagens automáticas"
        description="Cada gatilho gera uma mensagem de WhatsApp para o cliente. Quem recusou WhatsApp no consentimento não recebe, e nada sai antes das 8h nem depois das 20h."
        actions={
          <Link
            to="/mensagens"
            className="text-sm font-medium text-sage-700 underline-offset-2 hover:underline"
          >
            Ver a fila de mensagens
          </Link>
        }
      />
      {settings.isPending ? (
        <SkeletonRows rows={6} columns={2} />
      ) : settings.isError ? (
        <ErrorState
          message={errorMessage(settings.error)}
          onRetry={() => void settings.refetch()}
        />
      ) : (
        <div className="space-y-5">
          {settings.data.settings.map((s) => (
            <SettingCard
              key={`${s.trigger}-${s.activeSince}-${s.template}-${String(s.enabled)}`}
              setting={s}
              delivery={settings.data.delivery}
            />
          ))}
        </div>
      )}
    </>
  );
}

function SettingCard({
  setting,
  delivery,
}: {
  setting: MessageSetting;
  delivery: 'api' | 'manual';
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const textarea = useRef<HTMLTextAreaElement>(null);
  const [enabled, setEnabled] = useState(setting.enabled);
  const [offset, setOffset] = useState(setting.offset === null ? '' : String(setting.offset));
  const [template, setTemplate] = useState(setting.template);
  const [providerTemplate, setProviderTemplate] = useState(setting.providerTemplate);
  const [errors, setErrors] = useState<Errors>({});
  const offsetRule = triggerOffsets[setting.trigger];
  const label = messageTriggerLabels[setting.trigger];

  const input: MessageSettingInput = {
    trigger: setting.trigger,
    enabled,
    offset: offsetRule ? (offset === '' ? Number.NaN : Number(offset)) : null,
    template,
    providerTemplate,
  };
  const dirty =
    enabled !== setting.enabled ||
    template !== setting.template ||
    providerTemplate !== setting.providerTemplate ||
    offset !== (setting.offset === null ? '' : String(setting.offset));

  const save = useMutation({
    mutationFn: () => api('PUT', '/messages/settings', messagingSettingsSchema, input),
    onSuccess: (data) => {
      queryClient.setQueryData(settingsQuery.queryKey, data);
      toast.success(`${label}: alterações salvas.`);
    },
    onError: (error) => {
      if (error instanceof ApiRequestError) {
        setErrors(Object.fromEntries(error.fieldErrors.map((f) => [f.path, f.message])));
      }
    },
  });
  const submit = () => {
    const parsed = messageSettingInputSchema.safeParse(input);
    setErrors(
      parsed.success
        ? {}
        : Object.fromEntries(parsed.error.issues.map((i) => [i.path.join('.'), i.message])),
    );
    if (parsed.success) save.mutate();
  };
  const insert = (name: string) => {
    const el = textarea.current;
    const token = `{${name}}`;
    const start = el?.selectionStart ?? template.length;
    const end = el?.selectionEnd ?? template.length;
    setTemplate(template.slice(0, start) + token + template.slice(end));
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + token.length, start + token.length);
    });
  };

  return (
    <Section
      title={label}
      description={messageTriggerDescriptions[setting.trigger]}
      actions={
        <Badge tone={setting.enabled ? 'sage' : 'neutral'}>
          {setting.enabled ? 'Ligada' : 'Desligada'}
        </Badge>
      }
    >
      <form
        noValidate
        aria-label={label}
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {save.isError &&
        !(save.error instanceof ApiRequestError && save.error.fieldErrors.length) ? (
          <p
            role="alert"
            className="rounded-control bg-danger-50 px-3 py-2 text-sm text-danger-600"
          >
            {errorMessage(save.error)}
          </p>
        ) : null}
        <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
          <Checkbox
            label="Ligada"
            description="Desligada, não gera mensagens. Ao religar, só vale o que acontecer dali em diante."
            checked={enabled}
            onCheckedChange={setEnabled}
          />
          {offsetRule ? (
            <div className="w-40">
              <TextField
                label={offsetRule.unit === 'days' ? 'Dias antes' : 'Horas antes'}
                inputMode="numeric"
                autoComplete="off"
                value={offset}
                error={errors.offset}
                onChange={(e) => {
                  setOffset(e.target.value.replace(/\D/g, '').slice(0, 2));
                }}
              />
            </div>
          ) : null}
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-2">
            <TextareaField
              ref={textarea}
              label="Texto da mensagem"
              rows={5}
              maxLength={MESSAGE_TEMPLATE_MAX}
              value={template}
              error={errors.template}
              onChange={(e) => {
                setTemplate(e.target.value);
              }}
            />
            <div className="flex flex-wrap gap-1.5" aria-label="Variáveis">
              {triggerVariables[setting.trigger].map((name) => (
                <button
                  key={name}
                  type="button"
                  title={messageVariables[name]}
                  aria-label={`Inserir ${messageVariables[name]}`}
                  className="rounded-full border border-line-strong bg-surface px-2 py-0.5 font-mono text-xs text-ink-muted hover:border-sage-500 hover:text-sage-700"
                  onClick={() => {
                    insert(name);
                  }}
                >
                  {`{${name}}`}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="text-[13px] font-medium text-ink">Como o cliente recebe</p>
            <p
              aria-label={`Prévia: ${label}`}
              className="mt-1.5 rounded-control bg-sage-50 px-3 py-2 text-sm whitespace-pre-line text-ink"
            >
              {renderTemplate(template, sampleMessageValues)}
            </p>
          </div>
        </div>
        <TextField
          label="Modelo aprovado na Meta"
          autoComplete="off"
          placeholder={`Ex. ${metaExamples[setting.trigger]}`}
          value={providerTemplate}
          error={errors.providerTemplate}
          hint={
            delivery === 'api'
              ? 'Com o nome do modelo, a mensagem sai sozinha; as variáveis vão na ordem do texto. Vazio, ela espera na fila.'
              : 'Usado quando o envio automático estiver ligado. Até lá, a mensagem espera na fila.'
          }
          onChange={(e) => {
            setProviderTemplate(e.target.value.trim());
          }}
        />
        <div className="flex justify-end">
          <Button type="submit" disabled={!dirty} pending={save.isPending}>
            Salvar
          </Button>
        </div>
      </form>
    </Section>
  );
}
