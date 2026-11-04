FROM node:20-alpine
RUN corepack enable
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages ./packages
COPY apps/worker ./apps/worker
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @evo/db generate
RUN pnpm --filter @evo/worker build
EXPOSE 4100
WORKDIR /app/apps/worker
CMD ["sh", "-c", "cd /app && pnpm --filter @evo/db migrate && cd /app/apps/worker && pnpm start"]
