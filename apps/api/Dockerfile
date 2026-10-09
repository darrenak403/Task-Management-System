FROM node:24.21.0-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20 AS base
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*

FROM base AS dependencies
WORKDIR /workspace
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/package.json
RUN npm install --global npm@11.14.1 && npm ci

FROM dependencies AS migrate
ENV NODE_ENV=production
COPY --chown=node:node apps/api/prisma.config.ts ./apps/api/prisma.config.ts
COPY --chown=node:node apps/api/prisma ./apps/api/prisma
# The demo seed runs from this image too. It needs the Prisma client and the two source files it imports.
ARG DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build
COPY tsconfig.base.json ./
COPY apps/api/tsconfig.json ./apps/api/tsconfig.json
COPY apps/api/src/shared/db/prisma.ts ./apps/api/src/shared/db/prisma.ts
COPY apps/api/src/shared/config/env.ts ./apps/api/src/shared/config/env.ts
RUN DATABASE_URL=${DATABASE_URL} npm run --workspace @task-management/api db:generate
USER node
CMD ["npm", "run", "--workspace", "@task-management/api", "db:migrate:deploy"]

FROM dependencies AS build
ARG DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build
ENV DATABASE_URL=${DATABASE_URL}
COPY tsconfig.base.json ./
COPY apps/api ./apps/api
RUN npm run --workspace @task-management/api db:generate \
  && npm run --workspace @task-management/api build \
  && npm prune --omit=dev

FROM base AS api
ENV NODE_ENV=production PORT=4000 NODE_OPTIONS=--enable-source-maps
ARG APP_BUILD_SHA
ENV APP_BUILD_SHA=${APP_BUILD_SHA}
WORKDIR /workspace

COPY --from=build --chown=node:node /workspace/package.json ./package.json
COPY --from=build --chown=node:node /workspace/apps/api/package.json ./apps/api/package.json
COPY --from=build --chown=node:node /workspace/apps/api/dist ./apps/api/dist
COPY --from=build --chown=node:node /workspace/node_modules ./node_modules

USER node
EXPOSE 4000
CMD ["node", "apps/api/dist/server.js"]
