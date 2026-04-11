FROM node:20-slim

RUN apt-get update && apt-get install -y openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY server/package*.json ./server/
RUN cd server && npm ci --production

COPY server/ ./server/
COPY audit-engine/ ./audit-engine/

RUN cd server && npx prisma generate

WORKDIR /app/server
EXPOSE 4000

ENV NODE_ENV=production

# DATABASE_URL must be provided at runtime
# e.g. postgresql://user:pass@host:5432/auleg

CMD ["node", "index.js"]
