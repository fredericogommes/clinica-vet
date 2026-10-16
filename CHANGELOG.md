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
- CI com lint, tipos, testes de integração em PostgreSQL e testes ponta a ponta.

### Segurança

- Bloqueio de login por e-mail após 5 falhas em 15 minutos, além do limite por IP.
- Cookie de sessão sem data de expiração; validade controlada pelo servidor.
- Em produção, o IP do cliente vem só do primeiro proxy, e a descrição OpenAPI deixa de ser publicada.
