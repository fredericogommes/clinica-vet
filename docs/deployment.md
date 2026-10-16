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
