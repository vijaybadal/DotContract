# DOTComm CLM — container image (Node 22, Next.js standalone server).
# Build:  docker build -t dotcomm-clm .
# NOTE: written for Phase 1 but not yet built in CI; see docs/DEPLOYMENT.md.

FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1 NEXT_OUTPUT=standalone
RUN npx next build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
RUN groupadd --system clm && useradd --system --gid clm --home /app clm
# Web server
COPY --from=build --chown=clm:clm /app/.next/standalone ./
COPY --from=build --chown=clm:clm /app/.next/static ./.next/static
# Migrations, seed and job runner (tsx + sources) for the "migrate" and "jobs" services
COPY --from=build --chown=clm:clm /app/drizzle ./drizzle
COPY --from=build --chown=clm:clm /app/scripts ./scripts
COPY --from=build --chown=clm:clm /app/src ./src
COPY --from=build --chown=clm:clm /app/tsconfig.json /app/package.json ./
COPY --from=deps --chown=clm:clm /app/node_modules ./node_modules
RUN mkdir -p /data/storage && chown clm:clm /data/storage
USER clm
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
