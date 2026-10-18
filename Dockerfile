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
COPY --from=build /app/node_modules ./node_modules
COPY . .
VOLUME ["/data"]
EXPOSE 3000
CMD ["node", "server.js"]
