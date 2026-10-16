# Arquitetura — proposta

Status: proposta para aprovação. Versões serão confirmadas no registro npm e na documentação oficial no início da Fase B; nada abaixo foi instalado ainda.

## 1. Visão geral

Monólito modular em TypeScript: uma API HTTP com módulos de domínio isolados, um frontend SPA e um banco PostgreSQL. Sem microsserviços, filas ou cache distribuído: o volume de uma clínica (dezenas de usuários, milhares de atendimentos/mês) não justifica. Tarefas agendadas (lembretes, classificação de estoque) rodam em um worker no mesmo código, usando uma tabela de jobs no próprio PostgreSQL.

```
apps/web  (React SPA) ──HTTP/JSON──▶ apps/api (Fastify) ──▶ PostgreSQL 16
                                        │
                                        └─ worker (mesmo código, jobs em tabela)
packages/contracts  (schemas Zod compartilhados: validação no servidor e tipos no cliente)
```

Dependências apontam para dentro: `domain` (regras puras, sem I/O) ← `application` (casos de uso, transações) ← `http` (rotas). O frontend só conhece `contracts`.

## 2. Stack e justificativa

| Camada | Escolha | Por quê |
|--------|---------|---------|
| Linguagem | TypeScript estrito | Tipos ponta a ponta, um só idioma para front e back |
| Runtime | Node.js LTS | Maduro, já disponível no ambiente |
| API | Fastify + Zod | Rápido, plugins oficiais de cookie, CSRF, rate limit e helmet; validação por schema; OpenAPI gerado a partir dos schemas |
| Banco | PostgreSQL 16 | Transações, `numeric` para dinheiro, JSONB para payload de eventos, `SELECT … FOR UPDATE` para reserva de estoque e slots, exclusion constraints para impedir sobreposição de agenda |
| Acesso a dados | Drizzle ORM + drizzle-kit | SQL explícito e tipado, migrações versionadas em SQL revisável |
| Frontend | React + Vite + TanStack Router + TanStack Query | SPA de uso interno (sem necessidade de SEO), rotas tipadas, cache e estados de carregamento/erro padronizados |
| UI | Tailwind CSS + componentes próprios sobre Radix UI; ícones Lucide; gráficos Recharts | Tokens centralizados, acessibilidade (foco, teclado, ARIA) dos primitivos Radix, sem visual de template |
| Formulários | React Hook Form + o mesmo schema Zod da API | Uma regra de validação, mensagens consistentes |
| Testes | Vitest (unidade e integração com PostgreSQL real), Playwright (E2E, Chromium disponível) | Rodam no CI e localmente |
| Qualidade | ESLint, Prettier, `tsc --noEmit`, `npm audit` | Gate obrigatório antes de cada push |
| Implantação | Docker Compose (api, web estático via Caddy, postgres) | Simples de operar em VPS ou servidor da clínica, HTTPS automático |

Alternativa considerada: Next.js full stack. Descartada porque mistura regra de negócio com renderização e o Portal do tutor e integrações futuras se beneficiam de uma API com contrato próprio.

## 3. Estrutura de diretórios

```
apps/
  api/src/
    core/          auth, access (catálogo de ações), audit, organization, errors, db
    modules/
      clients/     responsáveis, contatos, consentimento
      patients/    animais, marcações, troca de responsável
      catalogs/    espécies, raças, pelagens, patologias, tipos de atendimento
      scheduling/  disponibilidade, slots, agendamentos
      clinical/    eventos, atendimento, linha do tempo, modelos
      catalog/     produtos/serviços, grupos, marcas, tabelas de preço
      sales/       vendas/orçamentos, itens, descontos
      payments/    formas de recebimento, recebimentos
      cash/        caixas e movimentos
      inventory/   saldos, lotes, reservas, movimentos
      dashboard/
      (fase 2+: exams, vaccines, finance, purchasing, commissions, portal, messaging,
       hospitalization, insurance, analytics, fiscal)
    jobs/
  web/src/
    design-system/ tokens, componentes base
    features/      uma pasta por módulo (rotas, telas, hooks de API)
    app/           shell, navegação, guarda de rotas
packages/contracts/  schemas Zod e tipos de DTO
docs/  requirements, architecture, data-model, testing, deployment, traceability
```

Cada módulo de API expõe `domain/` (funções puras), `application/` (casos de uso) e `http/` (rotas). Nenhuma regra de negócio em componentes React.

## 4. Modelo de dados inicial (Fase 0–1)

Convenções: chave primária UUID v7; `organization_id` e `unit_id` em toda tabela transacional; `created_at/by`, `updated_at/by`; exclusão lógica (`archived_at`) para cadastros e histórico clínico; dinheiro em `numeric(14,2)`, quantidades em `numeric(14,3)`; datas com fuso (`timestamptz`) e fuso da unidade armazenado.

