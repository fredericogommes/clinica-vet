# Matriz de rastreabilidade

Status por linha: **concluído e validado**, **parcial**, **pendente**. Nas linhas concluídas, as colunas apontam para o código e os testes reais; nas demais, indicam o planejado.

Legenda de testes: U = unitário (domínio), I = integração (API + PostgreSQL real), E = ponta a ponta (Playwright), S = segurança/permissão.

## Fase 0 — Fundação

| ID   | Requisito                                      | Fonte         | Implementação planejada                                                                       | Teste                                                                 | Status                                                                                          |
| ---- | ---------------------------------------------- | ------------- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| F0-1 | Unidade e centro de custo em toda transação    | p.24 RN-01    | `units`, `cost_centers` (`apps/api/src/db/schema.ts`); sessão sempre tem unidade corrente     | I: `auth.test.ts` (unidade sem vínculo negada)                        | parcial: entidades e unidade da sessão prontas; FKs entram com cada tabela transacional         |
| F0-2 | Autorização por ação, perfis-modelo clonáveis  | p.21–22 RN-02 | `packages/contracts/src/permissions.ts`, `apps/api/src/http/access-guard.ts`, `modules/admin` | S: `access-guard.test.ts`; I: `admin.test.ts`; E: `e2e/admin.spec.ts` | concluído e validado (catálogo cresce por módulo)                                               |
| F0-3 | Trilha de auditoria (antes/depois)             | p.24 RN-03    | `apps/api/src/core/audit.ts`, tela Auditoria                                                  | I: `admin.test.ts`; U: `audit-changes.test.tsx`; E                    | concluído e validado para usuários e perfis; preço, estoque e prontuário usam o mesmo mecanismo |
| F0-4 | Modelo de eventos do animal polimórfico        | p.23 RN-17    | `clinical/events` tabela única + payload validado por tipo                                    | U: payload inválido rejeitado; I                                      | pendente                                                                                        |
| F0-5 | Consentimento LGPD por canal com data e origem | p.6–7 RN-04   | `clients/consent`                                                                             | I, S                                                                  | pendente                                                                                        |
| F0-6 | Autenticação segura (sessão, senha)            | prompt §11    | `modules/auth`, `core/passwords.ts`                                                           | S: `auth.test.ts`; E                                                  | concluído e validado                                                                            |

## Fase 1 — MVP operacional

| ID    | Requisito                                                                               | Fonte              | Implementação planejada                     | Teste                                                                       | Status   |
| ----- | --------------------------------------------------------------------------------------- | ------------------ | ------------------------------------------- | --------------------------------------------------------------------------- | -------- |
| F1-1  | Responsável PF/PJ, cadastro mínimo e completo                                           | p.6–7 RN-05/06     | `clients`                                   | I, E: cadastro mínimo no balcão                                             | pendente |
| F1-2  | Ficha 360º do cliente (dados, contatos, endereço, vendas, privacidade)                  | p.6                | `clients` + tela                            | E                                                                           | pendente |
| F1-3  | Animal: Vivo/Óbito, espécie→raça, pelagem, microchip, pedigree, foto, marcações         | p.7 RN-07/09       | `patients`                                  | U: raça incompatível com espécie rejeitada; E                               | pendente |
| F1-4  | Troca de responsável sem perder histórico                                               | p.6 RN-05          | `patients.transferOwner`                    | I: eventos e vendas antigas preservados                                     | pendente |
| F1-5  | Cadastros de apoio: espécies, raças, pelagens, patologias, tipos de atendimento, origem | p.12–13            | `catalogs`                                  | I                                                                           | pendente |
| F1-6  | Horário de funcionamento, horário fixo e escala variável                                | p.8 RN-11          | `scheduling/availability`                   | U: cálculo de disponibilidade                                               | pendente |
| F1-7  | Slots livres por profissional e duração                                                 | p.7 RN-12          | `scheduling/slots` (motor 1)                | U: sobreposição, borda de turno, duração; I: concorrência não gera conflito | pendente |
| F1-8  | Agenda Dia/Semana/Mês por profissional                                                  | p.7                | tela agenda                                 | E                                                                           | pendente |
| F1-9  | Ciclo de status com marcos de tempo                                                     | p.8 RN-13          | `scheduling/appointment` máquina de estados | U: transições inválidas rejeitadas                                          | pendente |
| F1-10 | Agendamento com vários animais e recorrência                                            | p.7 RN-14          | `scheduling`                                | U, I                                                                        | pendente |
| F1-11 | Ficha clínica em três colunas                                                           | p.4 RN-16          | tela atendimento                            | E                                                                           | pendente |
| F1-12 | Atendimento com sinais vitais estruturados + narrativa por modelo                       | p.5 RN-18, D1      | `clinical/encounter`                        | U: limites de sinais vitais; E                                              | pendente |
| F1-13 | Rascunho até salvar explicitamente                                                      | D2                 | `clinical/encounter` status rascunho        | I: abrir formulário não cria evento publicado                               | pendente |
| F1-14 | Eventos peso, patologia, observação, foto, documento, receita                           | p.4–5              | `clinical/events`                           | I, E                                                                        | pendente |
| F1-15 | Linha do tempo com filtros (período, tipo, profissional, ordem)                         | p.4                | `clinical/timeline`                         | I: filtros no servidor                                                      | pendente |
| F1-16 | Arquivar/excluir ficha, log de alterações                                               | p.5 RN-21          | `patients` + `audit`                        | S: exclusão exige permissão                                                 | pendente |
| F1-17 | Produto/serviço unificado com tipo, preço, custo, markup, comissão, dados fiscais       | p.16 RN-22/45      | `catalog/items`                             | U: markup real calculado                                                    | pendente |
| F1-18 | Classificação de serviço por tipo (não por nome)                                        | p.3                | campo `service_kind`                        | U                                                                           | pendente |
| F1-19 | PDV: venda/orçamento, profissional por item, animal, desconto com limite, tipo de venda | p.8–9 RN-23..26/30 | `sales`                                     | U: totais e limite de desconto; S: cliente não define total                 | pendente |
| F1-20 | Lançamentos da ficha caem na venda aberta                                               | p.4 RN-19          | `sales` + `clinical`                        | I                                                                           | pendente |
| F1-21 | Formas de recebimento por adquirente/bandeira, parcelas, pagamento dividido             | p.9 RN-27          | `payments`                                  | U: soma das formas = total                                                  | pendente |
| F1-22 | Caixa: abrir, fechar, movimentos                                                        | p.10 RN-29         | `cash`                                      | I: venda paga exige caixa aberto                                            | pendente |
| F1-23 | Estoque com reserva na venda e bloqueio por grupo                                       | p.17 RN-31, D4     | `inventory`                                 | I: venda concorrente não deixa saldo negativo                               | pendente |
| F1-24 | Lote e validade por entrada (modelo)                                                    | p.18 RN-32         | `inventory/lots`                            | U: saída consome lote por validade                                          | pendente |
| F1-25 | Consulta vendas (resumo, por item, lista) e Minhas vendas                               | p.9–10             | `sales/reports`                             | I                                                                           | pendente |
| F1-26 | Painel com KPIs e widgets por perfil                                                    | p.3                | `dashboard`                                 | I, E                                                                        | pendente |

