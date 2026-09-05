ARG NODE_IMAGE=node:22-alpine@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32

FROM ${NODE_IMAGE} AS workspace

RUN corepack enable
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/application/package.json packages/application/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/domain/package.json packages/domain/package.json
COPY packages/infrastructure/package.json packages/infrastructure/package.json
COPY packages/ui/package.json packages/ui/package.json
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm prisma:generate
RUN pnpm dev:prepare

FROM workspace AS api-builder
RUN pnpm --filter @lydoc/api build

FROM api-builder AS api-runtime
RUN pnpm --filter @lydoc/api deploy --prod --legacy /prod/api \
    && mkdir -p /runtime \
    && cp /prod/api/package.json /runtime/package.json \
    && cp -R /prod/api/node_modules /runtime/node_modules \
    && cp -R /app/apps/api/dist /runtime/dist \
    && cp -R /app/packages/application/dist /runtime/node_modules/@lydoc/application/dist \
    && cp -R /app/packages/config/dist /runtime/node_modules/@lydoc/config/dist \
    && cp -R /app/packages/domain/dist /runtime/node_modules/@lydoc/domain/dist \
    && cp -R /app/packages/infrastructure/dist /runtime/node_modules/@lydoc/infrastructure/dist \
    && test -f /runtime/dist/main.js \
    && test -f /runtime/node_modules/@lydoc/application/dist/index.js \
    && test -f /runtime/node_modules/@prisma/client/index.js

FROM workspace AS web-builder
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_MANAGED_POSTAL_ENABLED=false
ARG NEXT_PUBLIC_DOCUMENTS_PAGE_ENABLED=false
ARG SECURITY_CONTACT_EMAIL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL
ENV NEXT_PUBLIC_MANAGED_POSTAL_ENABLED=$NEXT_PUBLIC_MANAGED_POSTAL_ENABLED
ENV NEXT_PUBLIC_DOCUMENTS_PAGE_ENABLED=$NEXT_PUBLIC_DOCUMENTS_PAGE_ENABLED
ENV SECURITY_CONTACT_EMAIL=$SECURITY_CONTACT_EMAIL
RUN pnpm --filter @lydoc/web build

FROM workspace AS migrate
ENV NODE_ENV=production
RUN apk upgrade --no-cache \
    && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
    && rm -f /usr/local/bin/npm /usr/local/bin/npx \
      /usr/local/bin/corepack /usr/local/bin/pnpm /usr/local/bin/pnpx \
      /usr/local/bin/yarn /usr/local/bin/yarnpkg
USER node
CMD ["node", "node_modules/prisma/build/index.js", "migrate", "deploy", "--schema", "prisma/schema.prisma"]

FROM ${NODE_IMAGE} AS runtime-base
# Production only executes `node`; package-manager CLIs enlarge the attack
# surface and have no purpose in either immutable runtime image.
RUN apk upgrade --no-cache \
    && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
    && rm -f /usr/local/bin/npm /usr/local/bin/npx \
      /usr/local/bin/corepack /usr/local/bin/pnpm /usr/local/bin/pnpx \
      /usr/local/bin/yarn /usr/local/bin/yarnpkg

FROM runtime-base AS api
RUN apk add --no-cache \
    fontconfig \
    poppler-utils=25.12.0-r1 \
    tesseract-ocr=5.5.2-r0 \
    tesseract-ocr-data-eng=5.5.2-r0 \
    tesseract-ocr-data-fra=5.5.2-r0 \
    ttf-dejavu
WORKDIR /app
ENV NODE_ENV=production
COPY --from=api-runtime --chown=node:node /runtime ./
RUN mkdir -p /app/var/storage && chown -R node:node /app/var \
    && test "$(stat -c '%U' /app/dist/main.js)" = "node"
USER node
EXPOSE 3001
CMD ["node", "dist/main.js"]

FROM runtime-base AS web
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
COPY --from=web-builder --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=web-builder --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=web-builder --chown=node:node /app/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
