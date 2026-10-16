import { permissionCatalog, roleSchema, type Permission, type Role } from '@clinica/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, Copy, Lock, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button } from '../../design-system/button';
import { Checkbox } from '../../design-system/checkbox';
import { Dialog } from '../../design-system/dialog';
import { TextField } from '../../design-system/field';
import { Badge, PageHeader, Panel } from '../../design-system/layout';
import { ErrorState, SkeletonRows } from '../../design-system/states';
import { useToast } from '../../design-system/toast';
import { api, apiVoid, errorMessage } from '../../lib/api';
import { useCan } from '../../lib/session';
import { rolesQuery } from './queries';
import { CloneRoleDialog } from './roles-page';

const groups = Object.entries(permissionCatalog).reduce<Record<string, Permission[]>>(
  (acc, [key, meta]) => {
    (acc[meta.group] ??= []).push(key as Permission);
    return acc;
  },
  {},
);

function RoleEditor({ role }: { role: Role }) {
  const can = useCan();
  const queryClient = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const editable = !role.isTemplate && can('admin.roles.manage');
  const [name, setName] = useState(role.name);
  const [description, setDescription] = useState(role.description ?? '');
  const [selected, setSelected] = useState<Set<Permission>>(() => new Set(role.permissions));
  const [cloning, setCloning] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const dirty = useMemo(
    () =>
      name !== role.name ||
      description !== (role.description ?? '') ||
      selected.size !== role.permissions.length ||
      role.permissions.some((p) => !selected.has(p)),
    [name, description, selected, role],
  );

  const save = useMutation({
    mutationFn: () =>
      api('PUT', `/admin/roles/${role.id}`, roleSchema, {
        name,
        description: description.trim() === '' ? null : description,
        permissions: [...selected],
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admin'] });
      await queryClient.invalidateQueries({ queryKey: ['session'] });
      toast.success('Perfil salvo.');
    },
    onError: (error) => {
      toast.error(errorMessage(error));
    },
  });

  const remove = useMutation({
    mutationFn: () => apiVoid('DELETE', `/admin/roles/${role.id}`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admin'] });
      toast.success(`Perfil ${role.name} excluído.`);
      await navigate({ to: '/configuracao/perfis' });
    },
    onError: (error) => {
      setConfirmDelete(false);
      toast.error(errorMessage(error));
    },
  });

  const toggle = (permission: Permission, checked: boolean) => {
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(permission);
      else next.delete(permission);
      return next;
    });
  };

  return (
    <>
      <Link
        to="/configuracao/perfis"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-ink-muted hover:text-ink"
      >
        <ArrowLeft className="size-4" aria-hidden />
        Perfis de acesso
      </Link>
      <PageHeader
        area="Perfil de acesso"
        title={role.name}
        description={
          role.isTemplate
            ? 'Perfil-modelo: somente leitura. Clone para personalizar as permissões.'
            : `${role.userCount} ${role.userCount === 1 ? 'usuário vinculado' : 'usuários vinculados'}.`
        }
        actions={
          can('admin.roles.manage') ? (
            <>
              <Button
                variant="secondary"
                icon={<Copy className="size-4" aria-hidden />}
                onClick={() => {
                  setCloning(true);
                }}
              >
                Clonar
              </Button>
              {editable ? (
                <Button
                  variant="secondary"
                  icon={<Trash2 className="size-4" aria-hidden />}
                  onClick={() => {
                    setConfirmDelete(true);
                  }}
                >
                  Excluir
                </Button>
              ) : null}
            </>
          ) : null
        }
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
        <Panel>
          {Object.entries(groups).map(([group, permissions]) => (
            <fieldset key={group} className="border-b border-line px-5 py-4 last:border-b-0">
              <legend className="float-left mb-3 w-full font-mono text-[11px] tracking-[0.08em] text-ink-muted uppercase">
                {group}
              </legend>
              <div className="clear-both grid gap-3 sm:grid-cols-2">
                {permissions.map((permission) => (
                  <Checkbox
                    key={permission}
                    label={permissionCatalog[permission].label}
                    description={permission}
                    checked={selected.has(permission)}
                    disabled={!editable}
                    onCheckedChange={(checked) => {
                      toggle(permission, checked);
                    }}
                  />
                ))}
              </div>
            </fieldset>
          ))}
        </Panel>

        <aside className="space-y-4">
          {role.isTemplate ? (
            <Panel className="p-4">
              <Badge>
                <Lock className="mr-1 size-3" aria-hidden />
                Modelo
              </Badge>
              <p className="mt-2 text-sm text-ink-muted">
                As permissões dos modelos acompanham as atualizações do sistema.
              </p>
            </Panel>
          ) : editable ? (
            <Panel className="space-y-4 p-4">
              <TextField
                label="Nome do perfil"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                }}
              />
              <TextField
                label="Descrição"
                value={description}
                onChange={(e) => {
                  setDescription(e.target.value);
                }}
              />
              <p className="text-xs text-ink-muted">
                <span className="font-mono">{selected.size}</span> de{' '}
                <span className="font-mono">{Object.keys(permissionCatalog).length}</span>{' '}
                permissões marcadas.
              </p>
              <Button
                className="w-full"
                disabled={!dirty || name.trim().length < 2}
                pending={save.isPending}
                onClick={() => {
                  save.mutate();
                }}
              >
                Salvar perfil
              </Button>
            </Panel>
          ) : null}
        </aside>
      </div>

      <CloneRoleDialog
        source={cloning ? role : undefined}
        onClose={() => {
          setCloning(false);
        }}
      />
      <Dialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Excluir perfil"
        description={`O perfil ${role.name} será removido. Perfis com usuários vinculados não podem ser excluídos.`}
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setConfirmDelete(false);
              }}
            >
              Cancelar
            </Button>
            <Button
              variant="danger"
              pending={remove.isPending}
              onClick={() => {
                remove.mutate();
              }}
            >
              Excluir perfil
            </Button>
          </>
        }
      >
        <p className="text-sm text-ink-muted">Esta ação fica registrada na auditoria.</p>
      </Dialog>
    </>
  );
}

export function RoleDetailPage({ roleId }: { roleId: string }) {
  const roles = useQuery(rolesQuery);
  if (roles.isPending) return <SkeletonRows rows={6} columns={2} />;
  if (roles.isError)
    return <ErrorState message={errorMessage(roles.error)} onRetry={() => void roles.refetch()} />;
  const role = roles.data.find((r) => r.id === roleId);
  if (!role) {
    return (
      <ErrorState
        message="Este perfil não existe ou foi excluído."
        onRetry={() => void roles.refetch()}
      />
    );
  }
  // A key reinicia o rascunho local quando os dados salvos mudam.
  return <RoleEditor key={`${role.id}:${role.permissions.join(',')}:${role.name}`} role={role} />;
}
