FROM node:20-alpine
RUN corepack enable
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages ./packages
COPY apps/ingest ./apps/ingest
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @evo/db generate
RUN pnpm --filter @evo/ingest build
EXPOSE 4000
WORKDIR /app/apps/ingest
CMD ["sh", "-c", "cd /app && pnpm --filter @evo/db migrate && cd /app/apps/ingest && pnpm start"]
