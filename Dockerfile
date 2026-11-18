# Build the API and React app once; Express serves the static React bundle.
FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
# Exact direct dependency versions. Commit a resolved package-lock.json
# after generating it on a machine with npm registry access.
RUN npm install --no-audit --no-fund
COPY . .
RUN DATABASE_URL=postgresql://echo:build_only@127.0.0.1:5432/echo?schema=public npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
COPY --from=build /app /app
EXPOSE 3001
HEALTHCHECK --interval=15s --timeout=3s --start-period=25s --retries=5 CMD node -e "fetch('http://127.0.0.1:3001/api/v1/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["sh", "-c", "npm run db:deploy && npm run db:seed && npm run start:api"]
