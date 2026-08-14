# The backend, containerised so it can run in Mumbai.
#
# WHY THIS EXISTS AT ALL: Render builds from package.json with no Dockerfile,
# and Render has no region near the UAE. Supabase is in ap-south-1 (Mumbai) and
# the users are in Dubai; the backend sat in Europe, between the two, paying
# that distance on every database round-trip — and a turn makes about five of
# them in sequence. This file is the whole of what moving costs.
#
# Nothing about the application changes. Same server.js, same routes, same
# council, same .env variable names.

# Node 26 matches CI's pinned node-version; change this and .github/workflows/ci.yml together.
FROM node:26-slim

# dumb-init, because Node as PID 1 does not reap children or forward signals.
# Fly sends SIGINT to drain a machine before replacing it; without this the
# process ignores it and gets SIGKILLed instead, cutting live SSE streams
# mid-answer rather than letting them finish.
RUN apt-get update \
  && apt-get install -y --no-install-recommends dumb-init \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
WORKDIR /app

# Manifests first, so a code change does not invalidate the dependency layer.
COPY package.json package-lock.json ./

# `npm ci` not `npm install`: it installs exactly the lockfile and fails if the
# two disagree, which is the behaviour you want in a build you are not watching.
# --omit=dev because nothing here runs tests.
#
# NOTE FOR WHOEVER CHANGES THIS: --omit=dev is why agentation and the frontend
# devDependencies never reach production, and the frontend's lazy import of
# agentation is written the way it is precisely so a --omit=dev install cannot
# break the build. Same rule applies here.
RUN npm ci --omit=dev && npm cache clean --force

COPY . .

# Non-root. The base image ships a `node` user; use it rather than inventing one.
USER node

# Informational only — Fly routes by fly.toml's internal_port. Kept in sync with
# the PORT default in server.js so the two cannot silently disagree.
EXPOSE 3000

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "server.js"]
