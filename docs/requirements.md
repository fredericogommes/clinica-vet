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
- RN-32 Lote e validade por entrada, com rastreio até o paciente [p.18 — modelar na Fase 0/1, usar na Fase 2]. Entregue com F1-24 (L20).

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
- L7 Regra de "Animal pronto"/"Atrasado": não definida. Premissa: "Atrasado" é derivado (horário passou sem chegada), não status manual. O ciclo só anda para a frente; foram acrescentados "Cancelado" e "Não compareceu", que liberam o horário e podem ser reativados.
- L12 Agenda (premissas da implementação): passo de 15 min na grade de horários; turno da escala vale dentro do mesmo dia (plantão que cruza a meia-noite vira dois turnos); turno lançado entra em rascunho e só abre horários depois de "Confirmar o mês"; encaixe fora da escala exige a permissão `schedule.fit_in` e nunca sobrepõe outro agendamento; recorrência grava a série inteira ou nada; semana da agenda vai de domingo a sábado.
- L13 Atendimento (premissas da implementação): a narrativa do prontuário é texto simples, sem HTML, para não abrir brecha de script; rascunho é visível só para quem o escreveu; evento publicado não é apagado, só corrigido (com histórico) ou invalidado com motivo e continua riscado na linha do tempo; data retroativa exige a permissão `clinical.change_datetime` e data futura é recusada; fotos ficam no banco e entram no backup; a coluna da esquerda mostra a agenda do animal até o PDV existir (F1-19/F1-20); exame, vacina, vídeo e internação são das Fases 2 e 3 e não aparecem no menu; exclusão definitiva de cliente ou animal só sem histórico.
- L14 Produtos e serviços (premissas da implementação): markup é o ganho sobre o custo, (preço − custo) ÷ custo; custo e markup só aparecem e só são alterados por quem tem `products.view_cost` (quem não tem salva o item sem perder o custo guardado); limite de desconto vazio herda o do usuário ou da clínica (F1-19); o perfil tributário é texto livre até o módulo fiscal (F3-7), e os demais campos fiscais (NCM, origem, CFOP, CST/CSOSN, código de serviço municipal) já ficam no item; "Áreas" do cadastro de referência fica fora, pois há uma área só; grupos e marcas são cadastros simples, e o bloqueio de venda sem estoque por grupo entrou com F1-23 (L19); não há exclusão definitiva de item, só arquivamento.
- L15 PDV (premissas da implementação): a venda nasce como orçamento ou venda em aberto e é baixada só junto com o recebimento (F1-21/F1-22); orçamento vira venda sem redigitar, mas venda em aberto não volta a orçamento; o desconto da venda é rateado entre os itens na proporção do bruto, pelo maior resto, e o percentual efetivo precisa caber no menor limite entre o do usuário (ou, sem limite próprio, o da clínica, 10% por padrão) e o de cada item; sem `sales.discount` não há desconto novo (o perfil Recepcionista não concede desconto, como sugere a p.22); preço diferente do cadastro exige a flag do item e `sales.change_price`; ao editar, desconto e preços já gravados por quem podia continuam aceitos; nome, preço de tabela e comissão do item são copiados na venda, e mudanças no cadastro não reescrevem vendas passadas; venda sem cliente é venda de balcão; a data da venda é a do lançamento; o painel lateral mostra as últimas 24 horas da unidade atual; cancelar exige motivo e mantém a venda no histórico.
- L16 Venda pela ficha (premissas da implementação): só o atendimento finalizado de um tipo ligado a um serviço ativo lança item, uma vez por atendimento (corrigir o texto não cobra de novo) e com o autor como profissional; rascunho, peso, receita e os demais eventos não cobram; o item cai na venda em aberto do animal na unidade atual, ou abre uma com o tipo de venda padrão, mantendo o desconto já dado; serviço arquivado ou interno não bloqueia o prontuário, só deixa de cobrar; invalidar o atendimento não remove o item, que é retirado no PDV por quem tem a permissão de vendas.
- L17 Recebimento (premissas da implementação): as formas somam exatamente o total da venda (o troco do dinheiro é calculado no balcão, não gravado); só cartão de crédito e convênio parcelam, até 24×; as parcelas são iguais e os centavos que sobram vão para a primeira; a primeira parcela cai no prazo de liquidação da forma e as demais de 30 em 30 dias; a taxa da adquirente é gravada por parcela para a conciliação (F2); venda baixada não é editada nem cancelada até o estorno pelo caixa (F1-22); orçamento precisa virar venda antes de receber; recebimento parcial (saldo do cliente) fica para Recebimentos e Saldo dos clientes (Fase 2). Clínica nova começa com Dinheiro e PIX.
- L18 Caixa (premissas da implementação): cada operador tem no máximo um caixa aberto por unidade e só registra recebimento ou estorno com ele aberto; o caixa não fecha sozinho na virada do dia, e a lista filtra pela data de abertura no fuso da unidade; o dinheiro esperado é troco inicial + recebimentos em dinheiro + suprimentos − sangrias − devoluções em dinheiro, e a sangria não passa dele; cartão e PIX aparecem por forma mas não entram na contagem; no fechamento, contado diferente do esperado exige observação e a diferença fica gravada; só o operador movimenta o próprio caixa, e quem tem `cash.supervise` vê e fecha o de qualquer operador da unidade; estornar a venda baixada devolve cada pagamento na forma em que foi recebido pelo caixa aberto de quem estorna, anula as parcelas e cancela a venda com motivo; não há reabertura de caixa fechado.
- L19 Estoque (premissas da implementação): saldo por produto e unidade, só para itens com "Controla estoque"; a venda em aberto reserva o que leva e o orçamento não reserva; disponível = saldo − reservas das outras vendas em aberto da unidade; cada grupo de produtos decide se falta de saldo bloqueia a venda (padrão: bloqueia, também para item sem grupo); em grupo que bloqueia, a venda acima do disponível é recusada ao gravar e a baixa é recusada se o saldo não cobrir; em grupo liberado, a baixa segue, o saldo vai a zero e a falta vira pendência visível no produto, quitada primeiro pela próxima entrada ou zerada pela contagem, de modo que o saldo nunca fica negativo; o estorno devolve exatamente o que a baixa tirou; até Compras (F2-7), a entrada é avulsa pela ficha do produto e exige `inventory.adjust`, assim como a contagem, que vira o saldo; a linha do saldo é travada em cada reserva, baixa, estorno e ajuste, o que serializa vendas simultâneas do mesmo item.
- L20 Lote e validade (premissas da implementação): o controle é por produto ("Controla lote e validade", só com "Controla estoque"); cada entrada desse produto exige lote e validade, lote vencido não entra, e o mesmo número de lote só volta a receber entrada com a mesma validade; a venda sai do lote que vence antes (FEFO) e nunca de lote vencido, que fica no saldo mas fora do disponível até a contagem do lote dar a baixa; a contagem é lote a lote; ligar o controle leva o saldo existente para o lote "SEM LOTE", sem validade, que sai por último, e desligar exige os lotes zerados; o estorno devolve cada unidade ao lote de onde saiu, e o excedente sem lote de origem (venda baixada antes do controle) vai para o "SEM LOTE"; o rastreio do lote lista entradas, contagens e cada venda com animal e tutor (para quem pode vê-los); aviso de validade próxima a 30 dias; a entrada com lote pela nota fiscal chega com Compras (F2-7).
- L21 Consulta vendas (premissas da implementação): a data da venda é `sold_at`, gravada quando a venda nasce ou quando o orçamento vira venda (o orçamento convertido conta no dia da conversão); entram as vendas em aberto e baixadas da unidade atual, no fuso da unidade; orçamento, venda cancelada e venda estornada ficam de fora; recebido soma os pagamentos não estornados, e em aberto é o líquido das vendas ainda não baixadas; a quebra por profissional usa o profissional de cada item; taxa de entrega e repasse de convênio (Petlove) não entram porque o sistema ainda não tem entrega nem convênio; consulta de no máximo um ano por vez; Minhas vendas mostra só os itens em que o usuário é o profissional responsável [RN-24], até 500 linhas por período.
- L8 Diagnóstico codificado: o documento não indica padrão de codificação. Premissa: catálogo de patologias próprio com código interno.
- L9 Escore corporal: escala não definida. Premissa: 1 a 9.
- L10 Áreas fora do backlog do documento (Site institucional, Campanha SMS, NPS, Beta, features do fornecedor): fora do escopo até decisão.
- L11 Provedores externos (WhatsApp Business, gateway fiscal, adquirentes, Petlove): exigem contas e credenciais do Fred nas Fases 2–3.
