#!/bin/sh
set -e

echo "InstaPilot AI — starting..."
echo "PORT=${PORT:-3000} | NODE_ENV=$NODE_ENV"

# Ensure the database schema exists before the app boots.
# NOTE: ideally schema sync is a dedicated RELEASE step, not the runtime start path.
# Fail CLOSED — if the schema can't be applied, do NOT boot against a stale/half-migrated
# DB (that silently corrupts data). `set -e` above already aborts on a non-zero exit.
echo "Applying database schema (prisma db push)..."
npx prisma db push --skip-generate

echo "Starting Next.js server..."
exec node server.js
