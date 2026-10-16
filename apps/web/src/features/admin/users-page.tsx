import {
  createUserRequestSchema,
  updateUserRequestSchema,
  userSchema,
  type CreateUserRequest,
  type User,
} from '@clinica/contracts';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, UserRound } from 'lucide-react';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '../../design-system/button';
import { Checkbox } from '../../design-system/checkbox';
import { Dialog } from '../../design-system/dialog';
import { FieldShell, SelectField, TextField } from '../../design-system/field';
import { Badge, PageHeader, Panel } from '../../design-system/layout';
import { EmptyState, ErrorState, SkeletonRows } from '../../design-system/states';
import { DataTable } from '../../design-system/table';
import { useToast } from '../../design-system/toast';
import { api, ApiRequestError, errorMessage } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import { useCan, useSession } from '../../lib/session';
import { parseDecimal, percentInput } from '../products/format';
import { rolesQuery, usersQuery } from './queries';

/** Limite de desconto digitado como texto ("12,5"); vazio = usa o limite da clínica. */
const discountField = z.string().refine((v) => {
  const n = parseDecimal(v);
  return n === null || (n >= 0 && n <= 100 && Math.round(n * 100) === n * 100);
}, 'Percentual entre 0 e 100, com até duas casas');

/** Um formulário para criar e editar; e-mail e senha só são validados na criação. */
const createFormSchema = createUserRequestSchema.extend({
  active: z.boolean(),
  discountLimitPercent: discountField,
});
const updateFormSchema = updateUserRequestSchema.extend({
  email: z.string(),
  password: z.string(),
  discountLimitPercent: discountField,
});
type UserForm = z.infer<typeof createFormSchema>;

