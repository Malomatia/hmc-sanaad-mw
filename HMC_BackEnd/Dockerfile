# syntax=docker/dockerfile:1

############################
# 1) Base image
#    node:20-slim (Debian/glibc) is used instead of Alpine because
#    node-oracledb ships prebuilt binaries for glibc — avoids native builds.
############################
FROM node:20-slim AS base
WORKDIR /app

############################
# 2) Install ALL deps (incl. dev) — needed to compile TypeScript
############################
FROM base AS deps
ENV NODE_ENV=development
COPY package.json package-lock.json ./
RUN npm ci

############################
# 3) Build TypeScript -> dist/ (nest build + tsc-alias)
############################
FROM deps AS build
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
RUN npm run build

############################
# 4) Install production-only deps
############################
FROM base AS prod-deps
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

############################
# 5) Final runtime image
############################
FROM base AS runner
ENV NODE_ENV=production \
    PORT=443

# ---- Oracle Instant Client (node-oracledb Thick mode) ----
# Thick mode needs the Oracle Client libraries. The Debian/glibc slim image
# supports them (Alpine/musl does not). We register the libs with ldconfig so
# node-oracledb locates libclntsh.so with no libDir/ORACLE_CLIENT_LIB_DIR needed.
# Use Basic (full charset support, incl. Arabic national charsets); swap to
# instantclient-basiclite-linuxx64.zip for a much smaller image if AL32UTF8 suffices.
ARG INSTANT_CLIENT_URL=https://download.oracle.com/otn_software/linux/instantclient/instantclient-basic-linuxx64.zip
RUN apt-get update \
 && apt-get install -y --no-install-recommends libaio1 ca-certificates curl unzip \
 && mkdir -p /opt/oracle \
 && curl -fsSL "$INSTANT_CLIENT_URL" -o /tmp/instantclient.zip \
 && unzip -q /tmp/instantclient.zip -d /opt/oracle \
 && rm -f /tmp/instantclient.zip \
 && ICDIR="$(find /opt/oracle -maxdepth 1 -type d -name 'instantclient*' | head -n1)" \
 && printf '%s\n' "$ICDIR" > /etc/ld.so.conf.d/oracle-instantclient.conf \
 && ldconfig \
 && apt-get purge -y curl unzip \
 && apt-get autoremove -y \
 && rm -rf /var/lib/apt/lists/*

# Copy production node_modules and compiled output, owned by the built-in
# non-root `node` user provided by the official image.
COPY --chown=node:node --from=prod-deps /app/node_modules ./node_modules
COPY --chown=node:node --from=build /app/dist ./dist
COPY --chown=node:node package.json ./

# Writable log directory for ApiLogFileWriter (API_LOG_DIR default logs/api).
# /app itself is root-owned, so the non-root `node` user could not mkdir it at
# runtime — every request logged "EACCES: permission denied, mkdir '/app/logs'".
RUN mkdir -p /app/logs && chown -R node:node /app/logs

USER node
EXPOSE 443

# Container-native healthcheck (uses Node's global fetch — no curl needed).
HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
  CMD ["node","-e","fetch('http://127.0.0.1:'+(process.env.PORT||443)+'/'+(process.env.API_PREFIX||'api/v1')+'/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

CMD ["node", "dist/main"]