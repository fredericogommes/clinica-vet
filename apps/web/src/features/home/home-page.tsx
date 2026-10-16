import { Link } from '@tanstack/react-router';
import { ArrowRight, Hourglass } from 'lucide-react';
import { navigation } from '../../app/navigation';
import { PageHeader, Panel } from '../../design-system/layout';
import { EmptyState } from '../../design-system/states';
import { useCan, useSession } from '../../lib/session';

export function HomePage() {
  const session = useSession();
  const can = useCan();
  const shortcuts = navigation
    .flatMap((s) => s.items)
    .filter((item) => item.to !== '/' && (!item.permission || can(item.permission)));
  const firstName = session.user.name.split(' ')[0] ?? session.user.name;

  return (
    <>
      <PageHeader area={session.currentUnit.name} title={`Olá, ${firstName}`} />
      {shortcuts.length > 0 ? (
        <Panel>
          <h2 className="border-b border-line px-4 py-3 text-sm font-medium">
            Acessos disponíveis para o seu perfil
          </h2>
          <ul className="divide-y divide-line">
            {shortcuts.map((item) => (
              <li key={item.to}>
                <Link
                  to={item.to}
                  className="group flex items-center gap-3 px-4 py-3 text-sm hover:bg-canvas"
                >
                  <item.icon className="size-4 text-sage-600" aria-hidden />
                  <span className="flex-1">{item.label}</span>
                  <ArrowRight className="size-4 text-ink-faint group-hover:text-ink" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
      ) : (
        <Panel>
          <EmptyState
            icon={Hourglass}
            title="Seu perfil ainda não tem módulos liberados"
            description="Os módulos de atendimento, agenda e vendas estão em construção. Quando um deles for liberado para o seu perfil, ele aparece no menu."
          />
        </Panel>
      )}
    </>
  );
}
