# Optional packaging (PRD §5) — the primary deploy path is Render's native
# Node runtime via render.yaml. This Dockerfile is a single-stage build for
# anyone who'd rather run Waypoint as a container.
FROM node:22-bookworm-slim

# build-essential + python3: required to compile better-sqlite3's native
# binding (packages/backend, history persistence stretch goal).
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY packages/backend/package.json packages/backend/package.json
COPY packages/simulator/package.json packages/simulator/package.json
COPY packages/dashboard/package.json packages/dashboard/package.json
RUN npm install

COPY . .
RUN npm run build

ENV NODE_ENV=production
ENV EMBED_SIMULATOR=true

EXPOSE 8080
CMD ["npm", "run", "start"]