## Fase 2 — Receita

| ID    | Requisito                                                                                                                                                  | Fonte            | Status                        |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- | ----------------------------- |
| F2-1  | Exames: catálogo, atributos tipados por seção, referência espécie × idade, fora da faixa, gráfico de evolução                                              | p.13–14 RN-33    | pendente                      |
| F2-2  | Vacinas, protocolos e próxima dose; consulta Vacinação                                                                                                     | p.5, p.12 RN-20  | pendente                      |
| F2-3  | Lembrete automático por WhatsApp ligado por padrão (+ demais gatilhos)                                                                                     | p.20–21 RN-34    | pendente, depende de provedor |
| F2-4  | Financeiro: lançamentos automáticos, contas a pagar, contas, categorias, fornecedores, transferências                                                      | p.18–19 RN-35    | pendente                      |
| F2-5  | Conciliação de cartões                                                                                                                                     | p.18 RN-37       | pendente                      |
| F2-6  | DRE caixa/competência; fluxo de caixa real × previsto                                                                                                      | p.18 RN-36       | pendente                      |
| F2-7  | Compras com importação de XML NF-e, lote e validade; outras saídas; inventário; análise de estoque (Repor/Excesso/Parado/Novos/Adequado); pedido de compra | p.17             | pendente                      |
| F2-8  | Comissionamento: %, extrato, ciclo, extrato → conta a pagar, configuração                                                                                  | p.10–11 RN-38/39 | pendente                      |
| F2-9  | Portal do tutor com exposição granular e agendamento online                                                                                                | p.20–21 RN-44    | pendente                      |
| F2-10 | Pacotes vendidos e sessões consumidas; recebimentos; saldo de clientes; ranking ABC                                                                        | p.10 RN-10       | pendente                      |

## Fase 3 — Diferenciação

| ID   | Requisito                                                                                                          | Fonte          | Status                       |
| ---- | ------------------------------------------------------------------------------------------------------------------ | -------------- | ---------------------------- |
| F3-1 | Internação: painel, ficha, prescrição aprazada, mapa de execução, programado × executado, boxes tipados, histórico | p.14–16 RN-40  | pendente                     |
| F3-2 | Parâmetros clínicos fechados                                                                                       | p.15 RN-41     | pendente                     |
| F3-3 | Cálculo de dose por peso com volume final                                                                          | p.16 RN-42, D5 | pendente                     |
| F3-4 | Convênios genéricos: tabela de preço, autorização, repasse, glosa, conciliação                                     | p.20 RN-43, D3 | pendente                     |
| F3-5 | BI veterinário: produtividade, vendas, clientes, animais, adesão a protocolo, retorno, LTV                         | p.11–12        | pendente                     |
| F3-6 | Agenda de recursos (sala, aparelho, box)                                                                           | p.8 RN-15      | pendente                     |
| F3-7 | Fiscal via gateway (NFS-e, NFC-e)                                                                                  | p.19 RN-45     | pendente, depende de gateway |

## Fora do backlog do documento (aguardando decisão)

Site institucional, Campanha SMS e créditos pré-pagos, Pesquisa de satisfação (NPS), telas Beta, Acesso externo por IP, modelos de orçamento/demonstrativo impressos, Produtos recomendados, Aniversários.
