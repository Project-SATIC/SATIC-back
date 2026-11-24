FROM node:22-alpine

WORKDIR /app

# Instala apenas dependências de produção
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copia código-fonte TypeScript (executado nativamente pelo Node 22+) e migrations SQL
COPY tsconfig.json ./
COPY migrations ./migrations
COPY src ./src

ENV NODE_ENV=production \
    PORT=3001 \
    AUTO_MIGRATE=true \
    LOG_LEVEL=info

# Executa como usuário não-root para segurança do container
USER node

EXPOSE 3001

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3001) + '/api/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "src/api/server.ts"]
