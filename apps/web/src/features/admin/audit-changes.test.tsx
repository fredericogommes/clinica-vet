import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AuditChanges } from './audit-changes';

describe('AuditChanges', () => {
  it('mostra apenas campos alterados, com nomes legíveis', () => {
    render(
      <AuditChanges
        before={{
          name: 'Rui',
          active: true,
          role: { id: '1', name: 'Recepcionista' },
          permissions: [],
        }}
        after={{
          name: 'Rui',
          active: false,
          role: { id: '2', name: 'Veterinário' },
          permissions: ['admin.users.view'],
        }}
      />,
    );
    expect(screen.queryByText('Nome')).not.toBeInTheDocument();
    expect(screen.getByText('Ativo')).toBeInTheDocument();
    expect(screen.getByText('Sim')).toBeInTheDocument();
    expect(screen.getByText('Não')).toBeInTheDocument();
    expect(screen.getByText('Recepcionista')).toBeInTheDocument();
    expect(screen.getByText('Veterinário')).toBeInTheDocument();
    expect(screen.getByText('Ver usuários')).toBeInTheDocument();
  });

  it('mostra traço quando não há alteração registrada', () => {
    render(<AuditChanges before={null} after={null} />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });
});
