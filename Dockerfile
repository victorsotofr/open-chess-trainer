# syntax=docker/dockerfile:1
# Open Chess Trainer: one image serving the web app + API. No secrets in the image;
# the database lives in a volume (/data/db). The puzzle pack ships with the web app (B5).

# full image for building: it already ships python3/make/g++ for native modules (better-sqlite3)
FROM node:22-bookworm AS deps
WORKDIR /src
COPY app/package.json app/package-lock.json app/
RUN cd app && npm ci --fetch-timeout=600000 --fetch-retries=6 --no-audit --no-fund
COPY server/package.json server/package-lock.json server/
RUN cd server && npm ci --fetch-timeout=600000 --fetch-retries=6 --no-audit --no-fund

FROM deps AS build
ARG GIT_SHA=nogit
ENV GIT_SHA=$GIT_SHA
COPY shared shared
COPY app app
COPY server server
RUN cd app && npm run build && cd ../server && npm run typecheck && npx vitest run
RUN cd server && npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production PORT=8080 STATIC_DIR=/app/web DB_PATH=/data/db/chess.sqlite
WORKDIR /app
COPY --from=build /src/server/package.json /app/server/package.json
COPY --from=build /src/server/node_modules /app/server/node_modules
COPY --from=build /src/server/src /app/server/src
COPY --from=build /src/shared /app/shared
COPY --from=build /src/app/dist /app/web
RUN mkdir -p /data/db && chown -R node:node /data
# run from the server package so `--import tsx` resolves from its node_modules
WORKDIR /app/server
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s CMD node -e "fetch('http://localhost:8080/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--import", "tsx", "src/main.ts"]
