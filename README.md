# Clínica Vet

Sistema de gestão para clínica veterinária: agenda, prontuário, internação, vendas, estoque e financeiro.
A especificação funcional está resumida em [docs/requirements.md](docs/requirements.md) e o andamento por requisito em [docs/traceability.md](docs/traceability.md).

**Estado atual:** Fundação (Fase 0, parcial). Login, perfis de acesso com permissão por ação, usuários, unidades e auditoria. Os módulos clínicos e comerciais ainda não foram implementados.

## Pré-requisitos

- Node.js 22 (veja `.nvmrc`) e npm 10
- PostgreSQL 16

## Primeira execução

```bash
npm ci
cp .env.example .env          # ajuste DATABASE_URL e as variáveis SEED_*
npm run build -w @clinica/contracts
npm run db:migrate            # aplica migrações e sincroniza os perfis-modelo
npm run db:seed               # cria a organização, a unidade e o primeiro administrador
npm run dev:api               # API em http://127.0.0.1:3000
npm run dev:web               # interface em http://localhost:5173
```

Entre com `SEED_ADMIN_EMAIL` e `SEED_ADMIN_PASSWORD` do seu `.env`.

## Comandos

| Comando                               | O que faz                                                                    |
| ------------------------------------- | ---------------------------------------------------------------------------- |
| `npm run check`                       | Formatação, lint, tipos e testes (o mesmo que o CI roda antes do E2E)        |
| `npm test`                            | Testes da API (integração com PostgreSQL real) e da interface                |
| `npm run test:e2e`                    | Testes ponta a ponta com Playwright (API e interface precisam estar rodando) |
| `npm run build`                       | Compila contratos, API e interface                                           |
| `npm run db:migrate`                  | Aplica migrações pendentes                                                   |
| `npm run db:generate -w @clinica/api` | Gera uma nova migração a partir de `apps/api/src/db/schema.ts`               |

## Estrutura

```
apps/api            API Fastify (domínio, casos de uso e rotas por módulo)
apps/web            Interface React
packages/contracts  Schemas Zod compartilhados: validação na API e tipos na interface
docs/               Requisitos, arquitetura, dados, testes, implantação e rastreabilidade
deploy/             Dockerfiles e Caddyfile
```

Mais detalhes: [arquitetura](docs/architecture.md), [modelo de dados](docs/data-model.md), [testes](docs/testing.md), [implantação](docs/deployment.md).
