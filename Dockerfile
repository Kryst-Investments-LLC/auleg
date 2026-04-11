FROM node:20-slim

RUN apt-get update && apt-get install -y wget apt-transport-https software-properties-common \
    && wget -q https://packages.microsoft.com/config/debian/12/packages-microsoft-prod.deb \
    && dpkg -i packages-microsoft-prod.deb \
    && apt-get update && apt-get install -y powershell \
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
ENV DATABASE_URL=file:./dev.db

CMD ["node", "index.js"]
