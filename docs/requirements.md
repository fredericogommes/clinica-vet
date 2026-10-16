# Requisitos — sistema de gestão para clínica veterinária

Fonte única: _Simples Vet — Especificação funcional completa_ (PDF de 25 páginas, 15/10/2026, Frederico Gomes).
Referências entre colchetes indicam a página do PDF, por exemplo [p.5].

> Nome do produto: provisório. O documento descreve o SimplesVet como **referência**; o sistema novo não usa marca, textos, logotipo nem layout literal do fornecedor.

## 1. Diagnóstico

- **Objetivo.** Construir um sistema próprio de gestão clínica veterinária que cubra o ciclo atendimento → venda → estoque → financeiro, corrigindo cinco defeitos observados na referência [p.25].
- **Natureza do documento.** É um levantamento tela a tela de um sistema existente (111 itens de menu em 20 áreas [p.1]), com recomendações "copie / melhore". Não é uma especificação com critérios de aceitação formais: os critérios abaixo foram derivados das regras descritas e estão marcados como tal.
- **Ordem de construção definida pelo próprio documento** [p.24–25]: Fase 0 (fundação) → Fase 1 (MVP operacional) → Fase 2 (receita) → Fase 3 (diferenciação). Este plano segue essa ordem.
- **Escopo explicitamente desencorajado**: emissão fiscal e integração com adquirentes construídas do zero; usar gateways [p.19, p.25].
- **Núcleo técnico** [p.25]: "CRUD bem feito mais três motores": slots de agenda, aprazamento de internação e regras de comissão.

## 2. Público e perfis

Perfis-modelo [p.21]: Administrador do sistema, Gestor da Clínica, Veterinário, Recepcionista, Esteticista. Perfis são clonáveis e a permissão é **por ação**, não por tela (≈256 chaves em duas árvores: "Menus e recursos" e "Widgets do painel") [p.22].
Usuários externos: tutor no Portal [p.20].

## 3. Defeitos da referência que o sistema deve corrigir [p.25]

| #   | Defeito                      | Regra no sistema novo                                                                                                       |
| --- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| D1  | Prontuário só texto livre    | Sinais vitais (FC, FR, T°, TPC, peso, escore corporal) e diagnóstico codificado estruturados; texto livre só para narrativa |
| D2  | Autosave cria registro vazio | Rascunho não publicado até o primeiro salvamento explícito                                                                  |
| D3  | Convênio como item duplicado | Um item, N tabelas de preço por convênio                                                                                    |
| D4  | Estoque negativo permitido   | Reserva na venda + bloqueio configurável por grupo                                                                          |
| D5  | Dose em texto                | Dose calculada pelo peso atual, com volume final na tela                                                                    |

Além disso, a classificação de serviço deve ser por **tipo** (consulta, cirurgia, vacina, exame, banho), nunca por texto no nome [p.3].

## 4. Regras de negócio extraídas

Fundação

- RN-01 Toda transação pertence a uma unidade e a um centro de custo [p.24].
- RN-02 Autorização verificada no servidor por chave de ação; perfis-modelo clonáveis [p.22].
- RN-03 Auditoria (quem, quando, valor anterior e novo) em prontuário, preço, estoque e financeiro [p.24].
- RN-04 Consentimento por canal (e-mail, SMS, campanha SMS, WhatsApp) com data e origem [p.6–7].

Clientes e animais

- RN-05 Responsável 1:N Animal; trocar o responsável preserva o histórico do animal [p.6, p.23].
- RN-06 Cadastro mínimo rápido: CPF e nascimento opcionais, completados depois [p.7].
- RN-07 Animal tem status Vivo/Óbito; raça depende da espécie; idade derivada do nascimento [p.7].
- RN-08 Peso é evento datado, não campo do cadastro [p.7].
- RN-09 Marcações do animal (ex. "agressivo", "alergia a X") aparecem no atendimento [p.7].
- RN-10 Ranking ABC do cliente por valor vendido [p.6, p.10].

Agenda

- RN-11 Agenda por profissional; disponibilidade vem de horário fixo **ou** escala variável [p.8].
- RN-12 Horários oferecidos como slots livres já cruzados com profissional, calculados por escala + duração (padrão 60 min) [p.7].
- RN-13 Ciclo: Agendado → Confirmado → Em espera → Em atendimento → Animal pronto, mais Atrasado; marcos de tempo alimentam média de espera e de atendimento [p.3, p.8].
- RN-14 Agendamento aceita mais de um animal e recorrência [p.7].
- RN-15 Recursos agendáveis (sala, aparelho, box) ao lado do profissional [p.8, p.25 — Fase 3].

Atendimento clínico

- RN-16 Ficha em três colunas: venda/orçamento, linha do tempo, ações [p.4–5].
- RN-17 Evento clínico polimórfico: atendimento, peso, patologia, documento, exame, foto, vacina, receita, observação, vídeo, internação — uma tabela de eventos com tipo e payload [p.4–5, p.23].
- RN-18 Cada tipo de atendimento tem modelo de prontuário [p.5].
- RN-19 Tudo o que o veterinário lança na ficha vira item da venda aberta do atendimento [p.4].
- RN-20 Vacina aplicada gera protocolo com próxima dose [p.4–5].
- RN-21 Ações da ficha: trocar responsável, arquivar, excluir, log de alterações [p.5].

