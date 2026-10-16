# Convenções do projeto

- Fonte da verdade de escopo: `docs/requirements.md`; atualize `docs/traceability.md` sempre que um requisito mudar de status.
- Regras de negócio ficam na API (`apps/api/src/modules/<módulo>`), nunca em componentes React. Valores críticos (totais, preços, permissões) são recalculados no servidor.
- Contratos de entrada e saída vivem em `packages/contracts` e são usados pelos dois lados. Rode `npm run build -w @clinica/contracts` depois de alterá-los.
- Toda rota declara `config.access` (`public`, `authenticated` ou `permission`); a API não sobe sem isso. Nova tela = novas chaves em `packages/contracts/src/permissions.ts` + perfis-modelo em `apps/api/src/modules/admin/role-templates.ts`.
- Escritas relevantes chamam `recordAudit` na mesma transação.
- Dinheiro em `numeric(14,2)`, nunca `float`. IDs UUID v7 via `newId()`.
- Migrações: altere `schema.ts`, gere com `npm run db:generate -w @clinica/api`, revise o SQL e versione.
- Interface: use os componentes de `apps/web/src/design-system` e os tokens de `apps/web/src/styles.css`; não crie cores ou fontes fora dos tokens. Todo controle tem comportamento real; telas futuras não entram no menu antes de existirem.
- Antes de concluir: `npm run check` e, quando a mudança tocar a interface, `npm run test:e2e` com inspeção visual em desktop e celular.
- Commits no padrão Conventional Commits.
