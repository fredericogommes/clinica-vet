# Implantação

Alvo recomendado: um servidor Linux com Docker. A pilha tem três contêineres: `db` (PostgreSQL 16), `api` (aplica migrações ao subir e serve `/api`) e `web` (Caddy servindo a interface e encaminhando `/api`, com HTTPS automático).

> Os arquivos `docker-compose.yml` e `deploy/*` ainda não foram executados em um Docker real; o ambiente de desenvolvimento usado até aqui não tinha o serviço Docker disponível. Valide em homologação antes da produção.

## Passos

1. Copie `.env.example` para `.env` e defina `POSTGRES_PASSWORD`, `WEB_ORIGIN` (ex. `https://clinica.exemplo.com.br`) e `SITE_ADDRESS` (o domínio).
2. `docker compose up -d --build`
3. Crie a organização e o primeiro administrador:
   ```bash
   docker compose run --rm \
     -e SEED_ORGANIZATION_NAME="Nome da clínica" -e SEED_UNIT_NAME="Matriz" \
     -e SEED_ADMIN_NAME="Seu nome" -e SEED_ADMIN_EMAIL="voce@clinica.com.br" \
     -e SEED_ADMIN_PASSWORD="uma-senha-forte" \
     api node dist/scripts/seed.js
   ```

## WhatsApp (mensagens automáticas)

A API gera os lembretes a cada `MESSAGES_INTERVAL_MINUTES` minutos (padrão 5). Sem credenciais, eles ficam em Mensagens › Fila de mensagens para a recepção enviar pelo WhatsApp da clínica. Para o envio automático:

1. Crie a conta do WhatsApp Business Platform (Cloud API) da clínica na Meta e um número remetente.
2. Cadastre e aprove na Meta um modelo por mensagem, em português (`pt_BR`), com o mesmo texto da tela Mensagens automáticas; cada variável do texto vira `{{1}}`, `{{2}}`... na ordem em que aparece.
3. Defina `WHATSAPP_TOKEN` (token permanente de usuário do sistema) e `WHATSAPP_PHONE_NUMBER_ID` no `.env` e reinicie a API.
4. Em Mensagens automáticas, informe o nome de cada modelo aprovado. Mensagem sem modelo continua indo pela fila.

O envio automático só acontece das 8h às 20h no fuso da clínica, com até 3 tentativas por mensagem. O token nunca é exibido nem gravado no banco.

## Atualização

`git pull && docker compose up -d --build`. As migrações rodam na subida da API.

## Backup e recuperação

- Backup diário: `docker compose exec -T db pg_dump -U clinica -Fc clinica > backup-$(date +%F).dump`, copiado para fora do servidor.
- Restauração em banco vazio: `docker compose exec -T db pg_restore -U clinica -d clinica --clean --if-exists < backup.dump`.
- Teste a restauração periodicamente em outra máquina.

## Segurança

- Cookies de sessão são `Secure` quando `NODE_ENV=production`; mantenha o acesso só por HTTPS.
- O Caddy envia HSTS, CSP restritiva e `frame-ancestors 'none'`.
- Nunca versione o `.env`.
- Login limitado a 10 tentativas por minuto por IP e a 5 falhas em 15 minutos por e-mail (inclusive e-mails inexistentes, para não revelar contas). O limite por e-mail fica em memória: com mais de uma instância da API, vale por instância.
- O cookie de sessão não tem data de expiração (fecha com o navegador); a validade de verdade é a do servidor (`SESSION_TTL_HOURS`, renovada a cada uso).
- Em produção a API confia só no primeiro proxy (o Caddy) para descobrir o IP do cliente; não exponha a porta 3000 diretamente.
- A descrição OpenAPI (`/api/docs/openapi.json`) só é publicada fora de produção.
