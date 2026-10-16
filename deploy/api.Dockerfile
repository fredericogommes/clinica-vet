FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/contracts/package.json packages/contracts/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci
COPY tsconfig.base.json ./
COPY packages/contracts packages/contracts
COPY apps/api apps/api
RUN npm run build -w @clinica/contracts && npm run build -w @clinica/api \
  && npm prune --omit=dev

FROM node:22-bookworm-slim
ENV NODE_ENV=production API_HOST=0.0.0.0 API_PORT=3000
WORKDIR /app
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/packages/contracts/package.json packages/contracts/
COPY --from=build /app/packages/contracts/dist packages/contracts/dist
COPY --from=build /app/apps/api/package.json apps/api/
COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/apps/api/drizzle apps/api/drizzle
USER node
WORKDIR /app/apps/api
EXPOSE 3000
CMD ["sh", "-c", "node dist/scripts/migrate.js && node dist/main.js"]
