FROM node:24-bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /runtime
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
FROM node:24-bookworm-slim
WORKDIR /runtime
COPY --from=build /runtime/node_modules ./node_modules
COPY isolate-worker.cjs dependencies.cjs ./
USER 10001:10001
CMD ["node", "--no-node-snapshot", "isolate-worker.cjs"]
