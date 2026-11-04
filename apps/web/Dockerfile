FROM node:20-alpine AS base
RUN corepack enable
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages ./packages
COPY apps/web ./apps/web
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @evo/db generate
RUN pnpm --filter @evo/web build

FROM node:20-alpine AS runner
RUN corepack enable
WORKDIR /app
COPY --from=base /app /app
EXPOSE 3000
WORKDIR /app/apps/web
CMD ["pnpm", "start"]
