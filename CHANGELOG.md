# Changelog

## Não lançado

### Adicionado

- Fundação: organização, unidades e centros de custo; login com sessão no servidor; permissões por ação com perfis-modelo clonáveis; usuários; trilha de auditoria.
- Design system e telas de login, início, usuários, perfis de acesso e auditoria.
- Clientes: cadastro mínimo de balcão (só o nome é obrigatório) ou completo, PF e PJ com validação de CPF e CNPJ, contatos com WhatsApp, endereço, origem, busca sem acento por nome, documento, telefone, e-mail, código ou animal, ficha 360º, arquivamento.
- Consentimento LGPD por canal com origem, data e autor, sem sobrescrever o histórico.
- Animais: espécie e raça vinculadas, pelagem, sexo, castração, nascimento com idade calculada, microchip único, pedigree, marcações em destaque, óbito, arquivamento e troca de responsável com histórico.
- Cadastros de apoio: espécies e raças, pelagens e origens de clientes.
- Histórico de alterações na ficha do cliente e do animal (auditoria filtrada pelo registro).
- Agenda por profissional: visões Dia, Semana e Mês, faixas fora do horário sombreadas, agendamento em dois passos com horários livres já cruzados com o profissional, vários animais, recorrência, encaixe com permissão própria, ciclo Agendado → Confirmado → Em espera → Em atendimento → Animal pronto (mais Atrasado, Cancelado e Não compareceu) com médias de espera e atendimento.
- Escala variável com turnos em rascunho e "Confirmar o mês inteiro"; configuração do horário de funcionamento e dos profissionais com horário fixo.
- Tipos de atendimento com duração padrão.
- Atendimento clínico: busca por responsável ou animal e ficha em três colunas com marcações, peso atual, agenda do animal, linha do tempo e evolução do peso.
- Atendimento com sinais vitais estruturados, diagnóstico por patologia e prontuário pré-preenchido pelo modelo do tipo de atendimento; rascunho visível só ao autor até finalizar.
- Eventos de peso, patologia, observação, foto, receita e documento; receitas e documentos por modelo com impressão em A4.
- Linha do tempo com filtros por período, tipo e profissional, ordem e paginação; correção com histórico e invalidação com motivo.
- Cadastros de patologias e de modelos de receita e documento; exclusão definitiva de cliente ou animal sem histórico.
- Produtos e serviços num cadastro só: tipo, classificação do serviço (consulta, vacina, exame, banho e tosa...), unidade, código de barras, grupo, marca, preço, custo, markup real e preço sugerido, limite de desconto, comissão padrão e por profissional, estoque mínimo e ideal e campos fiscais; grupos de produtos e marcas.
- Ponto de venda: venda ou orçamento no mesmo formulário, cliente localizado pelo animal, tipo de venda fiscal, profissional responsável por item, busca de item por nome, código ou código de barras (Enter adiciona), desconto em R$ ou % limitado pelo item, pelo usuário ou pela clínica, preço livre só com permissão, totais recalculados no servidor, orçamento que vira venda, cancelamento com motivo e painel das vendas das últimas 24 horas.
- Configuração de vendas (limite de desconto da clínica e tipo de venda padrão) e limite de desconto por usuário.
- Formas de recebimento por adquirente e bandeira, com prazo de liquidação, parcelamento e taxa; "Registrar recebimento" no PDV e na venda, com pagamento dividido entre várias formas, parcelas com data prevista e taxa, e baixa da venda. O painel do PDV separa vendas não pagas e pagas.
- Estoque por unidade com reserva na venda: a venda em aberto reserva os itens, a baixa tira do saldo e o estorno devolve; cada grupo de produtos bloqueia ou libera a venda sem saldo, e a falta do grupo liberado vira pendência, nunca saldo negativo. Ficha do produto com saldo, reservado, disponível, pendência, entrada avulsa, contagem e movimentações dos últimos 3 meses; saldo e alerta de mínimo na lista; disponível na busca e aviso no item do PDV.
- Lote e validade por entrada para produtos que controlam lote: a venda sai do lote que vence antes e nunca de lote vencido, a contagem é por lote, a ficha mostra os lotes com aviso de vencimento e o saldo vencido, e cada lote é rastreável até a venda, o animal e o tutor; a lista avisa lote vencido ou validade próxima.
- Caixa por operador: abertura com troco, recebimentos só com caixa aberto, suprimento e sangria, fechamento com dinheiro contado e diferença explicada, totais por forma de recebimento, lista de caixas com filtro e supervisão. Venda baixada pode ser estornada: a devolução sai do caixa na forma recebida e a venda fica cancelada.
- Venda pela ficha clínica: o tipo de atendimento aponta o serviço cobrado, o atendimento finalizado lança esse serviço na venda aberta do animal e a coluna "Venda" da ficha mostra o carrinho, lança produtos e serviços e leva ao PDV.
- Consulta vendas por período: resumo com venda bruta, desconto, líquido, ticket médio, recebido e em aberto, quebras por dia, forma de recebimento, profissional e tipo; totais por produto e serviço; lista de vendas com busca e situação. Minhas vendas mostra ao profissional os itens que vendeu.
- Painel de controle na tela Início: indicadores (animais, responsáveis, venda líquida, débitos de clientes, descontos, ticket médio, médias de espera e atendimento, arquivos) e widgets de animais por mês e por ano, consultas por mês, últimos atendimentos, últimos animais, ciclo de vida dos clientes, estoque abaixo do mínimo e últimos acessos. Cada perfil vê só o que libera, e cada usuário liga, desliga e reordena os widgets em Configurar.
- Exames: cadastro com campos decimais, inteiros ou de texto agrupados em seções e valores de referência por espécie e idade; resultado na ficha clínica com a faixa do animal e marcação Abaixo/Acima ao digitar, tabela na linha do tempo, gráfico de evolução de cada campo e cobrança do serviço do exame na venda aberta. Clínicas novas começam com o Hemograma.
- Vacinas: cadastro de vacinas, vermífugos e antiparasitários com série inicial e reforço; aplicação na ficha com dose e próxima data sugeridas, lote e cobrança do serviço; aba Protocolos com a situação (Programada, A vencer, Vencida) e encerramento com motivo; consulta Vacinação com doses vencidas e a vencer e o contato do responsável para a busca ativa. Clínicas novas começam com quatro vacinas de partida.
- Mensagens automáticas por WhatsApp, ligadas por padrão: lembrete de vacina e vermifugação, lembrete de agendamento, resultado de exame, boas-vindas a clientes e animais novos e aniversários, com texto editável e prévia. Respeitam o consentimento LGPD e não duplicam. A fila de mensagens mostra o que espera, o que saiu e por que algo não saiu; sem a conta oficial do WhatsApp Business, a recepção envia cada mensagem pelo WhatsApp da clínica com o texto pronto.
- Financeiro: contas com saldo e previsto, plano de contas com subcategorias, fornecedores, lançamentos de receita e despesa parcelados ou mensais com competência e centro de custo, baixa com juros ou desconto, transferências entre contas e extrato com saldo linha a linha. As vendas recebidas lançam sozinhas a receita de cada parcela e a taxa do cartão, e o estorno cancela esses lançamentos. Contas a pagar e a receber mostram vencidas e próximos 7 dias.
- Conciliação de cartões: as vendas em cartão e convênio ficam a receber e aparecem agrupadas no depósito que a adquirente deve fazer; conciliar baixa as parcelas na data em que o dinheiro caiu e lança a diferença como taxa ou receita, e pode ser desfeita. Cada forma de recebimento pode indicar a conta onde o dinheiro cai.
- Demonstrativo de resultado por categoria e mês, com alternador de regime de caixa ou competência e filtro por centro de custo, e fluxo de caixa com receitas × despesas por mês e saldo diário real × previsto, filtrado por conta, tipo e situação.
- Compras: importação do XML da NF-e ou compra digitada, com fornecedor cadastrado pela nota, itens reconhecidos pelo código de barras ou pelo código já usado com aquele fornecedor, lote e validade, frete, desconto e parcelas. Ao confirmar, o estoque entra por lote, o custo dos produtos se atualiza com o frete rateado e as parcelas vão para contas a pagar; cancelar desfaz tudo.
- Outras saídas de estoque por perda, quebra, vencimento, uso interno ou doação, escolhendo o lote e guardando o custo; cancelar devolve ao estoque. Inventário por grupo ou geral, com contagem salva aos poucos, diferença na hora e aplicação ao estoque que mostra o saldo de antes.
- Análise de estoque: cada produto em Repor, Em excesso, Parado, Novos ou Adequado, com contagem e valor por situação, consumo médio, duração e excedente; a ficha do produto mostra os mesmos indicadores.
- Pedido de compra por fornecedor, com sugestão do que repor, texto pronto para copiar, mandar no WhatsApp ou por e-mail, e recebimento que vira rascunho de compra.
- Comissionamento: comissões em aberto por profissional, extratos que fecham em contas a pagar, com revisão, pagamento e arquivo, ajustes quando a venda muda, Minhas comissões para a equipe e configuração de base, critério, integração e quem recebe.
- CI com lint, tipos, testes de integração em PostgreSQL e testes ponta a ponta.

### Corrigido

- O campo "Serviço cobrado" do tipo de atendimento lista todos os serviços, não só os 100 primeiros.
- O menu lateral destaca só a tela aberta, não também a tela-mãe (ex.: Agenda ao abrir Escala).
- Os botões do rodapé das janelas quebram linha no celular em vez de sair da tela.

### Segurança

- Bloqueio de login por e-mail após 5 falhas em 15 minutos, além do limite por IP.
- Cookie de sessão sem data de expiração; validade controlada pelo servidor.
- Em produção, o IP do cliente vem só do primeiro proxy, e a descrição OpenAPI deixa de ser publicada.