- **organization, unit, cost_center**
- **user, role (perfil), role_permission (chave de ação), user_role, session**
- **audit_log** (entidade, id, ação, antes, depois, usuário, momento)
- **client** (PF/PJ, documentos opcionais, origem), **client_contact**, **client_address**, **consent** (canal, concedido, data, origem)
- **species, breed (species_id), coat, pathology (código), encounter_type (modelo de prontuário)**
- **patient** (client_id atual, status vivo/óbito, espécie, raça, sexo, esterilização, nascimento, microchip, pedigree, foto, marcações), **patient_owner_history**
- **clinical_event** (patient_id, tipo, ocorrido_em, profissional, status rascunho/publicado, payload JSONB validado por tipo, sale_id opcional); sinais vitais e diagnóstico em colunas tipadas de **encounter** para permitir consulta analítica
- **schedule_rule** (horário fixo), **shift** (escala), **business_hours**, **appointment** (profissional, início, fim, status, marcos de tempo), **appointment_patient**, **appointment_recurrence**; constraint de exclusão impede dois agendamentos sobrepostos do mesmo profissional
- **item** (tipo produto/serviço, `service_kind`, código, código de barras, grupo, marca, preço, custo, comissão padrão, flags, dados fiscais), **item_group** (política de bloqueio de estoque), **brand**, **price_table**, **price_table_item**, **item_professional_commission**
- **sale** (tipo venda/orçamento, status, cliente, animal, tipo de venda fiscal, totais calculados pelo servidor), **sale_item** (profissional, quantidade, preço unitário, desconto, lote), **payment_method** (adquirente, bandeira, prazo, parcelas), **sale_payment**
- **cash_register, cash_session, cash_movement**
- **stock_lot** (item, lote, validade, quantidade), **stock_reservation**, **stock_movement**

Documento detalhado em `docs/data-model.md` na Fase B, gerado a partir das migrações reais.

## 5. Autenticação e autorização

- Login por e-mail e senha; hash argon2id; sessão no servidor (tabela `session`) com cookie `httpOnly`, `Secure`, `SameSite=Lax`; rotação no login; expiração por inatividade.
- CSRF por token de duplo envio em rotas mutáveis; CORS restrito à origem do frontend; helmet; rate limit no login.
- Autorização: catálogo de ações versionado no código (`clinical.event.change_datetime`, `sales.item.change_price`, `sales.item.grant_discount`, `reports.export_pdf`…). Cada rota declara a ação exigida e o guard nega por padrão. O frontend só esconde controles; a decisão é sempre do servidor.
- Isolamento por `organization_id`/`unit_id` aplicado em toda consulta pelo repositório, coberto por testes de segurança.
- Portal do tutor (Fase 2): identidade separada, escopo restrito aos próprios animais.

## 6. Integrações externas (Fases 2–3)

Adaptadores atrás de interfaces: WhatsApp Business (Cloud API), gateway fiscal (Focus NFe, eNotas, NFE.io ou PlugNotas), importação de XML NF-e (parser local, sem serviço externo), arquivos de adquirentes para conciliação, Petlove/convênios. Nenhum dado falso substitui integração: enquanto o provedor não for contratado, a funcionalidade fica desativada e indicada como tal.

## 7. Estratégia de testes

- Unidade: regras puras (slots, totais, descontos, máquina de estados, reservas, comissão).
- Integração: API real contra PostgreSQL real em banco descartável por execução, incluindo concorrência (duas vendas do último item; dois agendamentos no mesmo slot).
- Segurança: matriz rota × perfil gerada do catálogo de ações; isolamento entre unidades; entradas maliciosas nos campos de texto rico.
- E2E: Playwright nos fluxos do MVP (cadastro rápido → agendamento → atendimento → venda → recebimento → caixa).
- Visual: capturas em desktop, tablet e celular das telas principais, inspecionadas a cada fase.

## 8. Configuração e implantação

`.env.example` com nomes fictícios; segredos fora do repositório; migrações aplicadas na subida; backup diário com `pg_dump` e teste de restauração documentado em `docs/deployment.md`.

## 9. Riscos e decisões pendentes

| Risco | Mitigação |
|-------|-----------|
| Escopo total (111 telas) | Entregas por fase, cada uma utilizável sozinha |
| Concorrência em agenda e estoque | Constraints no banco + bloqueio de linha + testes de corrida |
| Permissões tardias | Guard por ação desde a Fase 0, deny by default |
| Integrações dependem de contratos do Fred | Interfaces prontas; ativação quando houver conta |
| Prontuário com texto rico (XSS) | Sanitização no servidor com lista branca |

## 10. Plano por etapas

| Etapa | Entrega | Critério de pronto |
|-------|---------|--------------------|
| B — Fundação | Repositório, toolchain, lint/tipos, Docker Compose, migrações, auth, catálogo de ações, auditoria, CI | Build, lint, tipos e testes verdes no CI; login funcionando |
| C — Sistema visual | Tokens, tipografia, componentes (botão, campo, tabela paginada, modal, menu, toast, estados vazio/erro/carregando), shell com navegação | Página de componentes inspecionada em 3 larguras |
| D1 — Clientes e animais | F1-1 a F1-5 | Testes I/E verdes, telas inspecionadas |
| D2 — Agenda | F1-6 a F1-10 (motor de slots) | Teste de concorrência verde |
| D3 — Atendimento | F1-11 a F1-16 | Fluxo E2E do atendimento |
| D4 — Catálogo, PDV, caixa, estoque | F1-17 a F1-25 | Fluxo E2E venda → recebimento → caixa; estoque não fica negativo |
| D5 — Painel | F1-26 | KPIs conferidos contra dados semeados |
| E/F — Integração e auditoria | Revisão, segurança, regressão | Relatório com evidências |
| Fases 2 e 3 | Conforme matriz, após aceite do MVP | — |
