FROM oven/bun:1.3
WORKDIR /app

# Copy only manifests first so `bun install` is cached independently of source
# changes. All workspace manifests are needed for --frozen-lockfile to resolve
# the workspace graph.
COPY package.json bun.lock ./
COPY apps/web/package.json apps/web/
COPY apps/data-worker/package.json apps/data-worker/
COPY packages/otr-core/package.json packages/otr-core/

RUN bun install --frozen-lockfile

COPY . .

ENV NODE_ENV=production

CMD ["bun", "run", "--cwd", "apps/data-worker", "start"]
