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
- CI com lint, tipos, testes de integração em PostgreSQL e testes ponta a ponta.

### Corrigido

- O campo "Serviço cobrado" do tipo de atendimento lista todos os serviços, não só os 100 primeiros.

### Segurança

- Bloqueio de login por e-mail após 5 falhas em 15 minutos, além do limite por IP.
- Cookie de sessão sem data de expiração; validade controlada pelo servidor.
- Em produção, o IP do cliente vem só do primeiro proxy, e a descrição OpenAPI deixa de ser publicada.