function UserDialog({ user, onClose }: { user: User | null | undefined; onClose: () => void }) {
  const session = useSession();
  const queryClient = useQueryClient();
  const toast = useToast();
  const roles = useQuery(rolesQuery);
  const isNew = user === null;
  const form = useForm<UserForm>({
    resolver: zodResolver(isNew ? createFormSchema : updateFormSchema),
    values: user
      ? {
          name: user.name,
          email: user.email,
          password: '',
          roleId: user.roleId,
          unitIds: user.unitIds,
          active: user.active,
          discountLimitPercent: percentInput(user.discountLimitPercent),
        }
      : {
          name: '',
          email: '',
          password: '',
          roleId: '',
          unitIds: [session.currentUnit.id],
          active: true,
          discountLimitPercent: '',
        },
  });

  const save = useMutation({
    mutationFn: (values: UserForm) => {
      const discountLimitPercent = parseDecimal(values.discountLimitPercent);
      if (isNew) {
        const body: CreateUserRequest = {
          name: values.name,
          email: values.email,
          password: values.password,
          roleId: values.roleId,
          unitIds: values.unitIds,
          discountLimitPercent,
        };
        return api('POST', '/admin/users', userSchema, body);
      }
      return api('PUT', `/admin/users/${user?.id ?? ''}`, userSchema, {
        name: values.name,
        active: values.active,
        roleId: values.roleId,
        unitIds: values.unitIds,
        discountLimitPercent,
      });
    },
    onSuccess: async (saved) => {
      await queryClient.invalidateQueries({ queryKey: ['admin'] });
      toast.success(isNew ? `Usuário ${saved.name} criado.` : 'Alterações salvas.');
      onClose();
    },
    onError: (error) => {
      if (error instanceof ApiRequestError) {
        for (const field of error.fieldErrors) {
          form.setError(field.path as keyof UserForm, { message: field.message });
        }
      }
    },
  });
  const { errors } = form.formState;
  const formId = 'user-form';

  return (
    <Dialog
      open={user !== undefined}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={isNew ? 'Novo usuário' : 'Editar usuário'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form={formId} pending={save.isPending}>
            {isNew ? 'Criar usuário' : 'Salvar alterações'}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        noValidate
        className="space-y-4"
        onSubmit={form.handleSubmit((values) => {
          save.mutate(values);
        })}
      >
        {save.isError ? (
          <p
            role="alert"
            className="rounded-control bg-danger-50 px-3 py-2 text-sm text-danger-600"
          >
            {errorMessage(save.error)}
          </p>
        ) : null}
        <TextField
          label="Nome"
          autoComplete="off"
          error={errors.name?.message}
          {...form.register('name')}
        />
        <TextField
          label="E-mail"
          type="email"
          autoComplete="off"
          disabled={!isNew}
          hint={isNew ? 'Usado para entrar no sistema.' : 'O e-mail não pode ser alterado.'}
          error={errors.email?.message}
          {...form.register('email')}
        />
        {isNew ? (
          <TextField
            label="Senha inicial"
            type="password"
            autoComplete="new-password"
            hint="Mínimo de 10 caracteres. Combine a entrega da senha pessoalmente."
            error={errors.password?.message}
            {...form.register('password')}
          />
        ) : null}
        <SelectField
          label="Perfil de acesso"
          placeholder={roles.isPending ? 'Carregando perfis…' : 'Selecione'}
          options={(roles.data ?? []).map((r) => ({ value: r.id, label: r.name }))}
          error={errors.roleId?.message}
          {...form.register('roleId')}
        />
        <TextField
          label="Limite de desconto no PDV (%)"
          inputMode="decimal"
          autoComplete="off"
          hint="Vazio usa o limite da clínica, definido nas configurações de venda."
          error={errors.discountLimitPercent?.message}
          {...form.register('discountLimitPercent')}
        />
        <Controller
          control={form.control}
          name="unitIds"
          render={({ field, fieldState }) => (
            <FieldShell label="Unidades" error={fieldState.error?.message}>
              {({ id }) => (
                <div id={id} className="space-y-2 rounded-control border border-line p-3">
                  {session.units.map((unit) => (
                    <Checkbox
                      key={unit.id}
                      label={unit.name}
                      checked={field.value.includes(unit.id)}
                      onCheckedChange={(checked) => {
                        field.onChange(
                          checked
                            ? [...field.value, unit.id]
                            : field.value.filter((v) => v !== unit.id),
                        );
                      }}
                    />
                  ))}
                </div>
              )}
            </FieldShell>
          )}
        />
        {!isNew ? (
          <Controller
            control={form.control}
            name="active"
            render={({ field }) => (
              <Checkbox
                label="Usuário ativo"
                description="Usuários inativos não conseguem entrar e perdem a sessão imediatamente."
                checked={field.value}
                disabled={user?.id === session.user.id}
                onCheckedChange={field.onChange}
              />
            )}
          />
        ) : null}
      </form>
    </Dialog>
  );
}

export function UsersPage() {
  const can = useCan();
  const users = useQuery(usersQuery);
  /** undefined = fechado; null = novo; User = edição. */
  const [editing, setEditing] = useState<User | null | undefined>(undefined);
  const canManage = can('admin.users.manage');

  return (
    <>
      <PageHeader
        area="Configuração"
        title="Usuários"
        description="Pessoas com acesso ao sistema, o perfil de cada uma e as unidades em que atuam."
        actions={
          canManage ? (
            <Button
              icon={<Plus className="size-4" aria-hidden />}
              onClick={() => {
                setEditing(null);
              }}
            >
              Novo usuário
            </Button>
          ) : null
        }
      />
      <Panel>
        {users.isPending ? (
          <SkeletonRows />
        ) : users.isError ? (
          <ErrorState message={errorMessage(users.error)} onRetry={() => void users.refetch()} />
        ) : users.data.length === 0 ? (
          <EmptyState
            icon={UserRound}
            title="Nenhum usuário"
            description="Cadastre a equipe da clínica."
          />
        ) : (
          <DataTable
            caption="Usuários"
            rows={users.data}
            rowKey={(u) => u.id}
            columns={[
              {
                header: 'Nome',
                cell: (u) => (
                  <div>
                    <p className="font-medium">{u.name}</p>
                    <p className="text-xs text-ink-muted">{u.email}</p>
                    <p className="mt-0.5 text-xs text-ink-muted md:hidden">{u.roleName}</p>
                  </div>
                ),
              },
              { header: 'Perfil', hideOnMobile: true, cell: (u) => u.roleName },
              {
                header: 'Situação',
                cell: (u) => (u.active ? <Badge tone="sage">Ativo</Badge> : <Badge>Inativo</Badge>),
              },
              {
                header: 'Último acesso',
                hideOnMobile: true,
                cell: (u) => (
                  <span className="font-mono text-xs text-ink-muted">
                    {u.lastLoginAt ? formatDateTime(u.lastLoginAt) : 'Nunca'}
                  </span>
                ),
              },
              ...(canManage
                ? [
                    {
                      header: 'Ações',
                      className: 'w-px text-right',
                      cell: (u: User) => (
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={`Editar ${u.name}`}
                          onClick={() => {
                            setEditing(u);
                          }}
                        >
                          Editar
                        </Button>
                      ),
                    },
                  ]
                : []),
            ]}
          />
        )}
      </Panel>
      <UserDialog
        user={editing}
        onClose={() => {
          setEditing(undefined);
        }}
      />
    </>
  );
}
