# syntax=docker/dockerfile:1

# --- Build: Frontend und Backend bauen, danach Dev-Abhängigkeiten entfernen ---
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build \
 && npm prune --omit=dev \
 # sharp bringt musl- und WASM-Varianten mit, die unter Debian nie geladen werden
 && rm -rf node_modules/@img/sharp-*musl* node_modules/@img/sharp-wasm32

# --- Runtime: nur Produktionsabhängigkeiten, läuft als Benutzer node (UID 1000) ---
FROM node:22-slim
ENV NODE_ENV=production \
    PORT=8080 \
    PHOTOS_DIR=/photos \
    DATA_DIR=/data \
    CACHE_DIR=/cache \
    TZ=Europe/Berlin
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
RUN mkdir -p /photos /data /cache && chown node:node /data /cache
USER node
EXPOSE 8080 8443
VOLUME ["/data", "/cache"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--disable-warning=ExperimentalWarning", "dist/server/index.js"]
