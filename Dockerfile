# syntax=docker/dockerfile:1

# ---- build the UI ----
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci
COPY client client
RUN npm run build -w client

# ---- runtime: server + built UI ----
FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3001 \
    DATA_DIR=/data

COPY package.json package-lock.json ./
COPY server/package.json server/
COPY client/package.json client/
# Only the server's runtime dependencies (express, tsx).
RUN npm ci --omit=dev -w server && npm cache clean --force

COPY server/src server/src
COPY server/tsconfig.json server/
COPY --from=build /app/client/dist client/dist

RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/api/settings" > /dev/null || exit 1

WORKDIR /app/server
CMD ["node", "--import", "tsx", "src/index.ts"]
