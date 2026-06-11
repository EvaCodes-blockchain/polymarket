#!/bin/sh
set -e

echo "[entrypoint] Running Prisma migrations..."
cd /app/web
npx prisma migrate deploy

echo "[entrypoint] Starting Next.js..."
exec node_modules/.bin/next start -p "${PORT:-3000}" -H "${HOSTNAME:-0.0.0.0}"
