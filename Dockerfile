FROM node:22-bookworm-slim

WORKDIR /app

# The frontend build needs the toolchain; the running service keeps only its
# production dependencies plus the generated standalone server.
COPY package.json package-lock.json ./
RUN npm ci --include=dev --include=optional --no-audit --no-fund

COPY . .
ENV ONTIME_TARGET=railway
RUN node node_modules/vinext/dist/cli.js build \
    && test -f dist/standalone/server.js \
    && npm prune --omit=dev --no-audit --no-fund

ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "scripts/railway-start.mjs"]
