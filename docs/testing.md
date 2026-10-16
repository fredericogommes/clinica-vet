# Testes

| Camada                           | Ferramenta                       | Onde                                                        | Como rodar                 |
| -------------------------------- | -------------------------------- | ----------------------------------------------------------- | -------------------------- |
| Integração e segurança da API    | Vitest + PostgreSQL real         | `apps/api/src/**/*.test.ts`                                 | `npm test -w @clinica/api` |
| Regras puras (agenda, contratos) | Vitest                           | `slots.test.ts`, `rules.test.ts`, `packages/contracts/test` | `npm test`                 |
| Componentes da interface         | Vitest + Testing Library (jsdom) | `apps/web/src/**/*.test.tsx`                                | `npm test -w @clinica/web` |
| Ponta a ponta                    | Playwright (desktop e celular)   | `apps/web/e2e`                                              | `npm run test:e2e`         |

## Banco de testes

Cada execução da API cria um banco descartável (`clinica_test_<aleatório>`), aplica as migrações reais e o remove ao final. A conexão usada para criar o banco vem de `TEST_DATABASE_ADMIN_URL` e precisa de permissão `CREATE DATABASE`. Cada teste começa com a base limpa e uma organização provisionada.

## Ponta a ponta

Requer API e interface rodando e um administrador semeado. Variáveis: `E2E_BASE_URL` (padrão `http://localhost:5173`), `E2E_ADMIN_EMAIL`, `E2E_ADMIN_PASSWORD`. Se o Chromium do Playwright não estiver instalado, aponte `PLAYWRIGHT_CHROMIUM_PATH` para um executável existente.

O projeto `setup` (`e2e/auth.setup.ts`) entra uma vez como administrador e grava a sessão em `e2e/.auth/admin.json` (fora do Git); os testes de módulo reutilizam essa sessão. Isso evita esbarrar no limite de 10 tentativas de login por minuto. Os testes de login continuam entrando por conta própria.

## Cobertura atual

- Login: credenciais inválidas sem revelar se o e-mail existe, validação por campo, limite de tentativas, cookie `HttpOnly`/`SameSite`, token de sessão guardado só como hash, logout no servidor.
- Acesso: rota sem declaração impede a API de subir, requisição sem sessão é rejeitada antes da validação, ausência de chave nega, isolamento entre organizações, CSRF obrigatório em escrita.
- Perfis e usuários: modelos imutáveis, clonagem, chave fora do catálogo rejeitada, nome e e-mail duplicados, a clínica nunca fica sem administrador, usuário desativado perde a sessão, auditoria com antes e depois.
- Agenda: horários livres (escala ∩ funcionamento, duração, passo, agora), sobreposição impedida inclusive com gravações simultâneas, encaixe com permissão, recorrência tudo-ou-nada, ciclo de status com marcos e médias, atraso derivado, fuso da unidade; E2E configura profissional, agenda pelo horário livre e percorre o ciclo.
- Atendimento: limites de sinais vitais no contrato e no banco, rascunho invisível para outro usuário, publicação exige conteúdo, correção só do autor ou com permissão, data retroativa com permissão e futura recusada, invalidação com motivo, ficha arquivada só leitura, filtros e cursor da linha do tempo no fuso da unidade, foto com tipo conferido pelos bytes e limite de tamanho, modelos preenchidos no servidor, isolamento entre organizações, exclusão definitiva só sem histórico; E2E cadastra patologia, salva rascunho, finaliza com sinais vitais, pesa, filtra e invalida, e confere o celular sem rolagem lateral.
- Interface: fluxo completo de clonar perfil, criar usuário e verificar a restrição de acesso; logout; menu móvel.
