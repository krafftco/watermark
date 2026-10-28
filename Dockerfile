# Build stage: has the compilers native modules (better-sqlite3, sharp) need if no prebuilt binary matches.
FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci --omit=dev

# Run stage: small, no compilers.
FROM node:22-bookworm-slim
WORKDIR /app
# Memory (launch fix 6.1): the starter instance has 512 MB and was restarted for exceeding it. glibc's many malloc
# arenas fragment under libvips; two arenas and a capped V8 heap keep the process well inside the line.
ENV NODE_ENV=production DATA_DIR=/data PORT=3000 MALLOC_ARENA_MAX=2 NODE_OPTIONS=--max-old-space-size=320
# The document kind (27 Oct): poppler renders and reads a PDF's pages, tesseract reads a scan with no text of its own.
# Postgres (27 Oct): pg_dump and pg_restore for the backups and the drill, from the PGDG repository so they are never
# older than the server (a client must be at least the server's version to dump it).
RUN apt-get update && apt-get install -y --no-install-recommends poppler-utils tesseract-ocr tesseract-ocr-eng ca-certificates curl gnupg \
 && curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | gpg --dearmor -o /usr/share/keyrings/pgdg.gpg \
 && echo "deb [signed-by=/usr/share/keyrings/pgdg.gpg] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" > /etc/apt/sources.list.d/pgdg.list \
 && apt-get update && apt-get install -y --no-install-recommends postgresql-client-17 && apt-get purge -y curl gnupg && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/node_modules ./node_modules
COPY . .
VOLUME ["/data"]
EXPOSE 3000
CMD ["node", "server.js"]
