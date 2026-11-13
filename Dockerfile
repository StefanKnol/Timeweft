# The Timeweft image.
#
# It carries the app and nothing else. The author's canon lives in the PostgreSQL database the
# container is pointed at, never in the image, so the image holds nothing private and the
# database is the only thing to back up.
#
# One process serves everything on one port: the author's pages, the operations under /api, and
# the story tools for a chat under /mcp. PostgreSQL is not in the image; give its address in
# TIMEWEFT_DATABASE_URL. The server makes and updates its own tables when it starts.

# ---------------------------------------------------------------- build
FROM node:22.22-alpine AS build

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate

WORKDIR /app

# The manifests first, so a change to source does not invalidate the install layer.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json tsconfig.json ./
COPY packages/contract/package.json      packages/contract/
COPY packages/store/package.json         packages/store/
COPY packages/briefing/package.json      packages/briefing/
COPY packages/weaver-files/package.json  packages/weaver-files/
COPY apps/server/package.json            apps/server/
COPY apps/web/package.json               apps/web/

RUN pnpm install --frozen-lockfile --ignore-scripts

COPY . .

# An image that does not typecheck is not built. The tests need PostgreSQL and run in CI.
RUN pnpm typecheck && pnpm --filter @timeweft/web typecheck

# The author's pages, built once here. The server serves the built folder as it is.
RUN pnpm --filter @timeweft/web build

# --------------------------------------------------------------- runtime
FROM node:22.22-alpine AS runtime

ENV NODE_ENV=production
ENV PORT=4400

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
# Corepack keeps the pnpm it prepared in its home, which defaults to root's. The container runs
# as `node`, which cannot read /root, so the cache goes somewhere every user can read.
ENV COREPACK_HOME=/opt/corepack
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate \
 && chmod -R a+rX /opt/corepack

WORKDIR /app

# A production-only install, rather than carrying the build stage's node_modules across. The
# build needed TypeScript, Vite and React; the running server needs none of them.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/contract/package.json      packages/contract/
COPY packages/store/package.json         packages/store/
COPY packages/briefing/package.json      packages/briefing/
COPY packages/weaver-files/package.json  packages/weaver-files/
COPY apps/server/package.json            apps/server/
COPY apps/web/package.json               apps/web/

RUN pnpm install --frozen-lockfile --prod --ignore-scripts

# The source. There is no build output for the server: Node strips the types as it runs.
COPY tsconfig.base.json ./
COPY packages/  packages/
COPY apps/server/ apps/server/

# The pages, as the build stage built them.
COPY --from=build /app/apps/web/dist apps/web/dist

COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Where a run's files are mounted for an import. Nothing is kept here.
RUN mkdir -p /import && chown -R node:node /app /import

# Which build this is, stamped by the workflow and reported on /health, so a running container
# can be told apart from the one before it. Declared after the install so that a value which
# changes with every build does not invalidate the layers above.
ARG TIMEWEFT_BUILD_NUMBER=""
ARG TIMEWEFT_BUILD_COMMIT=""
ARG TIMEWEFT_BUILT_AT=""
ENV TIMEWEFT_BUILD_NUMBER=$TIMEWEFT_BUILD_NUMBER
ENV TIMEWEFT_BUILD_COMMIT=$TIMEWEFT_BUILD_COMMIT
ENV TIMEWEFT_BUILT_AT=$TIMEWEFT_BUILT_AT

# Run unprivileged. The node image already carries a `node` user.
USER node

EXPOSE 4400

# /health needs no token and reads nothing from the database.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 4400) + '/health').then((answer) => process.exit(answer.ok ? 0 : 1), () => process.exit(1))"

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["serve"]
