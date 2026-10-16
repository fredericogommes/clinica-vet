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
- Produtos e serviços: dígito do código de barras, NCM, CFOP, valores com no máximo duas casas, estoque ideal ≥ mínimo, serviço sempre classificado e sem campos de mercadoria, markup real e preço sugerido calculados no servidor, custo oculto e preservado para quem não tem permissão, comissão só para usuários da clínica, grupo arquivado, isolamento entre organizações e auditoria; E2E cadastra grupo, serviço e produto com preço pelo markup e arquiva.
- PDV: totais e rateio do desconto em centavos (soma exata), campos de total enviados pelo cliente ignorados, limite de desconto da clínica, do usuário e do item, recepção sem desconto mas editando venda com desconto já concedido, preço livre só com a flag do item e a permissão, animal de outro cliente, item de consumo interno ou arquivado e profissional de fora recusados, orçamento convertido em venda, venda que não volta a orçamento, cancelamento com motivo, busca por período, status, cliente, animal e código, configuração auditada e isolamento entre organizações; E2E lança venda com limite de desconto, converte orçamento, cancela e localiza pelo painel, no computador e no celular.
- Venda pela ficha: tipo de atendimento só aceita serviço ativo da própria clínica, rascunho não cobra, finalizar cobra uma vez com o autor como profissional, correção não duplica, atendimentos de profissionais diferentes caem na mesma venda, desconto e origem do item preservados ao editar no PDV, venda cancelada não recebe item novo, outra organização não vê nem lança; E2E do tipo ligado ao serviço até a venda aberta no PDV.
- Recebimento: parcelas somam exatamente o valor com o resto na primeira, taxa ao centavo, datas pelo prazo mais 30 dias, só crédito e convênio parcelam; formas iniciais Dinheiro e PIX, nome único, arquivada fora do PDV, cadastro só com `sales.configure`; pagamento dividido baixa a venda com parcelas, taxa e datas; soma diferente do total, parcelas acima do limite, forma arquivada ou de outra clínica recusadas; orçamento não recebe; venda zerada baixa sem forma; recepção recebe e veterinário não; venda baixada não edita, não cancela e não recebe de novo; E2E do cadastro da forma ao recebimento em dinheiro e cartão 3×.
- Caixa: um caixa aberto por operador e unidade, recebimento e estorno sem caixa recusados, dinheiro esperado com troco, recebimentos, suprimento, sangria e devoluções, sangria acima do dinheiro recusada, só o operador movimenta, supervisor vê e fecha o caixa alheio, fechamento com diferença exige observação, estorno devolve na forma recebida, anula parcelas e cancela a venda, auditoria; E2E abre o caixa pelo PDV, recebe dividido, faz sangria, estorna e fecha com falta.
- Interface: fluxo completo de clonar perfil, criar usuário e verificar a restrição de acesso; logout; menu móvel.