Vendas, caixa e estoque

- RN-22 Produto e serviço são a mesma entidade com campo tipo [p.16, p.23].
- RN-23 Venda e orçamento são a mesma entidade com status; orçamento vira venda sem redigitação [p.8].
- RN-24 Cada item de venda tem profissional responsável; a comissão sai do item [p.9].
- RN-25 Venda carrega o animal, não só o cliente [p.9].
- RN-26 Desconto em R$ ou %, limitado pelo limite do produto, do usuário ou da empresa [p.9, p.16].
- RN-27 Pagamento dividido em múltiplas formas; forma de recebimento por adquirente/bandeira com prazo de liquidação e parcelamento [p.9].
- RN-28 Totais e valores recalculados no servidor; preço só alterável com permissão e flag do produto [p.16, p.22].
- RN-29 Caixa com abertura, fechamento e movimentos por operador e dia [p.10].
- RN-30 Tipo de venda (classificação fiscal) registrado no PDV [p.8].
- RN-31 Estoque nunca fica negativo em silêncio: reserva na venda, bloqueio configurável por grupo [p.17].
- RN-32 Lote e validade por entrada, com rastreio até o paciente [p.18 — modelar na Fase 0/1, usar na Fase 2].

Receita e diferenciação (Fases 2 e 3)

- RN-33 Exame com atributos tipados por seção e referência por espécie × faixa etária em meses; resultado fora da faixa é marcado [p.13–14].
- RN-34 Lembrete de vacina ligado ao protocolo, ativo por padrão, via WhatsApp [p.21].
- RN-35 Lançamentos financeiros gerados automaticamente por venda, compra e comissão [p.18].
- RN-36 DRE com alternância caixa/competência; fluxo com saldo real e previsto [p.18].
- RN-37 Conciliação de cartões: depósito da adquirente × venda [p.18].
- RN-38 Comissão: % padrão do produto + % diferenciado por profissional; base líquida ou bruta e critério (realizada vs. recebida) configuráveis e explícitos; extrato fechado gera conta a pagar [p.10–11].
- RN-39 Ciclo do extrato: Não informado → Não fechado → Fechada → Paga → Em Revisão → Arquivada [p.11].
- RN-40 Internação: prescrição aprazada em grade de 24 h; cada execução registra programado vs. executado com autor [p.15].
- RN-41 Parâmetros clínicos de internação com opções fechadas [p.15].
- RN-42 Dose por peso calculada do peso atual, com volume final [p.16, p.25].
- RN-43 Convênio genérico: tabela de preço, prazo de repasse, coparticipação, autorização prévia, glosa [p.20].
- RN-44 Portal do tutor com exposição granular (peso, vacinas, exames, receitas) e agendamento online [p.20–21].
- RN-45 Fiscal via gateway; campos fiscais (NCM, CFOP, CST/CSOSN, origem, perfil tributário, código de serviço municipal) no modelo desde o início [p.19].
- RN-46 Turnos padronizados: Manhã 6–12, Tarde 12–18, Noite 18–24, Madrugada 0–6 [p.12].

## 5. Lacunas e ambiguidades

Bloqueante para começar

- **L1 Destino do código.** O repositório configurado no projeto (`fredericogommes/rea`) é uma ferramenta de engenharia reversa, com regras próprias de arquitetura e CI. O sistema da clínica precisa de um repositório próprio. Decisão pedida ao Fred.

Não bloqueantes (premissa adotada, reversível)

- L2 Uso: sistema da própria clínica (não SaaS revendido). Premissa: uma organização com várias unidades; o modelo guarda `organization_id` para não fechar a porta a multi-inquilino.
- L3 Implantação: não informada. Premissa: Docker Compose (app + PostgreSQL) em servidor próprio ou VPS.
- L4 Migração de dados do SimplesVet: não mencionada. Premissa: fora do MVP; o modelo permite importação posterior por CSV.
- L5 Lista exata das 256 chaves de permissão: só exemplos no documento. Premissa: catálogo de ações derivado de cada tela implementada, versionado no código.
- L6 Faixas da Curva ABC: não definidas. Premissa: A = 80 % da receita acumulada, B = 15 %, C = 5 %, período de 12 meses, configurável.
- L7 Regra de "Animal pronto"/"Atrasado": não definida. Premissa: "Atrasado" é derivado (horário passou sem chegada), não status manual.
- L8 Diagnóstico codificado: o documento não indica padrão de codificação. Premissa: catálogo de patologias próprio com código interno.
- L9 Escore corporal: escala não definida. Premissa: 1 a 9.
- L10 Áreas fora do backlog do documento (Site institucional, Campanha SMS, NPS, Beta, features do fornecedor): fora do escopo até decisão.
- L11 Provedores externos (WhatsApp Business, gateway fiscal, adquirentes, Petlove): exigem contas e credenciais do Fred nas Fases 2–3.
