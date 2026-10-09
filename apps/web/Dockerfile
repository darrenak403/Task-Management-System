FROM node:24.21.0-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20 AS base

FROM base AS dependencies
WORKDIR /workspace
# Every workspace manifest is present so the lockfile matches; only the web workspace is installed.
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
RUN npm install --global npm@11.14.1 \
  && npm ci --workspace @task-management/web --include-workspace-root

FROM dependencies AS build
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
# The web server forwards same-origin `/api/*` to the API service of the same Compose project.
# The address is fixed into the build; both Compose files name that service `api`.
ARG API_PROXY_TARGET=http://api:4000
ENV API_PROXY_TARGET=${API_PROXY_TARGET}
COPY tsconfig.base.json ./
COPY apps/web ./apps/web
RUN npm run --workspace @task-management/web build

FROM base AS web
# The browser calls same-origin `/api/*`; the forward to the API was fixed at build time, so nothing is configured here.
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1
ARG APP_BUILD_SHA
ENV APP_BUILD_SHA=${APP_BUILD_SHA}
WORKDIR /workspace

# The standalone output mirrors the monorepo layout and carries only the modules the server imports.
COPY --from=build --chown=node:node /workspace/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /workspace/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /workspace/apps/web/public ./apps/web/public

USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
