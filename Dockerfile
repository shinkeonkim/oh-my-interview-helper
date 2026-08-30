FROM oven/bun:1.3.10-alpine AS build
WORKDIR /app

COPY package.json bun.lock ./
COPY client/package.json client/package.json
COPY server/package.json server/package.json
COPY shared/package.json shared/package.json
COPY packages/runner/package.json packages/runner/package.json
RUN bun install --frozen-lockfile

COPY . .
RUN bun run build

FROM oven/bun:1.3.10-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    BIND_HOST=0.0.0.0 \
    DATA_DIR=/app/data \
    LOCAL_HOSTS=localhost:3000,127.0.0.1:3000,[::1]:3000

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/server/node_modules ./server/node_modules
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/server/public ./server/public
RUN mkdir -p /app/data && chown -R bun:bun /app

USER bun
EXPOSE 3000
VOLUME ["/app/data"]
CMD ["bun", "server/dist/index.js"]
