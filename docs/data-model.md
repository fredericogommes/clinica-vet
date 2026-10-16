# Modelo de dados

Fonte: `apps/api/src/db/schema.ts`; migrações SQL em `apps/api/drizzle`. Convenções: UUID v7, `timestamptz`, exclusão lógica por `archived_at` em cadastros.

## Fundação

| Tabela             | Papel                          | Regras principais                                                                         |
| ------------------ | ------------------------------ | ----------------------------------------------------------------------------------------- |
| `organizations`    | A clínica (empresa)            | —                                                                                         |
| `units`            | Unidade física                 | Nome único por organização; fuso horário próprio                                          |
| `cost_centers`     | Centro de custo por unidade    | Nome único por unidade; no máximo um padrão por unidade                                   |
| `roles`            | Perfil de acesso               | Nome único por organização; `is_template` marca os perfis-modelo, que só mudam por código |
| `role_permissions` | Chaves de ação do perfil       | Chave primária (perfil, chave); chaves fora do catálogo são ignoradas na leitura          |
| `users`            | Pessoa com acesso              | E-mail único sem diferenciar maiúsculas; senha em argon2id                                |
| `user_units`       | Unidades em que o usuário atua | Login exige ao menos uma unidade ativa                                                    |
| `sessions`         | Sessão de login                | Guarda o SHA-256 do token, nunca o token; expiração deslizante; token CSRF por sessão     |
| `audit_log`        | Trilha de auditoria            | Gravada na mesma transação da alteração, com antes e depois                               |

O modelo das fases seguintes está em [architecture.md](architecture.md#4-modelo-de-dados-inicial-fase-01).
