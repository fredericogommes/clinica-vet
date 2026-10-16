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

## Clientes e animais (Fase 1)

| Tabela                  | Papel                                    | Regras principais                                                                                                            |
| ----------------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `organization_counters` | Numeração sequencial por organização     | Upsert com bloqueio de linha: códigos de ficha (`client`, `patient`) nunca se repetem, mesmo com cadastros simultâneos       |
| `species`               | Espécie                                  | Nome único por organização sem diferenciar maiúsculas; arquivável                                                            |
| `breeds`                | Raça de uma espécie                      | Nome único por espécie; `UNIQUE (id, species_id)` serve de alvo para a FK composta do animal                                 |
| `coats`                 | Pelagem                                  | Nome único por organização; arquivável                                                                                       |
| `client_origins`        | Como o cliente conheceu a clínica        | Nome único por organização; arquivável                                                                                       |
| `clients`               | Responsável PF ou PJ                     | Código sequencial; CPF e CNPJ opcionais, só dígitos, únicos por organização quando informados; endereço em colunas           |
| `client_contacts`       | Celular, telefone fixo ou e-mail         | Ordem define o principal; WhatsApp só em celular; telefones guardados só com dígitos                                         |
| `client_consents`       | Consentimento LGPD por canal             | Somente inclusão: cada mudança é uma linha com canal, decisão, origem, data e autor; vigente = linha mais recente            |
| `patients`              | Animal                                   | Código sequencial; FK composta `(breed_id, species_id)` impede raça de outra espécie; microchip único; marcações em `text[]` |
| `patient_owner_history` | Responsáveis do animal ao longo do tempo | Índice único parcial garante um único vínculo aberto (`ended_at` nulo) por animal                                            |

## Agenda (Fase 1)

| Tabela                 | Papel                              | Regras principais                                                                                                                                           |
| ---------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `appointment_types`    | Tipo de atendimento                | Nome único por organização; duração padrão entre 15 e 720 min; arquivável                                                                                   |
| `unit_opening_hours`   | Funcionamento da unidade           | Uma faixa por dia da semana, em minutos desde a meia-noite; dia sem linha = fechado                                                                         |
| `schedule_members`     | Profissional com agenda na unidade | Modo `fixed` (horário semanal) ou `variable` (turnos da Escala)                                                                                             |
| `schedule_fixed_hours` | Horário fixo semanal               | Uma faixa por dia; apagada junto com o profissional                                                                                                         |
| `schedule_shifts`      | Turno da escala variável           | Mesmo dia; `confirmed_at` nulo = rascunho, que não abre horários                                                                                            |
| `appointments`         | Agendamento                        | Instantes em `timestamptz`; status e marcos de tempo; `series_id` agrupa a recorrência; `EXCLUDE USING gist` impede dois ativos sobrepostos do profissional |
| `appointment_patients` | Animais do agendamento             | Um ou mais animais do mesmo cliente, em ordem                                                                                                               |

A disponibilidade é a interseção do funcionamento com o horário fixo ou os turnos confirmados; as horas são guardadas no fuso da unidade (`units.time_zone`). A migração 0002 cria a extensão `btree_gist` e semeia funcionamento Seg–Sáb 08:00–18:00 e tipos de atendimento comuns nas organizações existentes.

A busca usa a extensão `unaccent` do PostgreSQL (criada na migração 0001) para ignorar acentos.

O modelo das fases seguintes está em [architecture.md](architecture.md#4-modelo-de-dados-inicial-fase-01).
