FROM node:20-slim

RUN apt-get update && apt-get install -y openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Cache bust on code changes
ARG CACHEBUST=1

COPY server/package*.json ./server/
RUN cd server && npm ci --production

COPY server/ ./server/
COPY audit-engine/ ./audit-engine/

RUN cd server && npx prisma generate

WORKDIR /app/server
EXPOSE 4000

ENV NODE_ENV=production

# DATABASE_URL must be provided at runtime
# REDIS_URL is optional (enables BullMQ persistent queues)
# CLUSTER_WORKERS controls the number of worker processes (default: CPU count)

# Run Prisma migrations before starting the server
CMD npx prisma migrate deploy && node cluster.js
