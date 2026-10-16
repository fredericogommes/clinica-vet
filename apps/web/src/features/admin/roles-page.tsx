import { cloneRoleRequestSchema, roleSchema, type Role } from '@clinica/contracts';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { Copy, Lock } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { Button } from '../../design-system/button';
import { Dialog } from '../../design-system/dialog';
import { TextField } from '../../design-system/field';
import { Badge, PageHeader, Panel } from '../../design-system/layout';
import { ErrorState, SkeletonRows } from '../../design-system/states';
import { DataTable } from '../../design-system/table';
import { useToast } from '../../design-system/toast';
import { api, errorMessage } from '../../lib/api';
import { useCan } from '../../lib/session';
import { rolesQuery } from './queries';

type CloneForm = z.infer<typeof cloneRoleRequestSchema>;

export function CloneRoleDialog({
  source,
  onClose,
}: {
  source: Role | undefined;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const form = useForm<CloneForm>({
    resolver: zodResolver(cloneRoleRequestSchema),
    values: { name: source ? `${source.name} (cópia)` : '' },
  });
  const clone = useMutation({
    mutationFn: (values: CloneForm) =>
      api('POST', `/admin/roles/${source?.id ?? ''}/clone`, roleSchema, values),
    onSuccess: async (role) => {
      await queryClient.invalidateQueries({ queryKey: ['admin', 'roles'] });
      toast.success(`Perfil ${role.name} criado.`);
      onClose();
      await navigate({ to: '/configuracao/perfis/$roleId', params: { roleId: role.id } });
    },
  });

  return (
    <Dialog
      open={source !== undefined}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="Clonar perfil"
      description={source ? `O novo perfil começa com as mesmas permissões de ${source.name}.` : ''}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="clone-form" pending={clone.isPending}>
            Clonar perfil
          </Button>
        </>
      }
    >
      <form
        id="clone-form"
        noValidate
        className="space-y-4"
        onSubmit={form.handleSubmit((values) => {
          clone.mutate(values);
        })}
      >
        {clone.isError ? (
          <p
            role="alert"
            className="rounded-control bg-danger-50 px-3 py-2 text-sm text-danger-600"
          >
            {errorMessage(clone.error)}
          </p>
        ) : null}
        <TextField
          label="Nome do novo perfil"
          error={form.formState.errors.name?.message}
          {...form.register('name')}
        />
      </form>
    </Dialog>
  );
}

export function RolesPage() {
  const roles = useQuery(rolesQuery);
  const can = useCan();
  const [cloning, setCloning] = useState<Role | undefined>(undefined);

  return (
    <>
      <PageHeader
        area="Configuração"
        title="Perfis de acesso"
        description="Cada perfil define, ação por ação, o que as pessoas vinculadas podem fazer. Os perfis-modelo não mudam: clone um deles para criar o seu."
      />
      <Panel>
        {roles.isPending ? (
          <SkeletonRows columns={3} />
        ) : roles.isError ? (
          <ErrorState message={errorMessage(roles.error)} onRetry={() => void roles.refetch()} />
        ) : (
          <DataTable
            caption="Perfis de acesso"
            rows={roles.data}
            rowKey={(r) => r.id}
            columns={[
              {
                header: 'Perfil',
                cell: (r) => (
                  <div className="flex items-center gap-2">
                    <Link
                      to="/configuracao/perfis/$roleId"
                      params={{ roleId: r.id }}
                      className="font-medium text-ink underline-offset-2 hover:underline"
                    >
                      {r.name}
                    </Link>
                    {r.isTemplate ? (
                      <Badge>
                        <Lock className="mr-1 size-3" aria-hidden />
                        Modelo
                      </Badge>
                    ) : null}
                  </div>
                ),
              },
              {
                header: 'Permissões',
                cell: (r) => (
                  <span className="font-mono text-xs text-ink-muted">{r.permissions.length}</span>
                ),
              },
              {
                header: 'Usuários',
                hideOnMobile: true,
                cell: (r) => (
                  <span className="font-mono text-xs text-ink-muted">{r.userCount}</span>
                ),
              },
              ...(can('admin.roles.manage')
                ? [
                    {
                      header: 'Ações',
                      className: 'w-px text-right',
                      cell: (r: Role) => (
                        <Button
                          variant="ghost"
                          size="sm"
                          icon={<Copy className="size-3.5" aria-hidden />}
                          aria-label={`Clonar ${r.name}`}
                          onClick={() => {
                            setCloning(r);
                          }}
                        >
                          Clonar
                        </Button>
                      ),
                    },
                  ]
                : []),
            ]}
          />
        )}
      </Panel>
      <CloneRoleDialog
        source={cloning}
        onClose={() => {
          setCloning(undefined);
        }}
      />
    </>
  );
}
