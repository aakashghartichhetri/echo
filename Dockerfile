# A single app image serves the React bundle and API. Keep the image private to the proxy.
FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
# The committed lockfile makes local and CI dependency resolution reproducible.
RUN node --version && npm --version && npm ci --no-audit --no-fund
COPY . .
RUN DATABASE_URL=postgresql://echo:build_only@127.0.0.1:5432/echo?schema=public npm run build

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
COPY --chown=node:node --from=build /app /app
USER node
EXPOSE 3001
HEALTHCHECK --interval=20s --timeout=4s --start-period=45s --retries=5 CMD node -e "fetch('http://127.0.0.1:3001/api/v1/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["sh", "-c", "npm run db:deploy && npm run start:api"]
